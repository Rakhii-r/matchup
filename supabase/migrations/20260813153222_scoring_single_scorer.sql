-- ============================================================================
-- Ball-by-ball scoring, SINGLE scorer.
--
-- Deliberately NOT FR-301. FR-301 requires two independent scorers and
-- server-side reconciliation so neither side can misreport. This trusts one
-- scorer. That is a product decision taken knowingly (12 Aug 2026); the data
-- model below is shaped so a second scorer can be added later by adding a
-- `scorer_slot` to deliveries and a reconciliation step, without moving
-- anything else.
-- ============================================================================

alter table public.matches
  add column if not exists scorer_id     uuid references public.profiles (id) on delete set null,
  add column if not exists motm_user_id  uuid references public.profiles (id) on delete set null,
  add column if not exists result_text   text;

create table if not exists public.innings (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  number          smallint not null check (number in (1, 2)),
  batting_team_id uuid not null references public.teams (id) on delete cascade,
  bowling_team_id uuid not null references public.teams (id) on delete cascade,
  -- Innings 2 only. Runs needed to WIN (first-innings total + 1).
  target          integer,
  status          text not null default 'in_progress'
                    check (status in ('in_progress', 'completed')),
  -- Maintained by trigger from deliveries. Never written by hand.
  runs            integer not null default 0,
  wickets         integer not null default 0,
  legal_balls     integer not null default 0,
  created_at      timestamptz not null default now(),
  ended_at        timestamptz,
  unique (match_id, number),
  constraint innings_sides_differ check (batting_team_id <> bowling_team_id)
);
create index if not exists innings_match_idx on public.innings (match_id);

create table if not exists public.deliveries (
  id             uuid primary key default gen_random_uuid(),
  innings_id     uuid not null references public.innings (id) on delete cascade,
  -- Monotonic within an innings. Undo removes the highest; ordering never
  -- depends on created_at, which can tie at millisecond resolution.
  seq            integer not null,
  over_number    integer not null check (over_number >= 0),
  ball_in_over   smallint not null check (ball_in_over between 1 and 6),
  striker_id     uuid not null references public.profiles (id) on delete restrict,
  non_striker_id uuid references public.profiles (id) on delete restrict,
  bowler_id      uuid not null references public.profiles (id) on delete restrict,
  runs_off_bat   smallint not null default 0 check (runs_off_bat between 0 and 7),
  extra_type     text check (extra_type in ('wide', 'no_ball', 'bye', 'leg_bye')),
  -- TOTAL extras for this ball, penalty included. A plain wide is 1. A wide
  -- that runs away for four is 5. Storing the penalty separately is how
  -- scorecards end up double-counting.
  extra_runs     smallint not null default 0 check (extra_runs between 0 and 10),
  wicket_type    text check (wicket_type in
                   ('bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket')),
  out_player_id  uuid references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (innings_id, seq),
  -- Byes and leg byes come off the pad, not the bat.
  constraint bye_has_no_bat_runs check (
    extra_type is null or extra_type in ('wide', 'no_ball') or runs_off_bat = 0
  ),
  constraint wicket_needs_player check (
    wicket_type is null or out_player_id is not null
  )
);
create index if not exists deliveries_innings_seq_idx on public.deliveries (innings_id, seq desc);

alter table public.innings enable row level security;
alter table public.deliveries enable row level security;

drop policy if exists "innings_select" on public.innings;
create policy "innings_select" on public.innings for select to authenticated
  using (
    public.is_match_creator(match_id, (select auth.uid()))
    or public.is_match_player(match_id, (select auth.uid()))
  );

drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select" on public.deliveries for select to authenticated
  using (
    exists (
      select 1 from public.innings i
       where i.id = deliveries.innings_id
         and (
           public.is_match_creator(i.match_id, (select auth.uid()))
           or public.is_match_player(i.match_id, (select auth.uid()))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Totals, recomputed from scratch on every change.
--
-- Incrementing would be cheaper but undo then has to reverse exactly what was
-- applied, and any bug there is silent and permanent. A full recount over a few
-- hundred rows costs nothing and cannot drift.
-- ---------------------------------------------------------------------------
create or replace function public.sync_innings_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := coalesce(new.innings_id, old.innings_id);
begin
  update public.innings i
     set runs = coalesce(t.runs, 0),
         wickets = coalesce(t.wickets, 0),
         legal_balls = coalesce(t.legal_balls, 0)
    from (
      select sum(d.runs_off_bat + d.extra_runs)                      as runs,
             count(*) filter (where d.wicket_type is not null)       as wickets,
             -- Wides and no-balls are re-bowled; they never advance the over.
             count(*) filter (
               where d.extra_type is null or d.extra_type in ('bye', 'leg_bye')
             )                                                        as legal_balls
        from public.deliveries d
       where d.innings_id = v_id
    ) t
   where i.id = v_id;
  return null;
end;
$fn$;

drop trigger if exists deliveries_sync_totals on public.deliveries;
create trigger deliveries_sync_totals
after insert or delete on public.deliveries
for each row execute function public.sync_innings_totals();

-- ---------------------------------------------------------------------------
-- start_innings — creates innings 1 from the toss, or innings 2 with a target.
-- The first captain/creator to start scoring becomes the scorer.
-- ---------------------------------------------------------------------------
create or replace function public.start_innings(in_match_id uuid)
returns public.innings
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches%rowtype; v_toss public.match_toss%rowtype;
  v_prev public.innings%rowtype; v_row public.innings%rowtype;
  v_bat uuid; v_bowl uuid; v_num smallint;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_m.status = 'cancelled' then raise exception 'MATCH_CANCELLED' using errcode = '23514'; end if;

  select * into v_toss from public.match_toss where match_id = in_match_id;
  if not found or v_toss.decision is null then
    raise exception 'TOSS_NOT_DECIDED' using errcode = '23514';
  end if;

  -- Only a captain or the organiser may open scoring. Whoever does it first
  -- becomes the scorer for the whole match.
  if v_m.scorer_id is null then
    if not (public.is_match_captain(in_match_id, v_uid) or v_m.creator_id = v_uid) then
      raise exception 'NOT_ALLOWED_TO_SCORE' using errcode = '42501';
    end if;
    update public.matches set scorer_id = v_uid where id = in_match_id;
    v_m.scorer_id := v_uid;
  elsif v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  select * into v_prev from public.innings
   where match_id = in_match_id order by number desc limit 1;

  if not found then
    v_num := 1;
    v_bat := case when v_toss.decision = 'bat'
                  then v_toss.winner_team_id
                  else case when v_toss.winner_team_id = v_m.team_a_id
                            then v_m.team_b_id else v_m.team_a_id end end;
    v_bowl := case when v_bat = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  else
    if v_prev.number = 2 then
      raise exception 'MATCH_ALREADY_HAS_TWO_INNINGS' using errcode = '23505';
    end if;
    if v_prev.status <> 'completed' then
      raise exception 'FIRST_INNINGS_NOT_ENDED' using errcode = '23514';
    end if;
    v_num := 2; v_bat := v_prev.bowling_team_id; v_bowl := v_prev.batting_team_id;
  end if;

  insert into public.innings (match_id, number, batting_team_id, bowling_team_id, target)
  values (in_match_id, v_num, v_bat, v_bowl,
          case when v_num = 2 then v_prev.runs + 1 else null end)
  returning * into v_row;
  return v_row;
end;
$fn$;

revoke execute on function public.start_innings(uuid) from anon, public;
grant  execute on function public.start_innings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- record_delivery — one ball. Scorer only.
--
-- over_number and ball_in_over are DERIVED here, never sent by the client: they
-- are a pure function of how many legal balls have been bowled, and letting the
-- client compute them means two devices can disagree about which over it is.
-- ---------------------------------------------------------------------------
create or replace function public.record_delivery(
  in_innings_id uuid, in_striker_id uuid, in_non_striker_id uuid, in_bowler_id uuid,
  in_runs_off_bat smallint default 0, in_extra_type text default null,
  in_extra_runs smallint default 0, in_wicket_type text default null,
  in_out_player_id uuid default null
)
returns public.deliveries
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype; v_row public.deliveries%rowtype;
  v_seq integer; v_legal boolean; v_over integer; v_ball smallint;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_i.status <> 'in_progress' then raise exception 'INNINGS_ENDED' using errcode = '23514'; end if;

  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  if in_striker_id = in_non_striker_id then
    raise exception 'SAME_BATTER_BOTH_ENDS' using errcode = '23514';
  end if;
  if in_wicket_type is not null and in_out_player_id is null then
    raise exception 'WICKET_NEEDS_PLAYER' using errcode = '23514';
  end if;

  v_legal := in_extra_type is null or in_extra_type in ('bye', 'leg_bye');
  v_over := v_i.legal_balls / 6;
  v_ball := (v_i.legal_balls % 6) + 1;

  if v_m.overs is not null and v_legal and v_i.legal_balls >= v_m.overs * 6 then
    raise exception 'OVERS_EXHAUSTED' using errcode = '23514';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.deliveries where innings_id = in_innings_id;

  insert into public.deliveries (
    innings_id, seq, over_number, ball_in_over,
    striker_id, non_striker_id, bowler_id,
    runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id
  ) values (
    in_innings_id, v_seq, v_over, v_ball,
    in_striker_id, in_non_striker_id, in_bowler_id,
    coalesce(in_runs_off_bat, 0), in_extra_type, coalesce(in_extra_runs, 0),
    in_wicket_type, in_out_player_id
  ) returning * into v_row;
  return v_row;
end;
$fn$;

revoke execute on function public.record_delivery(uuid, uuid, uuid, uuid, smallint, text, smallint, text, uuid) from anon, public;
grant  execute on function public.record_delivery(uuid, uuid, uuid, uuid, smallint, text, smallint, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- undo_last_delivery — the most-used button in any scoring app.
-- ---------------------------------------------------------------------------
create or replace function public.undo_last_delivery(in_innings_id uuid)
returns integer
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  select id into v_id from public.deliveries
   where innings_id = in_innings_id order by seq desc limit 1;
  if v_id is null then raise exception 'NOTHING_TO_UNDO' using errcode = 'P0002'; end if;

  delete from public.deliveries where id = v_id;

  -- Undoing after the innings was closed reopens it, otherwise a mistaken
  -- "end innings" is unrecoverable.
  if v_i.status = 'completed' then
    update public.innings set status = 'in_progress', ended_at = null where id = in_innings_id;
  end if;
  return 1;
end;
$fn$;

revoke execute on function public.undo_last_delivery(uuid) from anon, public;
grant  execute on function public.undo_last_delivery(uuid) to authenticated;

create or replace function public.end_innings(in_innings_id uuid)
returns public.innings
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype;
begin
  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;
  update public.innings set status = 'completed', ended_at = now()
   where id = in_innings_id returning * into v_i;
  return v_i;
end;
$fn$;

revoke execute on function public.end_innings(uuid) from anon, public;
grant  execute on function public.end_innings(uuid) to authenticated;

create or replace function public.finish_match(
  in_match_id uuid, in_motm_user_id uuid default null
)
returns public.matches
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches%rowtype; v_i1 public.innings%rowtype; v_i2 public.innings%rowtype;
  v_txt text; v_a text; v_b text;
begin
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  select * into v_i1 from public.innings where match_id = in_match_id and number = 1;
  select * into v_i2 from public.innings where match_id = in_match_id and number = 2;
  if v_i2.id is null then raise exception 'SECOND_INNINGS_MISSING' using errcode = '23514'; end if;

  select name into v_a from public.teams where id = v_i1.batting_team_id;
  select name into v_b from public.teams where id = v_i2.batting_team_id;

  if v_i2.runs > v_i1.runs then
    -- Chasing side won: margin is wickets remaining, not runs.
    v_txt := v_b || ' won by ' ||
             greatest((select count(*) from public.match_players mp
                        where mp.match_id = in_match_id
                          and mp.team_id = v_i2.batting_team_id
                          and mp.status = 'confirmed') - 1 - v_i2.wickets, 0)
             || ' wickets';
  elsif v_i1.runs > v_i2.runs then
    v_txt := v_a || ' won by ' || (v_i1.runs - v_i2.runs) || ' runs';
  else
    v_txt := 'Match tied';
  end if;

  update public.matches
     set status = 'completed', result_text = v_txt,
         motm_user_id = coalesce(in_motm_user_id, motm_user_id)
   where id = in_match_id returning * into v_m;
  return v_m;
end;
$fn$;

revoke execute on function public.finish_match(uuid, uuid) from anon, public;
grant  execute on function public.finish_match(uuid, uuid) to authenticated;
