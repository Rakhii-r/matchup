-- ============================================================================
-- Deduplicate Match Offers & Notifications Per User
--
-- 1. rank_challenge_candidates: Uses DISTINCT ON (t.owner_id) to select at most
--    ONE closest team per distinct owner/captain. This prevents a single captain
--    who owns multiple teams from consuming multiple candidate slots or
--    receiving duplicate offers for the same challenge.
-- 2. post_open_challenge: Tracks notified owner IDs to guarantee that exactly
--    ONE notification is enqueued per distinct user.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. rank_challenge_candidates (Deduplicated per owner)
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
as $function$
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
    -- DISTINCT ON (t.owner_id) picks the single closest eligible team for each captain/user
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
       and ST_DWithin(tl.loc, c.origin_location, in_radius_m)
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
-- 2. post_open_challenge (Deduplicated notifications per user)
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
    in_radius_m, in_area_name, in_game_type, in_end_time, v_lat, v_lng
  )
  returning * into v_row;

  -- Rank & offer to nearby teams (deduplicated per team owner)
  for v_cand in
    select * from public.rank_challenge_candidates(v_row.id, in_radius_m, 5)
  loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
    values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m, 'offered')
    on conflict (challenge_id, team_id) do update set
      status = 'offered',
      rank = v_cand.rank,
      distance_m = v_cand.distance_m;

    select owner_id into v_owner_id from public.teams where id = v_cand.team_id;

    -- Enqueue notification strictly once per distinct user/owner
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
