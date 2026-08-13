-- ============================================================================
-- Toss (FR-204) — who bats first.
--
-- Two RPCs rather than one, because the toss is two decisions by two different
-- people: the coin is flipped (either captain may trigger it), then the WINNER
-- alone chooses bat or bowl. Collapsing them would let the caller pick both.
--
-- Randomness is server-side and non-negotiable. A client-generated coin is not
-- a coin — the captain who flips it decides the result. `random()` inside a
-- SECURITY DEFINER function is the only place the outcome can be trusted.
--
-- Scope: cricket fixtures with two identified squads. A casual match with no
-- team_a_id/team_b_id has no captains to toss, and is refused.
-- ============================================================================

-- Overs per innings. Nullable because badminton has none, and because a match
-- created before the toss existed has not chosen a format yet.
alter table public.matches
  add column if not exists overs integer check (overs is null or overs between 1 and 50);

create table if not exists public.match_toss (
  match_id       uuid primary key references public.matches (id) on delete cascade,
  called_by      uuid not null references public.profiles (id) on delete cascade,
  winner_team_id uuid not null references public.teams (id) on delete cascade,
  outcome        text not null check (outcome in ('heads', 'tails')),
  -- Null between the flip and the winner choosing. That gap is a real state:
  -- the losing captain sees "waiting for their call".
  decision       text check (decision is null or decision in ('bat', 'bowl')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);

alter table public.match_toss enable row level security;

-- Anyone on the sheet can see the toss. No INSERT/UPDATE policy — the RPCs are
-- the only write path, same rule as every other table in this schema.
drop policy if exists "match_toss_select" on public.match_toss;
create policy "match_toss_select" on public.match_toss
  for select to authenticated
  using (
    public.is_match_creator(match_id, (select auth.uid()))
    or public.is_match_player(match_id, (select auth.uid()))
  );

alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check (kind in (
    'join_requested', 'join_approved', 'join_confirmed', 'challenge_received',
    'challenge_offer', 'challenge_taken',
    'match_invited', 'match_invite_declined',
    'toss_ready', 'toss_done'
  ));

-- ---------------------------------------------------------------------------
-- Is this user the owner of one of the two squads in this fixture?
-- ---------------------------------------------------------------------------
create or replace function public.is_match_captain(p_match_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.matches m
      join public.teams t on t.id in (m.team_a_id, m.team_b_id)
     where m.id = p_match_id
       and t.owner_id = p_uid
  );
$fn$;

revoke execute on function public.is_match_captain(uuid, uuid) from anon, public;
grant  execute on function public.is_match_captain(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- perform_toss — flip the coin. Either captain may trigger it; the result is
-- decided here and cannot be re-rolled.
-- ---------------------------------------------------------------------------
create or replace function public.perform_toss(
  in_match_id uuid,
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_m      public.matches%rowtype;
  v_row    public.match_toss%rowtype;
  v_winner uuid;
  v_heads  boolean;
  v_cap    record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Lock the match so two captains tapping "Flip" at once cannot both insert.
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.team_a_id is null or v_m.team_b_id is null then
    raise exception 'NOT_A_FIXTURE' using errcode = '23514';
  end if;
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  if not public.is_match_captain(in_match_id, v_uid) then
    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  -- Idempotent: a second tap returns the existing toss rather than re-rolling.
  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  v_heads  := (random() < 0.5);
  v_winner := case when v_heads then v_m.team_a_id else v_m.team_b_id end;

  insert into public.match_toss (match_id, called_by, winner_team_id, outcome)
  values (in_match_id, v_uid, v_winner, case when v_heads then 'heads' else 'tails' end)
  returning * into v_row;

  -- Tell both captains. The winner needs to choose; the loser needs to know why
  -- nothing is happening yet.
  for v_cap in
    select t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      case when v_cap.won then 'You won the toss' else 'Toss done' end,
      case when v_cap.won
           then 'Choose to bat or bowl.'
           else 'The other captain is choosing bat or bowl.' end,
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.perform_toss(uuid, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- set_toss_decision — the winning captain chooses. Once only.
-- ---------------------------------------------------------------------------
create or replace function public.set_toss_decision(
  in_match_id uuid,
  in_decision text
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_row   public.match_toss%rowtype;
  v_team  public.teams%rowtype;
  v_m     public.matches%rowtype;
  v_other uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if in_decision not in ('bat', 'bowl') then
    raise exception 'INVALID_DECISION' using errcode = '23514';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_DONE' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'DECISION_ALREADY_MADE' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = v_row.winner_team_id;
  if v_team.owner_id <> v_uid then
    raise exception 'NOT_TOSS_WINNER' using errcode = '42501';
  end if;

  update public.match_toss
     set decision = in_decision, decided_at = now()
   where match_id = in_match_id
   returning * into v_row;

  select * into v_m from public.matches where id = in_match_id;
  select t.owner_id into v_other
    from public.teams t
   where t.id in (v_m.team_a_id, v_m.team_b_id)
     and t.id <> v_row.winner_team_id;

  perform public.enqueue_notification(
    v_other,
    'toss_done',
    'Toss decided',
    v_team.name || ' chose to ' || in_decision || ' first.',
    jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
  );

  return v_row;
end;
$fn$;

revoke execute on function public.set_toss_decision(uuid, text) from anon, public;
grant  execute on function public.set_toss_decision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_toss — toss plus the two team names, which `teams` RLS would otherwise
-- hide from the opposing squad. Same reason list_match_players exists.
-- ---------------------------------------------------------------------------
create or replace function public.get_toss(in_match_id uuid)
returns table (
  match_id uuid,
  winner_team_id uuid,
  winner_team_name text,
  outcome text,
  decision text,
  overs integer,
  batting_team_id uuid,
  bowling_team_id uuid,
  i_am_captain boolean,
  i_am_winner boolean,
  created_at timestamptz,
  decided_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select mt.match_id,
         mt.winner_team_id,
         w.name,
         mt.outcome,
         mt.decision,
         m.overs,
         -- Resolve the decision into concrete sides so no client has to.
         case when mt.decision is null then null
              when mt.decision = 'bat' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end,
         case when mt.decision is null then null
              when mt.decision = 'bowl' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end,
         public.is_match_captain(mt.match_id, (select auth.uid())),
         w.owner_id = (select auth.uid()),
         mt.created_at,
         mt.decided_at
    from public.match_toss mt
    join public.matches m on m.id = mt.match_id
    join public.teams   w on w.id = mt.winner_team_id
   where mt.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     );
$fn$;

revoke execute on function public.get_toss(uuid) from anon, public;
grant  execute on function public.get_toss(uuid) to authenticated;
