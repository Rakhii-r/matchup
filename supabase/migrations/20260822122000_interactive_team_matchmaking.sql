-- ============================================================================
-- Interactive Team Matchmaking & Opponent Discovery (FR-201 Enhancement)
--
-- 1. Adds 'interested' status to challenge_candidates so opponent teams can
--    express interest / send match requests to the host team.
-- 2. Adds `apply_to_open_challenge` RPC for opponent captains.
-- 3. Adds `list_open_challenges_nearby` RPC for opponent teams to discover
--    open fixtures seeking opponents.
-- 4. Updates `accept_open_challenge` so the HOST captain can accept an interested
--    applicant team and lock in the match.
-- 5. Updates `get_challenge_candidates` to rank 'interested' applicants first.
-- ============================================================================

-- Expand check constraint on challenge_candidates status
alter table public.challenge_candidates drop constraint if exists challenge_candidates_status_check;
alter table public.challenge_candidates add constraint challenge_candidates_status_check
  check (status in ('offered', 'interested', 'accepted', 'declined', 'expired'));

-- ---------------------------------------------------------------------------
-- 1. apply_to_open_challenge — Opponent team captain expresses interest
-- ---------------------------------------------------------------------------
create or replace function public.apply_to_open_challenge(
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
  v_uid  uuid := (select auth.uid());
  v_c    public.team_challenges%rowtype;
  v_team public.teams%rowtype;
  v_from public.teams%rowtype;
  v_row  public.challenge_candidates%rowtype;
  v_dist double precision := 0;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'open' then
    raise exception 'CHALLENGE_ALREADY_TAKEN' using errcode = '23514';
  end if;
  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = in_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_team.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;
  if v_team.id = v_c.from_team_id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  select * into v_from from public.teams where id = v_c.from_team_id;
  if v_team.sport <> v_from.sport then
    raise exception 'SPORT_MISMATCH' using errcode = '23514';
  end if;

  if public.is_blocked_between(v_uid, v_c.created_by) then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Upsert applicant into challenge_candidates with status 'interested'
  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status, responded_at)
  values (v_c.id, v_team.id, 1, 0, 'interested', now())
  on conflict (challenge_id, team_id)
  do update set
    status = 'interested',
    responded_at = now()
  returning * into v_row;

  -- Notify the host captain that an opponent sent a match request
  perform public.enqueue_notification(
    v_c.created_by,
    'challenge_interest',
    'New Match Request!',
    v_team.name || ' wants to play against your team! Tap to review and accept.',
    jsonb_build_object('route', '/match/create/searching', 'challengeId', v_c.id)
  );

  return v_row;
end;
$$;

revoke execute on function public.apply_to_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.apply_to_open_challenge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. accept_open_challenge — Supports both Host accepting applicant & Applicant accepting offer
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
  v_is_host boolean := false;
  v_is_applicant_owner boolean := false;
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

  v_is_host := (v_c.created_by = v_uid or exists (
    select 1 from public.teams t where t.id = v_c.from_team_id and t.owner_id = v_uid
  ));
  v_is_applicant_owner := (v_team.owner_id = v_uid);

  -- Either the host captain is accepting this applicant, OR the applicant captain is accepting the offer
  if not v_is_host and not v_is_applicant_owner then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  -- Verify candidate exists
  if not exists (
    select 1 from public.challenge_candidates cc
     where cc.challenge_id = v_c.id
       and cc.team_id = in_team_id
       and cc.status in ('offered', 'interested')
  ) then
    raise exception 'NOT_OFFERED' using errcode = '42501';
  end if;

  -- Create the match fixture
  v_match := public.finalise_challenge(v_c.id, in_team_id);

  -- Lock in challenge
  update public.team_challenges
     set status = 'accepted',
         to_team_id = in_team_id,
         responded_at = now(),
         match_id = v_match.id
   where id = v_c.id
   returning * into v_c;

  -- Mark winning candidate accepted
  update public.challenge_candidates
     set status = 'accepted', responded_at = now()
   where challenge_id = v_c.id and team_id = in_team_id;

  -- Expire all other candidates
  for v_loser in
    update public.challenge_candidates
       set status = 'expired', responded_at = now()
     where challenge_id = v_c.id
       and team_id <> in_team_id
       and status in ('offered', 'interested')
     returning team_id
  loop
    perform public.enqueue_notification(
      (select owner_id from public.teams where id = v_loser.team_id),
      'challenge_taken',
      'Match fixture taken',
      'Another team locked in the fixture with ' || (select name from public.teams where id = v_c.from_team_id) || '.',
      jsonb_build_object('route', '/(tabs)/teams')
    );
  end loop;

  -- Notify the other captain
  perform public.enqueue_notification(
    case when v_is_host then v_team.owner_id else v_c.created_by end,
    'challenge_accepted',
    'Match Confirmed! 🎉',
    'Your match between ' || (select name from public.teams where id = v_c.from_team_id) || ' and ' || v_team.name || ' is fixed!',
    jsonb_build_object('route', '/match/' || v_match.id::text)
  );

  return v_c;
end;
$$;

revoke execute on function public.accept_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.accept_open_challenge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. list_open_challenges_nearby — For opponent teams to discover open matches
-- ---------------------------------------------------------------------------
create or replace function public.list_open_challenges_nearby(
  in_lat double precision default null,
  in_lng double precision default null,
  in_radius_m integer default 50000,
  in_sport text default null
)
returns table (
  challenge_id    uuid,
  match_name      text,
  from_team_id    uuid,
  from_team_name  text,
  from_team_logo  text,
  sport           text,
  venue_id        uuid,
  venue_name      text,
  area_name       text,
  scheduled_at    timestamptz,
  total_slots     integer,
  message         text,
  distance_m      double precision,
  created_at      timestamptz,
  applied_status  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_user_loc geography := null;
begin
  if in_lat is not null and in_lng is not null then
    v_user_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  select
    c.id as challenge_id,
    c.match_name,
    c.from_team_id,
    t.name as from_team_name,
    t.logo_url as from_team_logo,
    t.sport,
    c.venue_id,
    coalesce(v.name, c.area_name, 'Local Area') as venue_name,
    coalesce(c.area_name, v.address, 'Local Area') as area_name,
    c.scheduled_at,
    c.total_slots,
    c.message,
    case
      when v_user_loc is not null and v.location is not null then
        ST_Distance(v_user_loc, v.location)
      else 0::double precision
    end as distance_m,
    c.created_at,
    (
      select cc.status
        from public.challenge_candidates cc
        join public.teams my_t on my_t.id = cc.team_id
       where cc.challenge_id = c.id
         and my_t.owner_id = v_uid
       order by cc.created_at desc
       limit 1
    ) as applied_status
  from public.team_challenges c
  join public.teams t on t.id = c.from_team_id
  left join public.venues v on v.id = c.venue_id
  where c.status = 'open'
    and c.scheduled_at > now()
    and (in_sport is null or t.sport = in_sport)
    -- Don't show user's own team challenges in the opponent browse list
    and t.owner_id <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.team_members tm
       where tm.team_id = t.id and tm.user_id = v_uid
    )
    and (
      v_user_loc is null
      or v.location is null
      or ST_DWithin(v_user_loc, v.location, in_radius_m)
    )
  order by c.scheduled_at asc
  limit 50;
end;
$$;

revoke execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text) from anon, public;
grant  execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_challenge_candidates — Prioritise 'interested' applicants first
-- ---------------------------------------------------------------------------
drop function if exists public.get_challenge_candidates(uuid);
create or replace function public.get_challenge_candidates(in_challenge_id uuid)
returns table (
  candidate_id uuid, team_id uuid, team_name text, logo_url text, sport text,
  player_count integer, matches_played integer, wins integer, win_rate integer,
  rank integer, distance_m double precision, status text, responded_at timestamptz
) language sql stable security definer set search_path to 'public' as $function$
  with played as (
    select m.id as match_id, m.winner_team_id, cc.team_id
      from public.challenge_candidates cc
      join public.matches m
        on (m.team_a_id = cc.team_id or m.team_b_id = cc.team_id)
       and m.status = 'completed'
     where cc.challenge_id = in_challenge_id
  ),
  agg as (
    select team_id,
           count(*)::integer as matches_played,
           count(*) filter (where winner_team_id = team_id)::integer as wins,
           coalesce(round(100.0 * count(*) filter (where winner_team_id = team_id)
             / nullif(count(*), 0)), 0)::integer as win_rate
      from played group by team_id
  )
  select cc.id, t.id, t.name, t.logo_url, t.sport,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         coalesce(agg.matches_played, 0), coalesce(agg.wins, 0), coalesce(agg.win_rate, 0),
         cc.rank, cc.distance_m, cc.status, cc.responded_at
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
    left join agg on agg.team_id = cc.team_id
   where cc.challenge_id = in_challenge_id
     and public.is_challenge_poster(in_challenge_id)
   order by
     case when cc.status = 'interested' then 0 else 1 end,
     cc.rank;
$function$;

revoke execute on function public.get_challenge_candidates(uuid) from anon, public;
grant execute on function public.get_challenge_candidates(uuid) to authenticated;
