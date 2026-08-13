-- ============================================================================
-- Open challenges — auto-paired team matchmaking (goal 4 / FR-201).
--
-- A directed challenge (create_challenge) needs the opponent's invite code. An
-- OPEN challenge names no opponent: the server ranks candidate teams, offers
-- the fixture to the top N, and the first of them to accept wins.
--
-- Shape:
--   post_open_challenge()   -> challenge row, status 'open', to_team_id null
--                           -> rank_challenge_candidates() picks top N
--                           -> challenge_candidates rows + push to each owner
--   accept_open_challenge() -> row-locked, first wins, match created,
--                              losing candidates marked 'expired' + notified
--
-- Ranking uses only signals that exist today: sport, distance, roster fit and
-- schedule conflict. Reliability grade (FR-206) does not exist and is
-- deliberately not referenced — see ROADMAP.md. When it lands, extend
-- rank_challenge_candidates and nothing else changes.
--
-- Teams have no location column. It is derived from the members' home_location
-- centroid (team_location below) rather than stored, so it cannot go stale.
--
-- NOT built here, on purpose: multi-wave offers. If none of the top N accept,
-- the challenge expires at scheduled_at and the poster re-posts. Waves need a
-- scheduler and a fairness rule; neither is justified before there is enough
-- density for a first wave to ever fail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

alter table public.team_challenges alter column to_team_id drop not null;

-- Self-challenge check must tolerate the null addressee an open challenge has.
alter table public.team_challenges drop constraint if exists no_self_challenge;
alter table public.team_challenges add constraint no_self_challenge
  check (to_team_id is null or from_team_id <> to_team_id);

alter table public.team_challenges drop constraint if exists team_challenges_status_check;
alter table public.team_challenges add constraint team_challenges_status_check
  check (status in ('pending', 'open', 'accepted', 'declined', 'cancelled', 'expired'));

-- An open challenge has no addressee until someone accepts it; a directed one
-- always has. Both invariants in one place so no RPC can violate them quietly.
--
-- Consequence for accept_open_challenge: to_team_id and status must move in a
-- SINGLE update. Setting to_team_id first, while status is still 'open', would
-- trip this constraint.
alter table public.team_challenges drop constraint if exists addressee_matches_status;
alter table public.team_challenges add constraint addressee_matches_status
  check (
    (status = 'open' and to_team_id is null)
    or (status = 'pending' and to_team_id is not null)
    or status in ('accepted', 'declined', 'cancelled', 'expired')
  );

create index if not exists team_challenges_open_idx
  on public.team_challenges (scheduled_at)
  where status = 'open';

-- The offer ledger. One row per team the matcher picked, so we know who may
-- accept, why they were picked, and who to tell when the slot is taken.
create table if not exists public.challenge_candidates (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.team_challenges (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  rank         integer not null check (rank > 0),
  distance_m   double precision not null check (distance_m >= 0),
  status       text not null default 'offered'
                 check (status in ('offered', 'accepted', 'expired')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  unique (challenge_id, team_id)
);
create index if not exists challenge_candidates_team_idx
  on public.challenge_candidates (team_id, status);

alter table public.challenge_candidates enable row level security;

-- Visible to the poster's squad and to the offered squad. No INSERT/UPDATE
-- policy: the RPCs below are the only write path, same rule as team_members.
drop policy if exists "challenge_candidates_select" on public.challenge_candidates;
create policy "challenge_candidates_select" on public.challenge_candidates
  for select to authenticated
  using (
    public.is_team_member(team_id, (select auth.uid()))
    or exists (
      select 1 from public.team_challenges c
       where c.id = challenge_candidates.challenge_id
         and public.is_team_member(c.from_team_id, (select auth.uid()))
    )
  );

-- An open challenge must be readable by the teams it was offered to. The
-- existing team_challenges_select only covers from/to membership, and an open
-- challenge has no `to` yet.
--
-- team_challenges.id is qualified deliberately: challenge_candidates also has
-- an `id` column, and an unqualified `id` inside the subquery binds to the
-- INNER table, which would silently match nothing.
drop policy if exists "team_challenges_select_offered" on public.team_challenges;
create policy "team_challenges_select_offered" on public.team_challenges
  for select to authenticated
  using (
    status = 'open'
    and exists (
      select 1 from public.challenge_candidates cc
       where cc.challenge_id = team_challenges.id
         and public.is_team_member(cc.team_id, (select auth.uid()))
    )
  );

-- 'invited' — the app put you on a sheet because your squad was booked into a
-- fixture, and you have NOT said yes yet. Distinct from 'approved', which means
-- an organiser accepted a request you made. sync_filled_slots counts only
-- 'confirmed', so invited players correctly do not inflate filled_slots.
alter table public.match_players drop constraint if exists match_players_status_check;
alter table public.match_players add constraint match_players_status_check
  check (status in ('interested', 'invited', 'approved', 'rejected', 'confirmed'));

create index if not exists match_players_invited_idx
  on public.match_players (user_id)
  where status = 'invited';

-- Which side a player is on. matches carries team_a_id/team_b_id, but without
-- this the roster cannot be split into two squads — every player renders in one
-- flat list, which is what shipped. Recorded at seat time rather than inferred
-- from team_members later, because a player may leave the team after the match.
-- Null for ordinary (non-fixture) matches, which have no sides.
alter table public.match_players
  add column if not exists team_id uuid references public.teams (id) on delete set null;
create index if not exists match_players_team_idx
  on public.match_players (team_id) where team_id is not null;

-- New push kinds.
alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table public.notification_jobs add constraint notification_jobs_kind_check
  check (kind in (
    'join_requested', 'join_approved', 'join_confirmed', 'challenge_received',
    'challenge_offer', 'challenge_taken',
    'match_invited', 'match_invite_declined'
  ));

-- ---------------------------------------------------------------------------
-- 2. Team location — centroid of members' home locations.
--
-- Derived, not stored: a member joining or leaving changes it, and a stored
-- column would need a trigger on team_members to stay honest. Returns null
-- when no member has set a home location, which the matcher treats as
-- "cannot rank" rather than "distance zero".
--
-- The centroid is computed in planar degrees and cast back to geography. Over
-- one city that error is metres; it is not a distance measurement, only a
-- centre point, and the distance itself is measured on the geography type.
-- ---------------------------------------------------------------------------
create or replace function public.team_location(p_team_id uuid)
returns geography
language sql
stable
security definer
set search_path = public
as $$
  select ST_Centroid(ST_Collect(p.home_location::geometry))::geography
    from public.team_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.team_id = p_team_id
     and p.home_location is not null
     and p.is_active;
$$;

-- NOT granted to `authenticated`. This returns the centroid of a squad's home
-- addresses; exposed as an RPC it is a location-disclosure endpoint that any
-- signed-in user could call against any team id, and repeated calls as members
-- change would narrow it toward an individual's house. Only the ranking
-- function, which is SECURITY DEFINER and returns distance rather than
-- position, may call it.
revoke execute on function public.team_location(uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 3. The matcher.
--
-- Hard filters, then order by distance. Every filter is a correctness rule,
-- not a preference — a team that fails one must never be offered the fixture.
-- Returns zero rows when nothing qualifies; that is a valid answer, not an
-- error, and is the expected result until there is more than one team.
-- ---------------------------------------------------------------------------
create or replace function public.rank_challenge_candidates(
  in_challenge_id uuid,
  in_radius_m     integer default 25000,
  in_limit        integer default 5
)
returns table (team_id uuid, distance_m double precision, rank integer)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select ch.id,
           ch.from_team_id,
           ch.created_by,
           ch.scheduled_at,
           ch.total_slots,
           ft.sport   as sport,
           v.location as venue_location
      from public.team_challenges ch
      join public.teams  ft on ft.id = ch.from_team_id
      join public.venues v  on v.id  = ch.venue_id
     where ch.id = in_challenge_id
  ),
  eligible as (
    select t.id as team_id,
           ST_Distance(tl.loc, c.venue_location) as distance_m
      from public.teams t
      cross join c
      -- LATERAL so team_location is evaluated once per team, not once per
      -- reference. Also drops teams with no locatable members for free.
      join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
     where t.id <> c.from_team_id
       and t.sport = c.sport
       and public.is_active_user(t.owner_id)
       and not public.is_blocked_between(t.owner_id, c.created_by)
       and ST_DWithin(tl.loc, c.venue_location, in_radius_m)
       -- Both squads must fit on one sheet.
       and (
         (select count(distinct tm.user_id) from public.team_members tm
           where tm.team_id in (t.id, c.from_team_id))
         <= c.total_slots
       )
       -- Not already committed to a match within three hours either side.
       and not exists (
         select 1
           from public.matches m
           join public.match_players mp on mp.match_id = m.id
           join public.team_members  tm on tm.user_id  = mp.user_id
          where tm.team_id = t.id
            and mp.status = 'confirmed'
            and m.scheduled_at between c.scheduled_at - interval '3 hours'
                                   and c.scheduled_at + interval '3 hours'
       )
  )
  select e.team_id,
         e.distance_m,
         (row_number() over (order by e.distance_m asc, e.team_id asc))::integer as rank
    from eligible e
   order by e.distance_m asc, e.team_id asc
   limit greatest(in_limit, 0);
$$;

revoke execute on function public.rank_challenge_candidates(uuid, integer, integer) from anon, public;
grant  execute on function public.rank_challenge_candidates(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. finalise_challenge — the match-creation side effect, extracted.
--
-- Lifted out of respond_to_challenge so accept_open_challenge can reuse it.
-- NOT duplicated on purpose: the roster block-skip rule below has already been
-- corrected twice (see challenge_block_skip_rule), and a second copy is how
-- the two drift apart.
--
-- The opponent is a PARAMETER rather than read from the row, because an open
-- challenge cannot legally carry to_team_id while its status is still 'open'
-- (see addressee_matches_status). The caller writes both in one update after
-- this returns.
--
-- Caller must already hold the challenge row lock.
-- ---------------------------------------------------------------------------
create or replace function public.finalise_challenge(
  in_challenge_id uuid,
  in_to_team_id   uuid
)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_venue public.venues%rowtype;
  v_match public.matches%rowtype;
  v_code  text;
  v_try   int;
  v_count int;
begin
  if in_to_team_id is null then
    raise exception 'NO_OPPONENT' using errcode = '23514';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if in_to_team_id = v_c.from_team_id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  select * into v_to from public.teams where id = in_to_team_id;
  if not found then
    raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_venue from public.venues where id = v_c.venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The sheet must actually hold both squads. sync_filled_slots clamps with
  -- least(), so without this an oversized roster looks full while being
  -- silently over-subscribed.
  select count(distinct tm.user_id) into v_count
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, in_to_team_id);
  if v_count > v_c.total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  -- share_code is UNIQUE; retry on the rare collision.
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, v_venue.name, v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_venue.lat, v_venue.lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- BEHAVIOUR CHANGE (12 Aug 2026). Previously every member of both squads was
  -- inserted as 'confirmed' — the app committed twelve people's Saturday
  -- without asking any of them, and their captain found out on WhatsApp.
  --
  -- Now: the two OWNERS are confirmed, because they are the people who actually
  -- agreed the fixture. Everyone else is 'invited' and gets a push asking them
  -- to confirm. filled_slots counts only 'confirmed', so the sheet shows the
  -- number of players who have genuinely said yes.
  --
  -- The block-skip rule is unchanged: an owner is always seated, and a
  -- non-owner is skipped when blocked against anyone on the opposing side or
  -- against the match creator. Skipping keeps the fixture alive.
  -- team_id records which side each player is on, so the roster can be shown as
  -- two squads. A person who somehow belongs to BOTH teams is seated once, on
  -- whichever side the scan reaches first — the ON CONFLICT below keeps that
  -- harmless rather than raising.
  insert into public.match_players (match_id, user_id, status, joined_via, team_id)
  select v_match.id,
         tm.user_id,
         case when tm.role = 'owner' then 'confirmed' else 'invited' end,
         'challenge',
         tm.team_id
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, in_to_team_id)
     and tm.user_id <> v_c.created_by
     and (
       tm.role = 'owner'
       or (
         not public.is_blocked_between(tm.user_id, v_c.created_by)
         and not exists (
           select 1
             from public.team_members opp
            where opp.team_id = case
                                  when tm.team_id = v_c.from_team_id then in_to_team_id
                                  else v_c.from_team_id
                                end
              and public.is_blocked_between(tm.user_id, opp.user_id)
         )
       )
     )
  on conflict (match_id, user_id) do nothing;

  return v_match;
end;
$$;

revoke execute on function public.finalise_challenge(uuid, uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. respond_to_challenge — unchanged behaviour, now delegating.
--
-- Only the match-creation block changed: it calls finalise_challenge instead
-- of inlining it. Every guard, error token and status transition is identical
-- to challenge_block_skip_rule.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_challenge(
  in_challenge_id uuid,
  in_accept       boolean
)
returns public.team_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_match public.matches%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'CHALLENGE_ALREADY_ANSWERED' using errcode = '23514';
  end if;

  select * into v_to from public.teams where id = v_c.to_team_id;
  if v_to.owner_id <> v_uid then
    raise exception 'NOT_OPPONENT_OWNER' using errcode = '42501';
  end if;

  if not in_accept then
    update public.team_challenges set status = 'declined', responded_at = now()
     where id = v_c.id returning * into v_c;
    return v_c;
  end if;

  v_match := public.finalise_challenge(v_c.id, v_c.to_team_id);

  update public.team_challenges
     set status = 'accepted', responded_at = now(), match_id = v_match.id
   where id = v_c.id returning * into v_c;

  return v_c;
end;
$$;

revoke execute on function public.respond_to_challenge(uuid, boolean) from anon, public;
grant  execute on function public.respond_to_challenge(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. post_open_challenge — create, rank, offer.
--
-- Ranking runs inline rather than on a queue: it is a bounded indexed query
-- over teams, and the poster must see immediately whether anyone was found.
-- If it grows costly, move the offer step onto notification_jobs; the client
-- contract does not change.
-- ---------------------------------------------------------------------------
create or replace function public.post_open_challenge(
  in_from_team_id uuid,
  in_match_name   text,
  in_venue_id     uuid,
  in_scheduled_at timestamptz,
  in_total_slots  integer,
  in_message      text default null,
  in_radius_m     integer default 25000
)
returns public.team_challenges
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_from public.teams%rowtype;
  v_row  public.team_challenges%rowtype;
  v_cand record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_from from public.teams where id = in_from_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_from.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  if in_scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;
  if in_total_slots <= 0 then
    raise exception 'INVALID_SLOTS' using errcode = '23514';
  end if;
  if not exists (select 1 from public.venues where id = in_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- One live open challenge per team. Without this a captain can carpet the
  -- area with offers and every opponent's first accept collides.
  if exists (
    select 1 from public.team_challenges c
     where c.from_team_id = v_from.id and c.status = 'open'
  ) then
    raise exception 'OPEN_CHALLENGE_ALREADY_LIVE' using errcode = '23505';
  end if;

  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, message, status
  )
  values (
    v_from.id, null, v_uid, in_match_name,
    in_venue_id, in_scheduled_at, in_total_slots, in_message, 'open'
  )
  returning * into v_row;

  for v_cand in
    select * from public.rank_challenge_candidates(v_row.id, in_radius_m, 5)
  loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m)
    values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m);

    perform public.enqueue_notification(
      (select owner_id from public.teams where id = v_cand.team_id),
      'challenge_offer',
      'Match offer',
      v_from.name || ' wants a game. Tap to accept.',
      jsonb_build_object('route', '/teams/offers', 'challenge_id', v_row.id)
    );
  end loop;

  -- Zero candidates is a valid outcome, not an error. The challenge stays open
  -- so the poster can widen the radius or wait; nothing is rolled back. The
  -- client reads challenge_candidates to show how many were offered.
  return v_row;
end;
$$;

revoke execute on function public.post_open_challenge(uuid, text, uuid, timestamptz, integer, text, integer) from anon, public;
grant  execute on function public.post_open_challenge(uuid, text, uuid, timestamptz, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. accept_open_challenge — first accept wins.
--
-- The `for update` on the challenge row is what makes "first wins" true: two
-- captains accepting in the same second serialise, and the second finds
-- status <> 'open' and is refused cleanly rather than creating a second match.
-- ---------------------------------------------------------------------------
create or replace function public.accept_open_challenge(
  in_challenge_id uuid,
  in_team_id      uuid
)
returns public.team_challenges
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_c     public.team_challenges%rowtype;
  v_team  public.teams%rowtype;
  v_match public.matches%rowtype;
  v_loser record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'open' then
    raise exception 'CHALLENGE_ALREADY_TAKEN' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = in_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_team.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  -- Only a team the matcher offered it to may accept. Without this any team
  -- that could read the challenge id could take the fixture.
  if not exists (
    select 1 from public.challenge_candidates cc
     where cc.challenge_id = v_c.id
       and cc.team_id = in_team_id
       and cc.status = 'offered'
  ) then
    raise exception 'NOT_OFFERED' using errcode = '42501';
  end if;

  -- Raises on past schedule, missing venue, or oversized roster. Any of those
  -- aborts the transaction, leaving the challenge open and untouched.
  v_match := public.finalise_challenge(v_c.id, in_team_id);

  -- Single update: addressee_matches_status forbids to_team_id being set while
  -- status is still 'open', so these two columns must move together.
  update public.team_challenges
     set status = 'accepted',
         to_team_id = in_team_id,
         responded_at = now(),
         match_id = v_match.id
   where id = v_c.id
   returning * into v_c;

  update public.challenge_candidates
     set status = 'accepted', responded_at = now()
   where challenge_id = v_c.id and team_id = in_team_id;

  for v_loser in
    update public.challenge_candidates
       set status = 'expired', responded_at = now()
     where challenge_id = v_c.id
       and team_id <> in_team_id
       and status = 'offered'
    returning team_id
  loop
    perform public.enqueue_notification(
      (select owner_id from public.teams where id = v_loser.team_id),
      'challenge_taken',
      'Match filled',
      'Another team took that fixture.',
      jsonb_build_object('route', '/teams/challenges')
    );
  end loop;

  perform public.enqueue_notification(
    v_c.created_by,
    'challenge_received',
    'Opponent found',
    v_team.name || ' accepted your open challenge.',
    jsonb_build_object('route', '/match/' || v_match.id::text)
  );

  return v_c;
end;
$$;

revoke execute on function public.accept_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.accept_open_challenge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7b. Match invites — a player answers for themselves.
--
-- Being in a squad that got booked is not consent to give up your Saturday.
-- finalise_challenge now seats non-owners as 'invited'; this is how they
-- answer, and this is the push that asks them.
-- ---------------------------------------------------------------------------

-- Tell the player they have been put on a sheet.
create or replace function public.tg_notify_match_invited()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_when timestamptz;
begin
  if new.status <> 'invited' then
    return null;
  end if;

  select m.match_name, m.scheduled_at into v_name, v_when
    from public.matches m where m.id = new.match_id;

  perform public.enqueue_notification(
    new.user_id,
    'match_invited',
    'You are down to play',
    coalesce(v_name, 'A match') || ' — tap to confirm you can make it.',
    jsonb_build_object('route', '/match/' || new.match_id::text)
  );
  return null;
end;
$$;

drop trigger if exists match_players_notify_invited on public.match_players;
create trigger match_players_notify_invited
after insert on public.match_players
for each row execute function public.tg_notify_match_invited();

-- The player's own answer. Deliberately NOT an UPDATE policy on match_players:
-- a policy permissive enough to let you set your own row to 'confirmed' would
-- also let you set it from 'rejected' back to 'confirmed' on a match you were
-- removed from, and would need re-deriving every time the status set changes.
create or replace function public.respond_to_match_invite(
  in_match_id uuid,
  in_accept   boolean
)
returns public.match_players
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.match_players%rowtype;
  v_m   public.matches%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_row
    from public.match_players
   where match_id = in_match_id and user_id = v_uid
   for update;
  if not found then
    raise exception 'NOT_INVITED' using errcode = 'P0002';
  end if;
  if v_row.status <> 'invited' then
    raise exception 'INVITE_ALREADY_ANSWERED' using errcode = '23514';
  end if;

  select * into v_m from public.matches where id = in_match_id;
  if v_m.scheduled_at <= now() then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;

  update public.match_players
     set status = case when in_accept then 'confirmed' else 'rejected' end
   where id = v_row.id
   returning * into v_row;

  -- A decline is the organiser's problem to solve, so tell them. An accept is
  -- not news — the sheet already showed the player as expected.
  if not in_accept then
    perform public.enqueue_notification(
      v_m.creator_id,
      'match_invite_declined',
      'A player dropped out',
      coalesce(v_m.match_name, 'Your match') || ' — someone cannot make it.',
      jsonb_build_object('route', '/match/' || in_match_id::text)
    );
  end if;

  return v_row;
end;
$$;

revoke execute on function public.respond_to_match_invite(uuid, boolean) from anon, public;
grant  execute on function public.respond_to_match_invite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Expiry. An open challenge nobody took stops being offered once its start
-- time passes. Returns the number of CHALLENGES closed, not candidate rows.
-- ---------------------------------------------------------------------------
create or replace function public.expire_open_challenges()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  -- Both updates in one statement. A data-modifying CTE always runs to
  -- completion whether or not the outer query reads it, so `cleared` fires
  -- even though only `closed` is counted.
  with closed as (
    update public.team_challenges
       set status = 'expired', responded_at = now()
     where status = 'open'
       and scheduled_at <= now()
    returning id
  ),
  cleared as (
    update public.challenge_candidates cc
       set status = 'expired', responded_at = now()
      from closed
     where cc.challenge_id = closed.id
       and cc.status = 'offered'
    returning cc.id
  )
  select count(*) into v_n from closed;

  return coalesce(v_n, 0);
end;
$$;

revoke execute on function public.expire_open_challenges() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 9. Two existing RPCs assumed to_team_id was NOT NULL. Both fail SILENTLY on
-- an open challenge, which is the worst way to fail. Found by reading every
-- reference to to_team_id after making the column nullable.
-- ---------------------------------------------------------------------------

-- (a) list_my_challenges INNER JOINed teams on to_team_id, so an open
-- challenge — which has none — was dropped from the result entirely. The
-- poster could not see their own live offer on the challenges screen.
-- The 17-column signature is REPRODUCED EXACTLY. CREATE OR REPLACE cannot
-- change a function's return type — altering the column list here would abort
-- the migration with "cannot change return type of existing function", and the
-- client's generated types depend on every one of these fields.
create or replace function public.list_my_challenges()
returns table (
  id uuid, status text, direction text,
  from_team_id uuid, from_team_name text,
  to_team_id uuid, to_team_name text,
  match_name text, venue_name text, scheduled_at timestamptz,
  total_slots integer, message text, match_id uuid,
  is_expired boolean, i_can_respond boolean, i_can_cancel boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.status,
    case when public.is_team_member(c.from_team_id, (select auth.uid()))
         then 'outgoing' else 'incoming' end,
    c.from_team_id, ft.name,
    c.to_team_id,   tt.name,          -- null for an open challenge
    c.match_name, v.name, c.scheduled_at,
    c.total_slots, c.message, c.match_id,
    c.scheduled_at <= now(),
    -- i_can_respond: unchanged for directed challenges; for an open one, true
    -- when I own a team that was actually offered it.
    (
      c.status = 'pending' and c.scheduled_at > now()
        and public.is_team_owner(c.to_team_id, (select auth.uid()))
    ) or (
      c.status = 'open' and c.scheduled_at > now()
        and exists (
          select 1 from public.challenge_candidates cc
           where cc.challenge_id = c.id
             and cc.status = 'offered'
             and public.is_team_owner(cc.team_id, (select auth.uid()))
        )
    ),
    -- i_can_cancel: the poster may now withdraw an open challenge too.
    c.status in ('pending', 'open')
      and public.is_team_owner(c.from_team_id, (select auth.uid())),
    c.created_at
  from public.team_challenges c
  join public.teams  ft on ft.id = c.from_team_id
  left join public.teams tt on tt.id = c.to_team_id   -- was INNER; open has none
  join public.venues v  on v.id  = c.venue_id
  where public.is_team_member(c.from_team_id, (select auth.uid()))
     or public.is_team_member(c.to_team_id,   (select auth.uid()))
     or (
       c.status = 'open'
       and exists (
         select 1 from public.challenge_candidates cc
          where cc.challenge_id = c.id
            and public.is_team_member(cc.team_id, (select auth.uid()))
       )
     )
  order by c.created_at desc
  limit 100;
$$;

revoke execute on function public.list_my_challenges() from anon, public;
grant  execute on function public.list_my_challenges() to authenticated;

-- (b) cancel_challenge refused anything that was not 'pending', so a poster
-- could not withdraw an open challenge — no way to react to a lost ground
-- booking short of waiting for expiry. Cancelling also has to close the
-- outstanding offers, or the offered captains keep a dead Accept button.
create or replace function public.cancel_challenge(in_challenge_id uuid)
returns public.team_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_c   public.team_challenges%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status not in ('pending', 'open') then
    raise exception 'CHALLENGE_ALREADY_ANSWERED' using errcode = '23514';
  end if;
  if not public.is_team_owner(v_c.from_team_id, v_uid) then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  update public.challenge_candidates
     set status = 'expired', responded_at = now()
   where challenge_id = v_c.id
     and status = 'offered';

  update public.team_challenges
     set status = 'cancelled', responded_at = now()
   where id = v_c.id
   returning * into v_c;

  return v_c;
end;
$$;

revoke execute on function public.cancel_challenge(uuid) from anon, public;
grant  execute on function public.cancel_challenge(uuid) to authenticated;

-- Idempotent: re-running this migration must not raise on a duplicate job.
select cron.unschedule('expire-open-challenges')
 where exists (select 1 from cron.job where jobname = 'expire-open-challenges');

select cron.schedule(
  'expire-open-challenges',
  '*/15 * * * *',
  $$select public.expire_open_challenges();$$
);
