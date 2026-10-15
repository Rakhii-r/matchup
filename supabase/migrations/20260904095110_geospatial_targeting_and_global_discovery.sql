-- ============================================================================
-- Milestone 1: Geospatial Play-Zone Targeting, Public Discovery & Offers Deduplication
--
-- 1. nearby_matches:
--    - Optional lat, lng, radius_m, sport.
--    - When coordinates and positive radius are provided: filters by ST_DWithin and
--      orders by distance.
--    - When coordinates are provided without radius: returns open matches globally
--      ordered by distance.
--    - When coordinates are null: returns open matches globally ordered by scheduled_at asc.
--    - Omits creator search_radius_m lockout from in-app viewing query so all open
--      matches are discoverable globally.
--    - Granted to authenticated, anon.
--
-- 2. list_open_challenges_nearby:
--    - Optional in_team_size, in_lat, in_lng, in_radius_m, in_sport.
--    - Distance browsing is global when radius is null/<=0, but the FORMAT LOCK STAYS.
--      Reconciled 4 Sep 2026: the draft of this migration made the format filter
--      optional (in_team_size is null or ...) and removed the early exit, so a
--      caller that sent no format got every format back. That reopens exactly
--      the cross-format path 20260904092956 closed -- a 4 v 4 side seeing 6 v 6
--      fixtures it can neither challenge nor accept -- and it moved the rule
--      back into the client, where a stale build can skip it.
--      Global browsing by DISTANCE is a product choice and is kept. Browsing
--      across FORMATS is not: null in_team_size returns nothing, as before.
--    - Distance filter is optional: (in_radius_m is null or <= 0 or loc is null or ST_DWithin).
--    - Granted to authenticated, anon.
--
-- 3. rank_challenge_candidates:
--    - Robust origin location fallback: venue -> match coordinates -> posting squad centroid
--      -> creator profile home_location.
--    - STRICT radius enforcement: ST_DWithin(tl.loc, c.origin_location, coalesce(in_radius_m, 25000)).
--    - Captain deduplication: DISTINCT ON (t.owner_id) picks the single closest eligible
--      squad per captain.
--    - Granted to authenticated.
--
-- 4. post_open_challenge:
--    - Enqueues challenge_offer push notifications strictly once per unique captain
--      using v_notified_users uuid[] tracking array.
--    - Granted to authenticated.
--
-- 5. decline_open_challenge:
--    - Cascades decline across all squads owned by the calling captain for that fixture
--      to eliminate zombie candidate offers.
--    - Granted to authenticated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. nearby_matches (Global & Geospatial Public Match Discovery)
-- ---------------------------------------------------------------------------
drop function if exists public.nearby_matches(double precision, double precision, integer, text);

create or replace function public.nearby_matches(
  in_lat      double precision default null,
  in_lng      double precision default null,
  in_radius_m integer default null,
  in_sport    text default null
)
returns setof public.matches
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if in_lat is not null and in_lng is not null and in_radius_m is not null and in_radius_m > 0 then
    -- Coordinates and radius provided: strictly filter within radius and sort by distance
    -- Note: m.search_radius_m is omitted to allow open public in-app discovery
    return query
    select m.*
      from public.matches m
     where m.status = 'open'
       and m.scheduled_at > now() - interval '6 hours'
       and (in_sport is null or m.sport = in_sport)
       and ST_DWithin(
             m.location,
             ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
             in_radius_m
           )
       and not public.is_blocked_between(auth.uid(), m.creator_id)
     order by
       m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
       m.scheduled_at asc
     limit 50;

  elsif in_lat is not null and in_lng is not null then
    -- Coordinates provided without radius restriction (e.g. "All" distance): sort by distance globally
    return query
    select m.*
      from public.matches m
     where m.status = 'open'
       and m.scheduled_at > now() - interval '6 hours'
       and (in_sport is null or m.sport = in_sport)
       and not public.is_blocked_between(auth.uid(), m.creator_id)
     order by
       m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
       m.scheduled_at asc
     limit 50;

  else
    -- Coordinates absent: return all open matches globally sorted chronologically
    return query
    select m.*
      from public.matches m
     where m.status = 'open'
       and m.scheduled_at > now() - interval '6 hours'
       and (in_sport is null or m.sport = in_sport)
       and not public.is_blocked_between(auth.uid(), m.creator_id)
     order by m.scheduled_at asc
     limit 50;
  end if;
end;
$$;

revoke execute on function public.nearby_matches(double precision, double precision, integer, text) from public;
grant  execute on function public.nearby_matches(double precision, double precision, integer, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. list_open_challenges_nearby (Global Open Fixture Discovery)
-- ---------------------------------------------------------------------------
drop function if exists public.list_open_challenges_nearby(double precision, double precision, integer, text, integer);
drop function if exists public.list_open_challenges_nearby(double precision, double precision, integer, text);

create or replace function public.list_open_challenges_nearby(
  in_lat       double precision default null,
  in_lng       double precision default null,
  in_radius_m  integer default null,
  in_sport     text default null,
  in_team_size integer default null
)
returns table (
  challenge_id uuid,
  match_name text,
  from_team_id uuid,
  from_team_name text,
  from_team_logo text,
  sport text,
  venue_id uuid,
  venue_name text,
  area_name text,
  scheduled_at timestamptz,
  total_slots integer,
  message text,
  distance_m double precision,
  created_at timestamptz,
  applied_status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_user_loc geography := null;
begin
  -- No declared format, no opponents. "I have not told you my format" is not
  -- "show me everything": the caller has no team, or a captain has not declared
  -- a format, and neither is a licence to list fixtures they cannot legally
  -- accept. The screens render a format-specific empty state instead.
  if in_team_size is null then
    return;
  end if;

  if in_lat is not null and in_lng is not null then
    v_user_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  with rows_with_loc as (
    select
      c.*,
      t.name as t_name, t.logo_url as t_logo, t.sport as t_sport, t.owner_id as t_owner,
      v.name as v_name, v.address as v_address,
      coalesce(
        v.location,
        case
          when c.match_lat is not null and c.match_lng is not null
            then ST_SetSRID(ST_MakePoint(c.match_lng, c.match_lat), 4326)::geography
          else public.team_location(c.from_team_id)
        end
      ) as loc
    from public.team_challenges c
    join public.teams t on t.id = c.from_team_id
    left join public.venues v on v.id = c.venue_id
  )
  select
    r.id as challenge_id,
    r.match_name,
    r.from_team_id,
    r.t_name as from_team_name,
    r.t_logo as from_team_logo,
    r.t_sport as sport,
    r.venue_id,
    coalesce(r.v_name, r.area_name, 'Local Area') as venue_name,
    coalesce(r.area_name, r.v_address, 'Local Area') as area_name,
    r.scheduled_at,
    r.total_slots,
    r.message,
    case
      when v_user_loc is not null and r.loc is not null then ST_Distance(v_user_loc, r.loc)
      else 0::double precision
    end as distance_m,
    r.created_at,
    (
      select cc.status
        from public.challenge_candidates cc
        join public.teams my_t on my_t.id = cc.team_id
       where cc.challenge_id = r.id
         and v_uid is not null
         and my_t.owner_id = v_uid
       order by cc.created_at desc
       limit 1
    ) as applied_status
  from rows_with_loc r
  where r.status = 'open'
    and r.scheduled_at > now()
    -- STRICT FORMAT, not optional: 4 v 4 sees 4 v 4. The null case never reaches
    -- here (early return above); this is the equality itself.
    and public.challenge_format(r.total_slots) = in_team_size
    and (in_sport is null or r.t_sport = in_sport)
    -- Exclude own team's fixtures
    and r.t_owner <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.team_members tm
       where tm.team_id = r.from_team_id and v_uid is not null and tm.user_id = v_uid
    )
    -- Distance filter: optional, allows global browsing when radius is null or <= 0
    and (
      in_radius_m is null
      or in_radius_m <= 0
      or v_user_loc is null
      or r.loc is null
      or ST_DWithin(v_user_loc, r.loc, in_radius_m)
    )
  order by
    case
      when v_user_loc is not null and r.loc is not null then ST_Distance(v_user_loc, r.loc)
      else null
    end asc nulls last,
    r.scheduled_at asc
  limit 50;
end;
$function$;

-- authenticated only. An anon caller owns no team, therefore has no declared
-- format, therefore gets nothing from this function anyway -- and granting it
-- would advertise every squad's fixtures to the unauthenticated internet.
revoke execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text, integer) from public, anon;
grant  execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. rank_challenge_candidates (Geospatial Targeting & Captain Deduplication)
-- ---------------------------------------------------------------------------
drop function if exists public.rank_challenge_candidates(uuid, integer, integer);

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
as $function$
  with c as (
    select ch.id,
           ch.from_team_id,
           ch.created_by,
           ch.scheduled_at,
           ch.total_slots,
           ft.sport as sport,
           -- Robust origin location fallback: venue -> coordinates -> squad centroid -> creator home location
           coalesce(
             v.location,
             case when ch.match_lng is not null and ch.match_lat is not null
                  then ST_SetSRID(ST_MakePoint(ch.match_lng, ch.match_lat), 4326)::geography
                  else coalesce(
                    public.team_location(ch.from_team_id),
                    (select p.home_location from public.profiles p where p.id = ch.created_by)
                  )
             end
           ) as origin_location
      from public.team_challenges ch
      join public.teams  ft on ft.id = ch.from_team_id
      left join public.venues v  on v.id  = ch.venue_id
     where ch.id = in_challenge_id
  ),
  eligible as (
    -- DISTINCT ON (t.owner_id) picks the single closest eligible team for each captain/owner
    select distinct on (t.owner_id)
           t.id as team_id,
           t.owner_id,
           ST_Distance(tl.loc, c.origin_location) as distance_m
      from public.teams t
      cross join c
      join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
     where t.id <> c.from_team_id
       and t.sport = c.sport
       -- STRICT FORMAT: A 4 v 4 fixture ranks 4 v 4 teams and nothing else.
       and t.target_size = public.challenge_format(c.total_slots)
       -- And it must be able to field that format today, not in principle.
       and (select count(*) from public.team_members tm where tm.team_id = t.id)
             >= public.challenge_format(c.total_slots)
       -- You cannot play yourself: not another team you own, not a team you are in
       and t.owner_id <> c.created_by
       and not public.is_team_member(t.id, c.created_by)
       and not exists (
         select 1
           from public.team_members tm1
           join public.team_members tm2 on tm1.user_id = tm2.user_id
          where tm1.team_id = c.from_team_id
            and tm2.team_id = t.id
       )
       and public.is_active_user(t.owner_id)
       and not public.is_blocked_between(t.owner_id, c.created_by)
       and c.origin_location is not null
       -- STRICT play-zone radius enforcement
       and ST_DWithin(tl.loc, c.origin_location, coalesce(in_radius_m, 25000))
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
     order by t.owner_id, ST_Distance(tl.loc, c.origin_location) asc
  )
  select e.team_id,
         e.distance_m,
         dense_rank() over (order by e.distance_m asc)::integer as rank
    from eligible e
   order by e.distance_m asc
   limit in_limit;
$function$;

revoke execute on function public.rank_challenge_candidates(uuid, integer, integer) from anon, public;
grant  execute on function public.rank_challenge_candidates(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. post_open_challenge (Deduplicated Captain Notifications)
-- ---------------------------------------------------------------------------
create or replace function public.post_open_challenge(
  in_from_team_id uuid,
  in_match_name text,
  in_area_name text,
  in_scheduled_at timestamptz,
  in_total_slots integer,
  in_message text default null,
  in_radius_m integer default 25000,
  in_game_type text default 'friendly',
  in_end_time timestamptz default null,
  in_lat double precision default null,
  in_lng double precision default null,
  in_venue_id uuid default null
)
returns public.team_challenges
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_from           public.teams%rowtype;
  v_row            public.team_challenges%rowtype;
  v_cand           record;
  v_owner_id       uuid;
  v_notified_users uuid[] := '{}';
  v_lat            double precision;
  v_lng            double precision;
  v_venue_id       uuid := in_venue_id;
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

  v_lat := in_lat;
  v_lng := in_lng;

  -- Auto-cancel any existing open challenges for this team so the new search supersedes it cleanly
  update public.team_challenges
     set status = 'cancelled', responded_at = now()
   where from_team_id = v_from.id
     and status = 'open';

  -- Expire candidate rows from previous searches for this team
  update public.challenge_candidates cc
     set status = 'expired', responded_at = now()
   where exists (
     select 1 from public.team_challenges c
      where c.id = cc.challenge_id
        and c.from_team_id = v_from.id
        and c.status = 'cancelled'
   ) and cc.status in ('offered', 'interested');

  -- Create the new open challenge
  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, message, status,
    search_radius_m, area_name, game_type, end_time, match_lat, match_lng
  )
  values (
    v_from.id, null, v_uid, in_match_name,
    v_venue_id, in_scheduled_at, in_total_slots, in_message, 'open',
    coalesce(in_radius_m, 25000), in_area_name, in_game_type, in_end_time, v_lat, v_lng
  )
  returning * into v_row;

  -- Rank & offer to nearby teams (strictly deduplicated per captain / team owner within ST_DWithin radius)
  for v_cand in
    select * from public.rank_challenge_candidates(v_row.id, coalesce(in_radius_m, 25000), 5)
  loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
    values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m, 'offered')
    on conflict (challenge_id, team_id) do update set
      status = 'offered',
      rank = v_cand.rank,
      distance_m = v_cand.distance_m;

    select owner_id into v_owner_id from public.teams where id = v_cand.team_id;

    -- Enqueue notification strictly once per distinct user/owner (no multiple notifications for multi-squad owners)
    if v_owner_id is not null and not (v_owner_id = any(v_notified_users)) then
      v_notified_users := array_append(v_notified_users, v_owner_id);

      perform public.enqueue_notification(
        v_owner_id,
        'challenge_offer',
        'Match offer',
        v_from.name || ' wants a game. Tap to accept.',
        jsonb_build_object('route', '/teams/offers', 'challenge_id', v_row.id)
      );
    end if;
  end loop;

  return v_row;
end;
$$;

revoke execute on function public.post_open_challenge(uuid, text, text, timestamptz, integer, text, integer, text, timestamptz, double precision, double precision, uuid) from anon, public;
grant  execute on function public.post_open_challenge(uuid, text, text, timestamptz, integer, text, integer, text, timestamptz, double precision, double precision, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. decline_open_challenge (Decline Cascade Across Captain's Squads)
-- ---------------------------------------------------------------------------
create or replace function public.decline_open_challenge(
  in_challenge_id uuid,
  in_team_id      uuid
)
returns public.challenge_candidates
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid           uuid := (select auth.uid());
  v_row           public.challenge_candidates%rowtype;
  v_c             public.team_challenges%rowtype;
  v_is_host       boolean := false;
  v_is_cand_owner boolean := false;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_is_host := (v_c.created_by = v_uid or exists (
    select 1 from public.teams t where t.id = v_c.from_team_id and t.owner_id = v_uid
  ));
  v_is_cand_owner := public.is_team_owner(in_team_id, v_uid);

  if not v_is_host and not v_is_cand_owner then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  select * into v_row from public.challenge_candidates
   where challenge_id = in_challenge_id and team_id = in_team_id for update;

  if not found or v_row.status not in ('offered', 'interested') then
    raise exception 'NOT_OFFERED' using errcode = '42501';
  end if;

  -- Cascade decline: If candidate squad owner is declining/withdrawing, cascade decline across
  -- ALL candidate rows for any squad owned by this user for this challenge.
  -- This guarantees no zombie offers linger under the captain's other squads.
  if v_is_cand_owner then
    update public.challenge_candidates
       set status = 'declined', responded_at = now()
     where challenge_id = in_challenge_id
       and team_id in (select id from public.teams where owner_id = v_uid)
       and status in ('offered', 'interested');
  else
    -- Host declining a specific applicant squad
    update public.challenge_candidates
       set status = 'declined', responded_at = now()
     where challenge_id = in_challenge_id
       and team_id = in_team_id
       and status in ('offered', 'interested');
  end if;

  select * into v_row from public.challenge_candidates
   where challenge_id = in_challenge_id and team_id = in_team_id;

  return v_row;
end;
$$;

revoke execute on function public.decline_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.decline_open_challenge(uuid, uuid) to authenticated;
