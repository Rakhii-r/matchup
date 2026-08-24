-- ============================================================================
-- Match Offers Request Flow & Candidate Decline Fixes
--
-- 1. Expands `challenge_candidates_status_check` constraint to support 'interested'.
-- 2. Updates `apply_to_open_challenge` for opponent captains to express interest.
-- 3. Updates `decline_open_challenge` so both host and candidate captains can decline/withdraw.
-- ============================================================================

-- 1. Ensure 'interested' status is allowed on challenge_candidates
alter table public.challenge_candidates drop constraint if exists challenge_candidates_status_check;
alter table public.challenge_candidates add constraint challenge_candidates_status_check
  check (status in ('offered', 'interested', 'accepted', 'declined', 'expired'));

-- 2. Allow all notification kinds (e.g. challenge_interest, challenge_taken, challenge_accepted)
alter table public.notification_jobs drop constraint if exists notification_jobs_kind_check;

-- 3. Allow all authenticated users to view team profiles and rosters
drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams for select to authenticated
  using (true);

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members for select to authenticated
  using (true);

-- 4. get_team_overview — Accessible to all users viewing a squad
create or replace function public.get_team_overview(in_team_id uuid)
returns table (
  id uuid, name text, sport text, invite_code text, created_at timestamptz,
  description text, logo_url text, home_ground text, owner_id uuid,
  captain_name text, captain_avatar text, player_count integer,
  my_role text, i_am_owner boolean
) language sql stable security definer set search_path to 'public' as $function$
  select t.id, t.name, t.sport,
         case when t.owner_id = (select auth.uid()) or exists (select 1 from public.team_members tm where tm.team_id = t.id and tm.user_id = (select auth.uid())) then t.invite_code else null end as invite_code,
         t.created_at,
         t.description, t.logo_url, t.home_ground,
         t.owner_id, p.full_name, p.avatar_url,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         (select tm.role from public.team_members tm
           where tm.team_id = t.id and tm.user_id = (select auth.uid())),
         t.owner_id = (select auth.uid())
    from public.teams t
    left join public.profiles p on p.id = t.owner_id
   where t.id = in_team_id;
$function$;

create or replace function public.get_team_stats(in_team_id uuid)
returns table (
  team_id uuid, matches_played integer, wins integer, losses integer,
  ties integer, win_rate integer, highest_score integer, lowest_score integer
) language sql stable security definer set search_path to 'public' as $function$
  with played as (
    select m.id, m.winner_team_id
      from public.matches m
     where m.status = 'completed'
       and in_team_id in (m.team_a_id, m.team_b_id)
  ),
  scores as (
    select i.runs
      from public.innings i
      join played p on p.id = i.match_id
     where i.batting_team_id = in_team_id
  )
  select in_team_id,
         (select count(*) from played)::integer,
         (select count(*) from played where winner_team_id = in_team_id)::integer,
         (select count(*) from played
           where winner_team_id is not null and winner_team_id <> in_team_id)::integer,
         (select count(*) from played where winner_team_id is null)::integer,
         coalesce((
           select round(100.0 * count(*) filter (where winner_team_id = in_team_id)
                  / nullif(count(*), 0)) from played
         ), 0)::integer,
         (select max(runs) from scores)::integer,
         (select min(runs) from scores)::integer;
$function$;

create or replace function public.get_team_fixtures(in_team_id uuid)
returns table (
  match_id uuid, match_name text, scheduled_at timestamptz, venue_text text,
  status text, is_upcoming boolean, opponent_id uuid, opponent_name text,
  is_home boolean, our_runs integer, our_wickets integer,
  their_runs integer, their_wickets integer, outcome text, result_text text
) language sql stable security definer set search_path to 'public' as $function$
  select m.id, m.match_name, m.scheduled_at, m.venue_text, m.status,
         (m.status in ('open', 'locked') and m.scheduled_at > now() - interval '3 hours'),
         opp.id, opp.name,
         (m.team_a_id = in_team_id),
         ours.runs, ours.wickets,
         theirs.runs, theirs.wickets,
         case
           when m.status <> 'completed' then null
           when m.winner_team_id is null then 'tied'
           when m.winner_team_id = in_team_id then 'won'
           else 'lost'
         end,
         m.result_text
    from public.matches m
    left join public.teams opp
      on opp.id = case when m.team_a_id = in_team_id then m.team_b_id else m.team_a_id end
    left join public.innings ours
      on ours.match_id = m.id and ours.batting_team_id = in_team_id
    left join public.innings theirs
      on theirs.match_id = m.id and theirs.batting_team_id = opp.id
   where in_team_id in (m.team_a_id, m.team_b_id)
   order by m.scheduled_at desc;
$function$;

-- 2. apply_to_open_challenge — Opponent team captain sends a match request
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

-- 3. decline_open_challenge — Supports host declining applicant & applicant withdrawing request
-- 3. decline_open_challenge — Supports host declining applicant & applicant withdrawing request
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

  update public.challenge_candidates
     set status = 'declined', responded_at = now()
   where id = v_row.id
   returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.decline_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.decline_open_challenge(uuid, uuid) to authenticated;

-- 4. finalise_challenge — creates the match fixture when a challenge is accepted
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

  if v_c.venue_id is not null then
    select * into v_venue from public.venues where id = v_c.venue_id;
  end if;

  v_lat := coalesce(v_venue.lat, v_c.match_lat, (select st_y(tl::geometry) from public.team_location(v_c.from_team_id) tl), 18.5204);
  v_lng := coalesce(v_venue.lng, v_c.match_lng, (select st_x(tl::geometry) from public.team_location(v_c.from_team_id) tl), 73.8567);

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name, 'Local Ground'), coalesce(v_c.area_name, 'Local Area'), v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Seat both team owners as captains
  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, t.owner_id, 'confirmed', 'browse',
         case when t.id = v_c.from_team_id then 'creator' else 'opponent_captain' end
    from public.teams t
   where t.id in (v_c.from_team_id, in_to_team_id)
  on conflict (match_id, user_id) do update set status = 'confirmed';

  -- Seat squad members as invited
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

revoke execute on function public.finalise_challenge(uuid, uuid) from anon, authenticated, public;

-- 5. accept_open_challenge — Host captain accepts candidate / Applicant accepts offer
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

  if not v_is_host and not v_is_applicant_owner then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  -- Ensure candidate row exists in challenge_candidates
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
