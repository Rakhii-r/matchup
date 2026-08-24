-- Post a Match (Open for all) — a second, genuinely different creation engine.
--
-- Until now both wizard match types submitted through post_open_challenge, so
-- "Post a Match" was a Team Vs Team challenge wearing a different label: it
-- demanded a team you own, it created a team_challenges row, and it sent the
-- organiser to the opponent radar. An open match has no Team A, no Team B and
-- no opponent — individual players discover it and take a seat directly.
--
-- The two flows stay separate on purpose. Nothing here changes how a challenge
-- is posted, ranked, offered or accepted; every new rule is gated on
-- matches.match_type = 'open', which no pre-existing row has.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

-- Which engine created this fixture. Every existing row came from
-- finalise_challenge, so the default backfills them correctly.
alter table public.matches
  add column if not exists match_type text not null default 'team_vs_team';

alter table public.matches
  drop constraint if exists matches_match_type_check;
alter table public.matches
  add constraint matches_match_type_check
  check (match_type in ('team_vs_team', 'open'));

create index if not exists matches_open_type_idx
  on public.matches (match_type) where match_type = 'open';

-- Why this person is on the sheet. 'creator' is the host; everyone else is a
-- player. This is display metadata only — every authority check still reads
-- matches.creator_id, never this column.
alter table public.match_players
  add column if not exists role text not null default 'player';

alter table public.match_players
  drop constraint if exists match_players_role_check;
alter table public.match_players
  add constraint match_players_role_check
  check (role in ('creator', 'player'));

-- match_players already carries UNIQUE (match_id, user_id) from the phase 1
-- schema, which is what makes a double join impossible at the database level.
-- Restated here so a reader does not go looking for it.

-- ---------------------------------------------------------------------------
-- How many seats a match actually has taken
-- ---------------------------------------------------------------------------
-- The old rule was "1 for the creator, plus one per confirmed player", because
-- finalise_challenge deliberately writes NO match_players row for the person
-- who posted the challenge. An open match must show its host in the roster, so
-- it DOES write that row — and the implicit +1 would then count them twice.
create or replace function public.match_occupied_slots(in_match_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*)::int
      from public.match_players mp
     where mp.match_id = in_match_id
       and mp.status = 'confirmed'
  ) + (
    select case when exists (
      select 1
        from public.match_players mp
        join public.matches m on m.id = mp.match_id
       where mp.match_id = in_match_id
         and mp.user_id = m.creator_id
         and mp.status = 'confirmed'
    ) then 0 else 1 end
  );
$$;

revoke execute on function public.match_occupied_slots(uuid) from anon, authenticated, public;

-- Same trigger, same clamp; the count now comes from the helper above.
-- missing_count is maintained only for open matches: on a team fixture it is
-- written as 0 by finalise_challenge and nothing else touches it, and keeping
-- that untouched is what guarantees the challenge flow is unaffected.
create or replace function public.sync_filled_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid      uuid := coalesce(new.match_id, old.match_id);
  occupied integer;
begin
  occupied := public.match_occupied_slots(mid);

  update public.matches m
     set filled_slots  = least(occupied, m.total_slots),
         missing_count = case
           when m.match_type = 'open'
             then greatest(m.total_slots - least(occupied, m.total_slots), 0)
           else m.missing_count
         end
   where m.id = mid;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-player double-booking
-- ---------------------------------------------------------------------------
-- The team equivalent is team_schedule_conflict (20260817080000). This is the
-- same idea for an individual, and the same rule: holding another commitment is
-- fine, OVERLAPPING one is not. 19 Aug 3-5pm and 20 Aug 3-5pm both stand;
-- 19 Aug 3-5pm and 19 Aug 4-6pm do not.
--
-- A commitment is a match you created or are confirmed on, in a live state.
-- 'interested', 'invited', 'approved' and 'rejected' are not commitments —
-- nobody is holding your evening for a request the organiser has not accepted.
-- A row with no end_time is assumed to run 3 hours, the same buffer
-- team_schedule_conflict uses.
create or replace function public.player_schedule_conflict(
  p_user_id          uuid,
  p_start            timestamptz,
  p_end              timestamptz,
  p_exclude_match_id uuid default null
)
returns table (match_id uuid, scheduled_at timestamptz, end_time timestamptz, match_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id,
         m.scheduled_at,
         coalesce(m.end_time, m.scheduled_at + interval '3 hours'),
         m.match_name
    from public.matches m
   where m.status in ('open', 'locked')
     and (p_exclude_match_id is null or m.id <> p_exclude_match_id)
     and (
       m.creator_id = p_user_id
       or exists (
         select 1
           from public.match_players mp
          where mp.match_id = m.id
            and mp.user_id  = p_user_id
            and mp.status   = 'confirmed'
       )
     )
     and p_start < coalesce(m.end_time, m.scheduled_at + interval '3 hours')
     and p_end   > m.scheduled_at
   order by m.scheduled_at asc
   limit 1;
$$;

-- Internal only, same reasoning as team_schedule_conflict: this discloses when
-- a given user is busy. Only the SECURITY DEFINER RPCs below may call it.
revoke execute on function public.player_schedule_conflict(uuid, timestamptz, timestamptz, uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- create_open_match — the whole Post a Match submit, in one statement
-- ---------------------------------------------------------------------------
-- No team is read, written or required. The creator takes seat one immediately,
-- as a real match_players row with role 'creator', which is what lets the
-- roster show a host at all.
create or replace function public.create_open_match(
  in_sport        text,
  in_match_name   text,
  in_venue_id     uuid,
  in_scheduled_at timestamptz,
  in_total_slots  integer,
  in_end_time     timestamptz default null,
  in_game_type    text default 'friendly',
  in_radius_m     integer default 25000
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_venue    public.venues%rowtype;
  v_match    public.matches%rowtype;
  v_end      timestamptz;
  v_code     text;
  v_try      integer;
  v_conflict record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if in_sport not in ('box_cricket', 'badminton') then
    raise exception 'INVALID_SPORT' using errcode = '23514';
  end if;
  if in_game_type not in ('friendly', 'competitive') then
    raise exception 'INVALID_GAME_TYPE' using errcode = '23514';
  end if;
  if in_total_slots < 2 or in_total_slots > 40 then
    raise exception 'INVALID_SLOTS' using errcode = '23514';
  end if;
  if in_radius_m < 1000 or in_radius_m > 50000 then
    raise exception 'INVALID_RADIUS' using errcode = '23514';
  end if;
  if in_scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;
  if in_end_time is not null and in_end_time <= in_scheduled_at then
    raise exception 'END_BEFORE_START' using errcode = '23514';
  end if;

  select * into v_venue from public.venues where id = in_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (in_sport = any (v_venue.sport_types)) then
    raise exception 'VENUE_SPORT_MISMATCH' using errcode = '23514';
  end if;

  v_end := coalesce(in_end_time, in_scheduled_at + interval '3 hours');

  -- Serialises this check-then-insert against the same user posting or joining
  -- concurrently, so two overlapping matches cannot both pass the check.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select * into v_conflict
    from public.player_schedule_conflict(v_uid, in_scheduled_at, v_end);
  if found then
    raise exception '%', format(
      'PLAYER_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time    at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  -- share_code is UNIQUE; retry on the rare collision, same as elsewhere.
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, scheduled_at, end_time,
        total_slots, missing_count, share_code, lat, lng, match_name,
        game_type, search_radius_m, match_type
      )
      values (
        v_uid, in_sport, v_venue.id, v_venue.name, in_scheduled_at, in_end_time,
        in_total_slots, in_total_slots - 1, v_code, v_venue.lat, v_venue.lng, in_match_name,
        in_game_type, in_radius_m, 'open'
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, status, joined_via, role)
  values (v_match.id, v_uid, 'confirmed', 'browse', 'creator');

  -- sync_filled_slots has just moved filled_slots/missing_count on the row we
  -- are holding in v_match, so re-read rather than return a stale 0/1.
  select * into v_match from public.matches where id = v_match.id;
  return v_match;
end;
$$;

revoke execute on function public.create_open_match(text, text, uuid, timestamptz, integer, timestamptz, text, integer)
  from anon, public;
grant execute on function public.create_open_match(text, text, uuid, timestamptz, integer, timestamptz, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- join_open_match — an individual takes a seat, with no approval step
-- ---------------------------------------------------------------------------
-- Deliberately NOT the join_match queue. join_match lands you as 'interested'
-- and waits for the organiser to approve and confirm you; an open match is
-- advertised as open, so the seat is yours the moment you take it and you go
-- straight to 'confirmed', which is the only status that moves filled_slots.
create or replace function public.join_open_match(
  in_match_id   uuid,
  in_joined_via text default 'browse'
)
returns public.match_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_existing public.match_players%rowtype;
  v_row      public.match_players%rowtype;
  v_end      timestamptz;
  v_conflict record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if in_joined_via not in ('code', 'browse', 'alert') then
    raise exception 'INVALID_JOIN_SOURCE' using errcode = '23514';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- FOR UPDATE serialises concurrent joins on this match: the second caller
  -- blocks here until the first commits, so it sees the true seat count and the
  -- last seat cannot be sold twice.
  select * into v_match from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if public.is_blocked_between(v_uid, v_match.creator_id) then
    -- Indistinguishable from "not found" on purpose: never confirm to a blocked
    -- user that a specific match or organiser exists.
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_match.match_type <> 'open' then
    raise exception 'NOT_OPEN_MATCH' using errcode = '23514';
  end if;

  -- Idempotent. Covers the double tap, and covers the creator, who already
  -- holds a row from create_open_match — both get the existing row back
  -- unchanged rather than a second seat or an error.
  select * into v_existing
    from public.match_players
   where match_id = in_match_id and user_id = v_uid;
  if found then
    return v_existing;
  end if;

  if v_match.status <> 'open' then
    raise exception 'MATCH_NOT_OPEN' using errcode = '23514';
  end if;
  if v_match.scheduled_at <= now() then
    raise exception 'MATCH_STARTED' using errcode = '23514';
  end if;
  if public.match_occupied_slots(in_match_id) >= v_match.total_slots then
    raise exception 'MATCH_FULL' using errcode = '23514';
  end if;

  v_end := coalesce(v_match.end_time, v_match.scheduled_at + interval '3 hours');

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select * into v_conflict
    from public.player_schedule_conflict(v_uid, v_match.scheduled_at, v_end, v_match.id);
  if found then
    raise exception '%', format(
      'PLAYER_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time    at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  insert into public.match_players (match_id, user_id, status, joined_via, role)
  values (in_match_id, v_uid, 'confirmed', in_joined_via, 'player')
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.join_open_match(uuid, text) from anon, public;
grant execute on function public.join_open_match(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- join_match — unchanged for every existing match, delegates for an open one
-- ---------------------------------------------------------------------------
-- Same signature and same body as 20260803070000, with one branch added right
-- after the match is loaded. "Join with code" (app/match/join.tsx) and the
-- nearby card both go through here, and an open match reached by either route
-- must get a seat, not a queue position. Delegating rather than duplicating
-- keeps the two sets of rules in one place each.
create or replace function public.join_match(
  in_match_id   uuid,
  in_joined_via text default 'browse'
)
returns public.match_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_match     public.matches%rowtype;
  v_existing  public.match_players%rowtype;
  v_inserted  public.match_players%rowtype;
  v_confirmed integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if in_joined_via not in ('code', 'browse', 'alert') then
    raise exception 'INVALID_JOIN_SOURCE' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active
  ) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- FOR UPDATE serialises concurrent joins on the same match.
  select * into v_match
  from public.matches
  where id = in_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Post a Match: open to all, no approval queue. join_open_match re-takes the
  -- same row lock inside this transaction, which is free — we already hold it.
  if v_match.match_type = 'open' then
    return public.join_open_match(in_match_id, in_joined_via);
  end if;

  if v_match.creator_id = v_uid then
    raise exception 'OWN_MATCH' using errcode = '42501';
  end if;

  if public.is_blocked_between(v_uid, v_match.creator_id) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_match.status <> 'open' then
    raise exception 'MATCH_NOT_OPEN' using errcode = '23514';
  end if;

  if v_match.scheduled_at <= now() then
    raise exception 'MATCH_STARTED' using errcode = '23514';
  end if;

  select * into v_existing
  from public.match_players
  where match_id = in_match_id and user_id = v_uid;

  if found then
    return v_existing;
  end if;

  select count(*) into v_confirmed
  from public.match_players
  where match_id = in_match_id and status = 'confirmed';

  if (1 + v_confirmed) >= v_match.total_slots then
    raise exception 'MATCH_FULL' using errcode = '23514';
  end if;

  insert into public.match_players (match_id, user_id, status, joined_via)
  values (in_match_id, v_uid, 'interested', in_joined_via)
  returning * into v_inserted;

  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- nearby_matches — honour the poster's own search distance
-- ---------------------------------------------------------------------------
-- The Search Distance chips on Step 3 write matches.search_radius_m. Without
-- this clause the value was stored and never read, so the chips were decoration.
-- A match is now discoverable when the viewer is inside BOTH the radius they
-- are browsing with and the radius the poster advertised.
--
-- finalise_challenge does not copy search_radius_m onto the match it creates,
-- so it is null on every team fixture and this clause is a no-op for them.
create or replace function public.nearby_matches(
  in_lat      double precision,
  in_lng      double precision,
  in_radius_m integer default 5000,
  in_sport    text default null
)
returns setof public.matches
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.matches m
  where m.status = 'open'
    and m.scheduled_at > now() - interval '6 hours'
    and (in_sport is null or m.sport = in_sport)
    and ST_DWithin(
          m.location,
          ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
          in_radius_m)
    and (
      m.search_radius_m is null
      or ST_DWithin(
           m.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
           m.search_radius_m)
    )
    and not public.is_blocked_between(auth.uid(), m.creator_id)
  order by m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
  limit 50;
$$;

-- ---------------------------------------------------------------------------
-- list_match_players — carry the role, and put the host first
-- ---------------------------------------------------------------------------
-- Adding a column to the result changes the signature, so this is a drop and
-- recreate rather than a replace. The visibility rule is copied verbatim from
-- 20260813133147: the organiser sees the whole queue, anyone seated sees the
-- seated squads, everyone else sees only themselves. An open-match joiner is
-- 'confirmed', i.e. seated, so they see the full roster — which is what makes
-- the Players list work for players as well as the host.
drop function if exists public.list_match_players(uuid);

create function public.list_match_players(in_match_id uuid)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  area_name text,
  avatar_url text,
  status text,
  joined_via text,
  role text,
  team_id uuid,
  team_name text,
  side text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select mp.id,
         mp.user_id,
         p.full_name,
         p.area_name,
         p.avatar_url,
         mp.status,
         mp.joined_via,
         mp.role,
         mp.team_id,
         t.name,
         case
           when mp.team_id is null       then null
           when mp.team_id = m.team_a_id then 'a'
           when mp.team_id = m.team_b_id then 'b'
           else null
         end,
         mp.created_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.teams t on t.id = mp.team_id
    left join public.profiles p on p.id = mp.user_id
   where mp.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or (
         mp.status in ('confirmed', 'invited', 'approved')
         and public.is_seated_match_player(in_match_id, (select auth.uid()))
       )
       or mp.user_id = (select auth.uid())
     )
   order by
     -- Host first. A no-op on a team fixture, where finalise_challenge writes
     -- no row for the creator at all.
     case when mp.user_id = m.creator_id then 0 else 1 end,
     case when mp.team_id = m.team_a_id then 0
          when mp.team_id = m.team_b_id then 1
          else 2 end,
     mp.created_at asc;
$$;

revoke execute on function public.list_match_players(uuid) from anon, public;
grant execute on function public.list_match_players(uuid) to authenticated;
