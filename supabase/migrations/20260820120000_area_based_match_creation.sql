-- ---------------------------------------------------------------------------
-- Migration: Area-based Match Creation & Discovery
-- 
-- Replaces mandatory venue selection at match creation with discovery area &
-- radius. Specific venue booking is deferred until after an opponent is matched.
-- ---------------------------------------------------------------------------

-- 1. Table schema adjustments
alter table public.team_challenges alter column venue_id drop not null;
alter table public.team_challenges add column if not exists area_name text;
alter table public.team_challenges add column if not exists match_lat double precision;
alter table public.team_challenges add column if not exists match_lng double precision;
alter table public.team_challenges add column if not exists search_radius_m integer default 25000;

alter table public.matches add column if not exists area_name text;
alter table public.matches add column if not exists match_lat double precision;
alter table public.matches add column if not exists match_lng double precision;
alter table public.matches add column if not exists search_radius_m integer default 25000;

-- 2. create_open_match RPC with area support
create or replace function public.create_open_match(
  in_sport        text,
  in_match_name   text,
  in_area_name    text,
  in_scheduled_at timestamptz,
  in_total_slots  integer,
  in_end_time     timestamptz default null,
  in_game_type    text default 'friendly',
  in_radius_m     integer default 25000,
  in_lat          double precision default null,
  in_lng          double precision default null,
  in_venue_id     uuid default null
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_match    public.matches%rowtype;
  v_end      timestamptz;
  v_code     text;
  v_try      integer;
  v_conflict record;
  v_lat      double precision;
  v_lng      double precision;
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

  v_lat := coalesce(in_lat, (select st_y(p.home_location::geometry) from public.profiles p where p.id = v_uid), 18.5204);
  v_lng := coalesce(in_lng, (select st_x(p.home_location::geometry) from public.profiles p where p.id = v_uid), 73.8567);
  v_end := coalesce(in_end_time, in_scheduled_at + interval '3 hours');

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

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at, end_time,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name,
        game_type, search_radius_m, match_type
      )
      values (
        v_uid, in_sport, in_venue_id, in_area_name, in_area_name, in_scheduled_at, in_end_time,
        in_total_slots, in_total_slots - 1, v_code, v_lat, v_lng, v_lat, v_lng, in_match_name,
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

  select * into v_match from public.matches where id = v_match.id;
  return v_match;
end;
$$;

revoke execute on function public.create_open_match(text, text, text, timestamptz, integer, timestamptz, text, integer, double precision, double precision, uuid) from anon, public;
grant  execute on function public.create_open_match(text, text, text, timestamptz, integer, timestamptz, text, integer, double precision, double precision, uuid) to authenticated;

-- 3. post_open_challenge RPC with area support
create or replace function public.post_open_challenge(
  in_from_team_id uuid,
  in_match_name   text,
  in_area_name    text,
  in_scheduled_at timestamptz,
  in_total_slots  integer,
  in_message      text default null,
  in_radius_m     integer default 25000,
  in_game_type    text default 'friendly',
  in_end_time     timestamptz default null,
  in_lat          double precision default null,
  in_lng          double precision default null,
  in_venue_id     uuid default null
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
  v_conflict record;
  v_window_end timestamptz;
  v_lat  double precision;
  v_lng  double precision;
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

  v_lat := coalesce(in_lat, (select st_y(tl::geometry) from public.team_location(v_from.id) tl), (select st_y(p.home_location::geometry) from public.profiles p where p.id = v_uid), 18.5204);
  v_lng := coalesce(in_lng, (select st_x(tl::geometry) from public.team_location(v_from.id) tl), (select st_x(p.home_location::geometry) from public.profiles p where p.id = v_uid), 73.8567);

  v_window_end := coalesce(in_end_time, in_scheduled_at + interval '3 hours');

  perform pg_advisory_xact_lock(hashtext(v_from.id::text));

  select * into v_conflict
    from public.team_schedule_conflict(v_from.id, in_scheduled_at, v_window_end);
  if found then
    raise exception '%', format(
      'TEAM_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, area_name, match_lat, match_lng, search_radius_m, scheduled_at, total_slots, message, status
  )
  values (
    v_from.id, null, v_uid, in_match_name,
    in_venue_id, in_area_name, v_lat, v_lng, in_radius_m, in_scheduled_at, in_total_slots, in_message, 'open'
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

  return v_row;
end;
$$;

revoke execute on function public.post_open_challenge(uuid, text, text, timestamptz, integer, text, integer, text, timestamptz, double precision, double precision, uuid) from anon, public;
grant  execute on function public.post_open_challenge(uuid, text, text, timestamptz, integer, text, integer, text, timestamptz, double precision, double precision, uuid) to authenticated;

-- 4. rank_challenge_candidates with coordinate fallback
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
           coalesce(
             v.location,
             case when ch.match_lng is not null and ch.match_lat is not null
                  then ST_SetSRID(ST_MakePoint(ch.match_lng, ch.match_lat), 4326)::geography
                  else public.team_location(ch.from_team_id)
             end
           ) as origin_location
      from public.team_challenges ch
      join public.teams  ft on ft.id = ch.from_team_id
      left join public.venues v  on v.id  = ch.venue_id
     where ch.id = in_challenge_id
  ),
  eligible as (
    select t.id as team_id,
           ST_Distance(tl.loc, c.origin_location) as distance_m
      from public.teams t
      cross join c
      join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
     where t.id <> c.from_team_id
       and t.sport = c.sport
       and public.is_active_user(t.owner_id)
       and not public.is_blocked_between(t.owner_id, c.created_by)
       and ST_DWithin(tl.loc, c.origin_location, in_radius_m)
       and (
         (select count(distinct tm.user_id) from public.team_members tm
           where tm.team_id in (t.id, c.from_team_id))
         <= c.total_slots
       )
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
         dense_rank() over (order by e.distance_m asc)::integer as rank
    from eligible e
   order by e.distance_m asc
   limit in_limit;
$$;

revoke execute on function public.rank_challenge_candidates(uuid, integer, integer) from anon, public;
grant  execute on function public.rank_challenge_candidates(uuid, integer, integer) to authenticated;

-- 5. finalise_challenge with nullable venue_id
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
  v_lat   double precision;
  v_lng   double precision;
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

  if v_c.venue_id is not null then
    select * into v_venue from public.venues where id = v_c.venue_id;
  end if;

  v_lat := coalesce(v_venue.lat, v_c.match_lat, (select st_y(tl::geometry) from public.team_location(v_c.from_team_id) tl), 18.5204);
  v_lng := coalesce(v_venue.lng, v_c.match_lng, (select st_x(tl::geometry) from public.team_location(v_c.from_team_id) tl), 73.8567);

  select count(distinct tm.user_id) into v_count
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, in_to_team_id);
  if v_count > v_c.total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name), v_c.area_name, v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, t.owner_id, 'confirmed', 'browse',
         case when t.id = v_c.from_team_id then 'creator' else 'opponent_captain' end
    from public.teams t
   where t.id in (v_c.from_team_id, in_to_team_id);

  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, tm.user_id, 'invited', 'browse', 'player'
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where tm.team_id in (v_c.from_team_id, in_to_team_id)
     and tm.user_id <> t.owner_id
  on conflict (match_id, user_id) do nothing;

  update public.team_challenges
     set match_id = v_match.id
   where id = v_c.id;

  return v_match;
end;
$$;
