-- ============================================================================
-- geospatial_offers_dedup_test.sql
-- Verification for Geospatial Targeting, Global Discovery & Offers Deduplication
--
-- Covers:
--   1. PostGIS ST_DWithin play-zone notification filtering.
--   2. rank_challenge_candidates captain deduplication via DISTINCT ON (t.owner_id).
--   3. post_open_challenge single notification per distinct captain.
--   4. nearby_matches global match discovery without distance gate.
--   5. list_open_challenges_nearby global browsing for squad-less users.
--   6. decline_open_challenge cascade across all squads owned by the captain.
--
-- Run against a local Supabase / Postgres instance:
--   supabase test db
--   or:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/geospatial_offers_dedup_test.sql
-- ============================================================================

begin;

set local client_min_messages to notice;

create temporary table t_test_ids (label text primary key, id uuid not null);

do $$
declare
  v_venue uuid;
  v_owner uuid;
  v_team  uuid;
  r record;
begin
  -- Venue in Kothrud, Pune
  insert into public.venues (name, address, lat, lng, sport_types)
  values ('Deccan Gymkhana Turf', 'Kothrud, Pune', 18.5074, 73.8077, array['box_cricket', 'badminton'])
  returning id into v_venue;
  insert into t_test_ids values ('venue', v_venue);

  -- Setup accounts:
  -- A: Host (4v4 Cricket)
  -- B: Multi-squad captain (owns Squad B1 at 1.5km and Squad B2 at 4km, both 4v4 Cricket)
  -- C: Single-squad captain (8km away, 4v4 Cricket, inside 10km)
  -- D: Distant captain (Mumbai, 120km away, 4v4 Cricket, outside 10km)
  -- E: Wrong format captain (Pune, 6v6 Cricket)
  -- F: Wrong sport captain (Pune, 4v4 Badminton)
  -- G: Squad-less user (no teams)
  for r in
    select * from (values
      ('A', 'box_cricket', 18.5080, 73.8080, 4),   -- Host
      ('B', 'box_cricket', 18.5200, 73.8100, 4),   -- Multi-squad captain (~1.5 km)
      ('C', 'box_cricket', 18.5700, 73.8500, 4),   -- Single-squad captain (~8 km)
      ('D', 'box_cricket', 19.0760, 72.8777, 4),   -- Distant Mumbai (~120 km)
      ('E', 'box_cricket', 18.5100, 73.8120, 6),   -- Wrong format (6v6)
      ('F', 'badminton',   18.5090, 73.8090, 4),   -- Wrong sport
      ('G', 'box_cricket', 18.5074, 73.8077, 0)    -- Squadless
    ) as v(label, sport, lat, lng, fmt)
  loop
    insert into auth.users (id, instance_id, aud, role, email)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'test-' || r.label || '@matchup.local')
    returning id into v_owner;

    insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref, is_active)
    values (v_owner, 'Captain ' || r.label, r.lat, r.lng, array[r.sport], true);

    insert into t_test_ids values ('owner_' || r.label, v_owner);

    if r.fmt > 0 then
      insert into public.teams (name, sport, owner_id, target_size, invite_code)
      values ('Team ' || r.label, r.sport, v_owner, r.fmt, public.gen_share_code())
      returning id into v_team;

      insert into t_test_ids values ('team_' || r.label, v_team);

      -- Add required members to field format
      for i in 1..r.fmt loop
        declare v_m uuid := gen_random_uuid();
        begin
          insert into auth.users (id, instance_id, aud, role, email)
          values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm-' || r.label || '-' || i || '@matchup.local');
          insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref, is_active)
          values (v_m, 'Member ' || i, r.lat, r.lng, array[r.sport], true);
          insert into public.team_members (team_id, user_id, role)
          values (v_team, v_m, case when i = 1 then 'owner' else 'member' end);
        end;
      end loop;
    end if;
  end loop;

  -- Create second team B2 for Captain B at 4km
  insert into public.teams (name, sport, owner_id, target_size, invite_code)
  values ('Team B2 Titans', 'box_cricket', (select id from t_test_ids where label = 'owner_B'), 4, public.gen_share_code())
  returning id into v_team;
  insert into t_test_ids values ('team_B2', v_team);

  for i in 1..4 loop
    declare v_m uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mb2-' || i || '@matchup.local');
      insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref, is_active)
      values (v_m, 'B2 Member ' || i, 18.5350, 73.8300, array['box_cricket'], true);
      insert into public.team_members (team_id, user_id, role)
      values (v_team, v_m, case when i = 1 then 'owner' else 'member' end);
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 1: rank_challenge_candidates (ST_DWithin & DISTINCT ON t.owner_id)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid;
  v_ranks uuid[];
begin
  -- Host A creates 4v4 open challenge
  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, status, search_radius_m
  )
  select (select id from t_test_ids where label = 'team_A'),
         null,
         (select id from t_test_ids where label = 'owner_A'),
         'Pune Open 4v4',
         (select id from t_test_ids where label = 'venue'),
         now() + interval '2 days',
         8, -- 4v4
         'open',
         10000 -- 10km radius
  returning id into v_ch;
  insert into t_test_ids values ('challenge_test_1', v_ch);

  select array_agg(team_id order by rank)
    into v_ranks
    from public.rank_challenge_candidates(v_ch, 10000, 5);

  -- Verification:
  -- Exactly 2 candidates: Team B (closest for Owner B) and Team C.
  -- Team B2 must be excluded by DISTINCT ON (t.owner_id).
  -- Team D (Mumbai 120km) excluded by ST_DWithin.
  -- Team E (6v6) excluded by format.
  -- Team F (badminton) excluded by sport.
  -- Team A excluded by self-match rule.
  if v_ranks is null or array_length(v_ranks, 1) <> 2 then
    raise exception 'FAIL TEST 1: expected exactly 2 candidates, got %', coalesce(array_length(v_ranks, 1), 0);
  end if;

  if v_ranks[1] <> (select id from t_test_ids where label = 'team_B') then
    raise exception 'FAIL TEST 1: Team B should be first candidate (closest for Owner B)';
  end if;

  if v_ranks[2] <> (select id from t_test_ids where label = 'team_C') then
    raise exception 'FAIL TEST 1: Team C should be second candidate';
  end if;

  raise notice 'PASS TEST 1: rank_challenge_candidates geo-targeting and captain deduplication passed';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 2: post_open_challenge Notification Deduplication
-- ---------------------------------------------------------------------------
do $$
declare
  v_row public.team_challenges%rowtype;
  v_notif_count integer;
  v_notif_b integer;
  v_notif_d integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_test_ids where label = 'owner_A'))::text, true);

  v_row := public.post_open_challenge(
    (select id from t_test_ids where label = 'team_A'),
    'Weekend Trophy',
    'Deccan Ground',
    now() + interval '3 days',
    8, -- 4v4
    'Friendly game',
    10000 -- 10 km
  );

  insert into t_test_ids values ('challenge_post_2', v_row.id);

  -- Check notifications in notification_jobs
  select count(*) into v_notif_b
    from public.notification_jobs
   where user_id = (select id from t_test_ids where label = 'owner_B')
     and (data->>'challenge_id') = v_row.id::text;

  if v_notif_b <> 1 then
    raise exception 'FAIL TEST 2: Owner B received % notifications, expected strictly 1', v_notif_b;
  end if;

  -- Check Distant Captain D received 0
  select count(*) into v_notif_d
    from public.notification_jobs
   where user_id = (select id from t_test_ids where label = 'owner_D')
     and (data->>'challenge_id') = v_row.id::text;

  if v_notif_d <> 0 then
    raise exception 'FAIL TEST 2: Distant Captain D received % notifications, expected 0', v_notif_d;
  end if;

  raise notice 'PASS TEST 2: post_open_challenge strictly enqueued 1 notification per distinct captain';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 3: nearby_matches Global Discovery (Null coords / radius fallback)
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  -- Create a match in Mumbai (120km away)
  insert into public.matches (
    creator_id, sport, venue_text, area_name, scheduled_at,
    total_slots, missing_count, share_code, lat, lng, match_name,
    status, match_type, search_radius_m
  )
  values (
    (select id from t_test_ids where label = 'owner_D'),
    'box_cricket', 'Wankhede', 'Mumbai', now() + interval '1 day',
    10, 8, 'MUM001', 19.0760, 72.8777, 'Mumbai Night Game',
    'open', 'open', 5000
  );

  -- Call nearby_matches with NULL coordinates and NULL radius
  select count(*) into v_count
    from public.nearby_matches(null, null, null, 'box_cricket');

  if v_count < 1 then
    raise exception 'FAIL TEST 3: nearby_matches with null coords returned 0 matches';
  end if;

  raise notice 'PASS TEST 3: nearby_matches returns matches globally when coordinates are null';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 4: list_open_challenges_nearby Global Browsing for Squad-Less Users
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_test_ids where label = 'owner_G'))::text, true);

  -- Squadless user (in_team_size: null, in_radius_m: null, coords: null)
  select count(*) into v_count
    from public.list_open_challenges_nearby(null, null, null, 'box_cricket', null);

  if v_count < 1 then
    raise exception 'FAIL TEST 4: list_open_challenges_nearby returned 0 fixtures for squad-less user';
  end if;

  raise notice 'PASS TEST 4: list_open_challenges_nearby allows squad-less users to browse open fixtures globally';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 5: decline_open_challenge Cascade & Zombie Offer Prevention
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch_id uuid := (select id from t_test_ids where label = 'challenge_test_1');
  v_cand_b2 uuid;
  v_active_offers integer;
begin
  -- Insert candidate row for Team B2 manually to simulate multi-squad candidate state
  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
  values (v_ch_id, (select id from t_test_ids where label = 'team_B2'), 2, 4000, 'offered')
  on conflict do nothing;

  -- Owner B declines the fixture passing team_B
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_test_ids where label = 'owner_B'))::text, true);

  perform public.decline_open_challenge(v_ch_id, (select id from t_test_ids where label = 'team_B'));

  -- Check if Team B2 candidate row is also marked declined or if any open candidates remain for Owner B
  select count(*) into v_active_offers
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
   where cc.challenge_id = v_ch_id
     and t.owner_id = (select id from t_test_ids where label = 'owner_B')
     and cc.status in ('offered', 'interested');

  if v_active_offers > 0 then
    raise exception 'FAIL TEST 5: Zombie offer detected! Owner B still has % active candidate rows', v_active_offers;
  end if;

  raise notice 'PASS TEST 5: decline_open_challenge cascade prevents zombie offers';
end $$;

rollback;
