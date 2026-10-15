-- ============================================================================
-- geospatial_targeting_and_global_discovery_test.sql
-- Verification for 20260904130000_geospatial_targeting_and_global_discovery.sql
-- ============================================================================

begin;

set local client_min_messages to notice;

-- Test fixtures
create temporary table t_m1_ids (label text primary key, id uuid not null);

do $$
declare
  v_venue_pune uuid;
  v_venue_mumbai uuid;
  v_owner_a uuid;
  v_owner_b uuid;
  v_team_a uuid;
  v_team_b1 uuid;
  v_team_b2 uuid;
  v_match_pune uuid;
  v_match_mumbai uuid;
begin
  -- 1. Venues: Pune (18.5204, 73.8567) and Mumbai (19.0760, 72.8777)
  insert into public.venues (name, address, lat, lng, sport_types)
  values ('Pune Turf', 'Pune', 18.5204, 73.8567, array['box_cricket'])
  returning id into v_venue_pune;
  insert into t_m1_ids values ('venue_pune', v_venue_pune);

  insert into public.venues (name, address, lat, lng, sport_types)
  values ('Mumbai Turf', 'Mumbai', 19.0760, 72.8777, array['box_cricket'])
  returning id into v_venue_mumbai;
  insert into t_m1_ids values ('venue_mumbai', v_venue_mumbai);

  -- 2. Captain A in Pune
  v_owner_a := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'captain_a@test.local');
  insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
  values (v_owner_a, 'Captain A', 18.5204, 73.8567, array['box_cricket']);
  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Team Pune A', 'box_cricket', v_owner_a, public.gen_share_code(), 4)
  returning id into v_team_a;
  insert into public.team_members (team_id, user_id, role) values (v_team_a, v_owner_a, 'owner');
  insert into t_m1_ids values ('owner_a', v_owner_a);
  insert into t_m1_ids values ('team_a', v_team_a);

  -- Add 3 more players to Team A to meet target_size 4
  for i in 1..3 loop
    declare v_member uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member_a_' || i || '@test.local');
      insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
      values (v_member, 'Member A ' || i, 18.5204, 73.8567, array['box_cricket']);
      insert into public.team_members (team_id, user_id, role) values (v_team_a, v_member, 'member');
    end;
  end loop;

  -- 3. Captain B owning TWO squads:
  -- Squad B1 located in Pune (~1.5 km away, 18.5300, 73.8600)
  -- Squad B2 located in Pune (~5 km away, 18.5600, 73.8900)
  v_owner_b := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'captain_b@test.local');
  insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
  values (v_owner_b, 'Captain B', 18.5300, 73.8600, array['box_cricket']);

  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Team B Close', 'box_cricket', v_owner_b, public.gen_share_code(), 4)
  returning id into v_team_b1;
  insert into public.team_members (team_id, user_id, role) values (v_team_b1, v_owner_b, 'owner');
  for i in 1..3 loop
    declare v_member uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member_b1_' || i || '@test.local');
      insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
      values (v_member, 'Member B1 ' || i, 18.5300, 73.8600, array['box_cricket']);
      insert into public.team_members (team_id, user_id, role) values (v_team_b1, v_member, 'member');
    end;
  end loop;

  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Team B Far', 'box_cricket', v_owner_b, public.gen_share_code(), 4)
  returning id into v_team_b2;
  insert into public.team_members (team_id, user_id, role) values (v_team_b2, v_owner_b, 'owner');
  for i in 1..3 loop
    declare v_member uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member_b2_' || i || '@test.local');
      insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
      values (v_member, 'Member B2 ' || i, 18.5600, 73.8900, array['box_cricket']);
      insert into public.team_members (team_id, user_id, role) values (v_team_b2, v_member, 'member');
    end;
  end loop;

  insert into t_m1_ids values ('owner_b', v_owner_b);
  insert into t_m1_ids values ('team_b1', v_team_b1);
  insert into t_m1_ids values ('team_b2', v_team_b2);

  -- 4. Open Matches: One in Pune, One in Mumbai
  insert into public.matches (
    creator_id, sport, venue_id, match_name, scheduled_at,
    total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, status, search_radius_m
  )
  values (
    v_owner_a, 'box_cricket', v_venue_pune, 'Pune Open Match', now() + interval '1 day',
    8, 7, public.gen_share_code(), 18.5204, 73.8567, 18.5204, 73.8567, 'open', 5000
  )
  returning id into v_match_pune;
  insert into t_m1_ids values ('match_pune', v_match_pune);

  insert into public.matches (
    creator_id, sport, venue_id, match_name, scheduled_at,
    total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, status, search_radius_m
  )
  values (
    v_owner_a, 'box_cricket', v_venue_mumbai, 'Mumbai Open Match', now() + interval '2 days',
    8, 7, public.gen_share_code(), 19.0760, 72.8777, 19.0760, 72.8777, 'open', 5000
  )
  returning id into v_match_mumbai;
  insert into t_m1_ids values ('match_mumbai', v_match_mumbai);
end $$;

-- ---------------------------------------------------------------------------
-- TEST 1: nearby_matches Global Discovery & Geospatial Targeting
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_first_id uuid;
begin
  -- 1a. Null coordinates -> returns BOTH Pune and Mumbai matches (global discovery)
  select count(*) into v_count from public.nearby_matches(null, null, null, null);
  if v_count < 2 then
    raise exception 'FAIL 1a: expected at least 2 global matches without coords, got %', v_count;
  end if;
  raise notice 'PASS 1a: nearby_matches returns global matches when coordinates are null';

  -- 1b. Pune coordinates with 10km radius -> returns ONLY Pune match
  select count(*), min(id) into v_count, v_first_id
    from public.nearby_matches(18.5204, 73.8567, 10000, 'box_cricket');
  if v_count <> 1 or v_first_id <> (select id from t_m1_ids where label = 'match_pune') then
    raise exception 'FAIL 1b: expected only Pune match within 10km radius, got %', v_count;
  end if;
  raise notice 'PASS 1b: nearby_matches filters strictly by ST_DWithin radius when coordinates provided';

  -- 1c. Pune coordinates with null radius (All distance) -> returns BOTH matches, closest first
  select id into v_first_id
    from public.nearby_matches(18.5204, 73.8567, null, 'box_cricket')
   limit 1;
  if v_first_id <> (select id from t_m1_ids where label = 'match_pune') then
    raise exception 'FAIL 1c: expected closest Pune match to be first when browsing all distances';
  end if;
  raise notice 'PASS 1c: nearby_matches orders by distance without radius lockout';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 2: list_open_challenges_nearby Global Discovery
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid;
  v_count integer;
begin
  -- Post an open challenge from Team A
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_m1_ids where label = 'owner_a'))::text, true);

  select id into v_ch
    from public.post_open_challenge(
      (select id from t_m1_ids where label = 'team_a'),
      'Pune Open Challenge',
      'Kothrud',
      now() + interval '3 days',
      8,
      'Friendly game',
      25000,
      'friendly',
      null,
      18.5204,
      73.8567,
      (select id from t_m1_ids where label = 'venue_pune')
    );
  insert into t_m1_ids values ('challenge_1', v_ch);

  -- Switch to user with no team / anonymous
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid())::text, true);

  -- 2a. Call list_open_challenges_nearby without team size and without coords
  select count(*) into v_count
    from public.list_open_challenges_nearby(null, null, null, null, null);
  if v_count < 1 then
    raise exception 'FAIL 2a: list_open_challenges_nearby returned 0 rows for null team_size';
  end if;
  raise notice 'PASS 2a: list_open_challenges_nearby allows squad-less global fixture discovery';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 3: Captain Deduplication in rank_challenge_candidates
-- ---------------------------------------------------------------------------
do $$
declare
  v_cands record;
  v_count integer := 0;
  v_team_id uuid;
begin
  -- Captain B owns Team B Close (~1.5 km) and Team B Far (~5 km).
  -- Both squads are format 4 and within 25 km.
  -- rank_challenge_candidates MUST return ONLY ONE squad for Captain B, and it MUST be Team B Close.
  for v_cands in
    select * from public.rank_challenge_candidates(
      (select id from t_m1_ids where label = 'challenge_1'),
      25000,
      5
    )
  loop
    v_count := v_count + 1;
    v_team_id := v_cands.team_id;
  end loop;

  if v_count <> 1 then
    raise exception 'FAIL 3a: expected exactly 1 candidate squad for Captain B, got %', v_count;
  end if;
  if v_team_id <> (select id from t_m1_ids where label = 'team_b1') then
    raise exception 'FAIL 3b: expected Team B Close to be chosen as the single closest squad';
  end if;
  raise notice 'PASS 3: rank_challenge_candidates deduplicates squads per captain with DISTINCT ON (t.owner_id)';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 4: Single Notification Enqueued per Captain in post_open_challenge
-- ---------------------------------------------------------------------------
do $$
declare
  v_notif_count integer;
begin
  select count(*) into v_notif_count
    from public.notification_jobs
   where user_id = (select id from t_m1_ids where label = 'owner_b')
     and kind = 'challenge_offer';

  if v_notif_count <> 1 then
    raise exception 'FAIL 4: expected exactly 1 challenge_offer notification for Captain B, got %', v_notif_count;
  end if;
  raise notice 'PASS 4: post_open_challenge enqueued strictly one notification for Captain B';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 5: decline_open_challenge Cascades Across All Squads
-- ---------------------------------------------------------------------------
do $$
declare
  v_open_count integer;
begin
  -- Simulate legacy state: both Team B Close and Team B Far have candidate rows
  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
  values (
    (select id from t_m1_ids where label = 'challenge_1'),
    (select id from t_m1_ids where label = 'team_b2'),
    2,
    5000,
    'offered'
  )
  on conflict (challenge_id, team_id) do update set status = 'offered';

  -- Authenticate as Captain B
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_m1_ids where label = 'owner_b'))::text, true);

  -- Captain B declines offer for Team B Close
  perform public.decline_open_challenge(
    (select id from t_m1_ids where label = 'challenge_1'),
    (select id from t_m1_ids where label = 'team_b1')
  );

  -- Verify that NO candidate row for Captain B remains in 'offered' or 'interested'
  select count(*) into v_open_count
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
   where cc.challenge_id = (select id from t_m1_ids where label = 'challenge_1')
     and t.owner_id = (select id from t_m1_ids where label = 'owner_b')
     and cc.status in ('offered', 'interested');

  if v_open_count <> 0 then
    raise exception 'FAIL 5: zombie candidate rows remain after decline: %', v_open_count;
  end if;
  raise notice 'PASS 5: decline_open_challenge successfully cascaded decline across all captain squads';
end $$;

rollback;
