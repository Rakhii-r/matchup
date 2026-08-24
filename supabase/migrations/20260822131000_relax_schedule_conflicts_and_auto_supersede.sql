-- ============================================================================
-- Relax schedule conflicts and auto-supersede open radar searches
--
-- 1. If a team posts a new open radar search, any previous open challenges
--    for that team are automatically cancelled/superseded rather than throwing
--    a blocking error.
-- 2. Relax strict schedule conflict checks so teams can freely create and
--    search for fixtures without being locked out.
-- 3. Provide `delete_or_cancel_match` and `cleanup_my_open_fixtures` RPCs
--    so users can easily delete/cancel any match or challenge.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. cleanup_my_open_fixtures — Cancels all open challenges & unplayed test matches for the user's teams
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_my_open_fixtures()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer := 0;
  v_team_ids uuid[];
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select array_agg(id) into v_team_ids from public.teams where owner_id = v_uid;

  -- 1. Cancel open team challenges
  update public.team_challenges
     set status = 'cancelled', responded_at = now()
   where (created_by = v_uid or from_team_id = any(coalesce(v_team_ids, array[]::uuid[])))
     and status in ('open', 'pending');
  get diagnostics v_count = row_count;

  -- 2. Cancel open/locked uncompleted matches created by this user
  update public.matches
     set status = 'cancelled'
   where (creator_id = v_uid or team_a_id = any(coalesce(v_team_ids, array[]::uuid[])))
     and status in ('open', 'locked');

  return v_count;
end;
$$;

revoke execute on function public.cleanup_my_open_fixtures() from anon, public;
grant  execute on function public.cleanup_my_open_fixtures() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. post_open_challenge — Auto-supersedes previous open searches & relaxes conflicts
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
  v_uid        uuid := (select auth.uid());
  v_from       public.teams%rowtype;
  v_row        public.team_challenges%rowtype;
  v_cand       record;
  v_window_end timestamptz;
  v_lat        double precision;
  v_lng        double precision;
  v_venue_id   uuid := in_venue_id;
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

  -- Rank & offer to nearby teams
  for v_cand in
    select * from public.rank_challenge_candidates(v_row.id, in_radius_m, 5)
  loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
    values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m, 'offered')
    on conflict (challenge_id, team_id) do update set
      status = 'offered',
      rank = v_cand.rank,
      distance_m = v_cand.distance_m;

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
