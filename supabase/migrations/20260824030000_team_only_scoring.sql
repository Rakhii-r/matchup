-- ============================================================================
-- Team-only scoring.
--
-- The live scoring screen no longer asks who is on strike, who is at the other
-- end, or who is bowling. The scorer taps runs, extras and wickets; that is the
-- whole input. Box-cricket sides are picked on the ground and most of the sheet
-- never reaches `confirmed`, so the player pickers were permanently empty and
-- the keypad could not be enabled at all.
--
-- Consequence, stated plainly: a ball recorded this way is not attributable to
-- a player, so it produces no batting or bowling figures. Innings totals, overs
-- and wickets are unaffected — `sync_innings_totals` counts `wicket_type`, not
-- `out_player_id`.
--
-- Nothing here is destructive. Existing deliveries keep their striker, bowler
-- and out player, and the two card read models still report them correctly for
-- those matches.
-- ============================================================================

alter table public.deliveries alter column striker_id drop not null;
alter table public.deliveries alter column bowler_id  drop not null;

-- A wicket no longer has to name the batter who got out.
alter table public.deliveries drop constraint if exists wicket_needs_player;

-- ---------------------------------------------------------------------------
-- record_delivery — unchanged except that the WICKET_NEEDS_PLAYER guard is
-- gone. The signature is identical, so no grant or client change is needed.
--
-- `in_striker_id = in_non_striker_id` is already null-safe: with either side
-- null the comparison is NULL and the branch does not fire.
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

-- ---------------------------------------------------------------------------
-- The two card read models now skip unattributed balls rather than grouping
-- them into one nameless row. A match scored team-only returns no rows; a match
-- scored with players is reported exactly as before.
-- ---------------------------------------------------------------------------
create or replace function public.get_batting_card(in_innings_id uuid)
returns table (
  user_id uuid, full_name text, runs integer, balls integer,
  fours integer, sixes integer, strike_rate numeric,
  is_out boolean, wicket_type text
)
language sql stable security definer set search_path = public
as $fn$
  select b.striker_id,
         p.full_name,
         sum(b.runs_off_bat)::integer,
         count(*) filter (where b.extra_type is distinct from 'wide')::integer,
         count(*) filter (where b.runs_off_bat = 4)::integer,
         count(*) filter (where b.runs_off_bat = 6)::integer,
         round(
           100.0 * sum(b.runs_off_bat)
           / nullif(count(*) filter (where b.extra_type is distinct from 'wide'), 0), 2),
         bool_or(o.out_player_id is not null),
         max(o.wicket_type)
    from public.deliveries b
    left join public.profiles p on p.id = b.striker_id
    left join lateral (
      select d2.wicket_type, d2.out_player_id
        from public.deliveries d2
       where d2.innings_id = b.innings_id and d2.out_player_id = b.striker_id
       limit 1
    ) o on true
   where b.innings_id = in_innings_id
     and b.striker_id is not null
     and exists (
       select 1 from public.innings i
        where i.id = in_innings_id
          and (
            public.is_match_creator(i.match_id, (select auth.uid()))
            or public.is_match_player(i.match_id, (select auth.uid()))
          )
     )
   group by b.striker_id, p.full_name
   order by sum(b.runs_off_bat) desc;
$fn$;

create or replace function public.get_bowling_card(in_innings_id uuid)
returns table (
  user_id uuid, full_name text, legal_balls integer,
  overs_text text, runs integer, wickets integer, economy numeric
)
language sql stable security definer set search_path = public
as $fn$
  with agg as (
    select d.bowler_id,
           count(*) filter (
             where d.extra_type is null or d.extra_type in ('bye', 'leg_bye')
           )::integer as legal_balls,
           (sum(d.runs_off_bat)
            + coalesce(sum(d.extra_runs) filter (
                where d.extra_type in ('wide', 'no_ball')), 0))::integer as runs,
           count(*) filter (
             where d.wicket_type is not null and d.wicket_type <> 'run_out'
           )::integer as wickets
      from public.deliveries d
     where d.innings_id = in_innings_id
       and d.bowler_id is not null
       and exists (
         select 1 from public.innings i
          where i.id = in_innings_id
            and (
              public.is_match_creator(i.match_id, (select auth.uid()))
              or public.is_match_player(i.match_id, (select auth.uid()))
            )
       )
     group by d.bowler_id
  )
  select a.bowler_id, p.full_name, a.legal_balls,
         (a.legal_balls / 6)::text || '.' || (a.legal_balls % 6)::text,
         a.runs, a.wickets,
         round(6.0 * a.runs / nullif(a.legal_balls, 0), 2)
    from agg a
    left join public.profiles p on p.id = a.bowler_id
   order by a.wickets desc, a.runs asc;
$fn$;
