-- ============================================================================
-- geospatial_offers_dedup_adversarial_test.sql
-- Adversarial Stress & Boundary Verification
--
-- Tests:
--   1. ST_DWithin exact boundary condition: distance == radius vs distance == radius + 1m.
--   2. Null coordinates handling: squad centroid is null -> 0 candidates & 0 notifications.
--   3. Pressure testing: Captain owning 10 squads within radius -> exactly 1 candidate row
--      and strictly 1 notification enqueued.
--   4. Zombie eradication: Decline cascade across 10 squads owned by captain.
-- ============================================================================

begin;

set local client_min_messages to notice;

create temporary table t_adv_ids (label text primary key, id uuid not null);

do $$
declare
  v_host uuid;
  v_host_team uuid;
  v_venue uuid;
  v_cap10 uuid;
  v_team uuid;
  v_pt_origin geography := ST_SetSRID(ST_MakePoint(73.8567, 18.5204), 4326)::geography;
  v_pt_boundary geography;
  v_pt_outside geography;
  v_owner_bound uuid;
  v_owner_out uuid;
  v_owner_null uuid;
  v_team_bound uuid;
  v_team_out uuid;
  v_team_null uuid;
begin
  -- 1. Setup Host at Pune Center (18.5204, 73.8567)
  v_host := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_host, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-host@test.local');
  insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
  values (v_host, 'Adv Host', v_pt_origin, array['box_cricket'], true);

  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Adv Host Team', 'box_cricket', v_host, public.gen_share_code(), 4)
  returning id into v_host_team;
  insert into public.team_members (team_id, user_id, role) values (v_host_team, v_host, 'owner');
  for i in 1..3 loop
    declare v_m uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-hm-' || i || '@test.local');
      insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
      values (v_m, 'Adv HM ' || i, v_pt_origin, array['box_cricket'], true);
      insert into public.team_members (team_id, user_id, role) values (v_host_team, v_m, 'member');
    end;
  end loop;

  insert into t_adv_ids values ('host', v_host);
  insert into t_adv_ids values ('host_team', v_host_team);

  -- 2. Setup Exact Boundary Squad (at 10,000 meters) and Outside Boundary Squad (at 10,001 meters)
  -- Projecting north: 1 degree latitude ~ 111,320m -> 10,000m ~ 0.089831 deg lat
  v_pt_boundary := ST_Project(v_pt_origin, 10000, radians(0))::geography;
  v_pt_outside  := ST_Project(v_pt_origin, 10001, radians(0))::geography;

  -- Boundary captain
  v_owner_bound := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner_bound, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-bound@test.local');
  insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
  values (v_owner_bound, 'Adv Boundary Captain', v_pt_boundary, array['box_cricket'], true);
  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Adv Boundary Squad', 'box_cricket', v_owner_bound, public.gen_share_code(), 4)
  returning id into v_team_bound;
  insert into public.team_members (team_id, user_id, role) values (v_team_bound, v_owner_bound, 'owner');
  for i in 1..3 loop
    declare v_m uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-bm-' || i || '@test.local');
      insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
      values (v_m, 'Adv BM ' || i, v_pt_boundary, array['box_cricket'], true);
      insert into public.team_members (team_id, user_id, role) values (v_team_bound, v_m, 'member');
    end;
  end loop;
  insert into t_adv_ids values ('owner_bound', v_owner_bound);
  insert into t_adv_ids values ('team_bound', v_team_bound);

  -- Outside captain (10,001 meters)
  v_owner_out := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner_out, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-out@test.local');
  insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
  values (v_owner_out, 'Adv Outside Captain', v_pt_outside, array['box_cricket'], true);
  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Adv Outside Squad', 'box_cricket', v_owner_out, public.gen_share_code(), 4)
  returning id into v_team_out;
  insert into public.team_members (team_id, user_id, role) values (v_team_out, v_owner_out, 'owner');
  for i in 1..3 loop
    declare v_m uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-outm-' || i || '@test.local');
      insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
      values (v_m, 'Adv OutM ' || i, v_pt_outside, array['box_cricket'], true);
      insert into public.team_members (team_id, user_id, role) values (v_team_out, v_m, 'member');
    end;
  end loop;
  insert into t_adv_ids values ('owner_out', v_owner_out);
  insert into t_adv_ids values ('team_out', v_team_out);

  -- Null location squad
  v_owner_null := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_owner_null, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-null@test.local');
  insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
  values (v_owner_null, 'Adv Null Captain', null, array['box_cricket'], true);
  insert into public.teams (name, sport, owner_id, invite_code, target_size)
  values ('Adv Null Squad', 'box_cricket', v_owner_null, public.gen_share_code(), 4)
  returning id into v_team_null;
  insert into public.team_members (team_id, user_id, role) values (v_team_null, v_owner_null, 'owner');
  for i in 1..3 loop
    declare v_m uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email)
      values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-nullm-' || i || '@test.local');
      insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
      values (v_m, 'Adv NullM ' || i, null, array['box_cricket'], true);
      insert into public.team_members (team_id, user_id, role) values (v_team_null, v_m, 'member');
    end;
  end loop;
  insert into t_adv_ids values ('owner_null', v_owner_null);
  insert into t_adv_ids values ('team_null', v_team_null);

  -- 3. Setup Multi-Squad Captain owning 10 squads within 5km
  v_cap10 := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_cap10, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-cap10@test.local');
  insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
  values (v_cap10, 'Captain TenSquads', v_pt_origin, array['box_cricket'], true);
  insert into t_adv_ids values ('owner_cap10', v_cap10);

  for s in 1..10 loop
    declare
      v_squad_loc geography := ST_Project(v_pt_origin, 500 + s * 300, radians(s * 36))::geography;
    begin
      insert into public.teams (name, sport, owner_id, invite_code, target_size)
      values ('TenSquad ' || s, 'box_cricket', v_cap10, public.gen_share_code(), 4)
      returning id into v_team;

      insert into t_adv_ids values ('team_10_' || s, v_team);
      insert into public.team_members (team_id, user_id, role) values (v_team, v_cap10, 'owner');

      for i in 1..3 loop
        declare v_m uuid := gen_random_uuid();
        begin
          insert into auth.users (id, instance_id, aud, role, email)
          values (v_m, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adv-10m-' || s || '-' || i || '@test.local');
          insert into public.profiles (id, full_name, home_location, sport_pref, is_active)
          values (v_m, 'Adv 10M ' || s || '-' || i, v_squad_loc, array['box_cricket'], true);
          insert into public.team_members (team_id, user_id, role) values (v_team, v_m, 'member');
        end;
      end loop;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- TEST 1: Boundary Edge Test (<= 10,000m vs 10,001m)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid;
  v_found_bound boolean := false;
  v_found_out boolean := false;
  v_r record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_adv_ids where label = 'host'))::text, true);

  select id into v_ch
    from public.post_open_challenge(
      (select id from t_adv_ids where label = 'host_team'),
      'Boundary 10k Clash',
      'Pune Center',
      now() + interval '1 day',
      8,
      'Testing exact 10km boundary',
      10000,
      'friendly',
      null,
      18.5204,
      73.8567,
      null
    );
  insert into t_adv_ids values ('ch_boundary', v_ch);

  for v_r in
    select * from public.rank_challenge_candidates(v_ch, 10000, 10)
  loop
    if v_r.team_id = (select id from t_adv_ids where label = 'team_bound') then
      v_found_bound := true;
    end if;
    if v_r.team_id = (select id from t_adv_ids where label = 'team_out') then
      v_found_out := true;
    end if;
  end loop;

  if not v_found_bound then
    raise exception 'FAIL ADV 1a: candidate at exactly 10,000m boundary was excluded';
  end if;
  if v_found_out then
    raise exception 'FAIL ADV 1b: candidate at 10,001m beyond boundary was included';
  end if;

  raise notice 'PASS ADV 1: ST_DWithin strictly includes <= radius and excludes radius + 1m';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 2: Null Squad Location Centroid Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid := (select id from t_adv_ids where label = 'ch_boundary');
  v_found_null boolean := false;
  v_notif_count integer;
  v_r record;
begin
  for v_r in select * from public.rank_challenge_candidates(v_ch, 10000, 10) loop
    if v_r.team_id = (select id from t_adv_ids where label = 'team_null') then
      v_found_null := true;
    end if;
  end loop;

  if v_found_null then
    raise exception 'FAIL ADV 2a: null location squad was included in candidate ranking';
  end if;

  select count(*) into v_notif_count
    from public.notification_jobs
   where user_id = (select id from t_adv_ids where label = 'owner_null');

  if v_notif_count <> 0 then
    raise exception 'FAIL ADV 2b: null location captain received % notifications', v_notif_count;
  end if;

  raise notice 'PASS ADV 2: Squad with null location centroid produces 0 candidates and 0 notifications';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 3: Captain with 10 Squads Pressure Verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid := (select id from t_adv_ids where label = 'ch_boundary');
  v_cap10_count integer := 0;
  v_closest_team uuid;
  v_notif_count integer;
  v_r record;
begin
  -- Count how many of Captain 10's squads were returned by rank_challenge_candidates
  for v_r in
    select * from public.rank_challenge_candidates(v_ch, 10000, 10)
  loop
    if exists (
      select 1 from public.teams t
       where t.id = v_r.team_id
         and t.owner_id = (select id from t_adv_ids where label = 'owner_cap10')
    ) then
      v_cap10_count := v_cap10_count + 1;
      v_closest_team := v_r.team_id;
    end if;
  end loop;

  if v_cap10_count <> 1 then
    raise exception 'FAIL ADV 3a: expected exactly 1 candidate squad for 10-squad captain, got %', v_cap10_count;
  end if;

  if v_closest_team <> (select id from t_adv_ids where label = 'team_10_1') then
    raise exception 'FAIL ADV 3b: expected closest squad (team_10_1) to be ranked first, got %', v_closest_team;
  end if;

  -- Verify notification_jobs for Captain 10
  select count(*) into v_notif_count
    from public.notification_jobs
   where user_id = (select id from t_adv_ids where label = 'owner_cap10')
     and kind = 'challenge_offer'
     and (data->>'challenge_id')::uuid = v_ch;

  if v_notif_count <> 1 then
    raise exception 'FAIL ADV 3c: expected strictly 1 push notification for 10-squad captain, got %', v_notif_count;
  end if;

  raise notice 'PASS ADV 3: Captain with 10 squads receives strictly 1 candidate row and 1 push notification';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 4: Decline Cascade Across 10 Squads (Zombie Eradication)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch uuid := (select id from t_adv_ids where label = 'ch_boundary');
  v_cap10 uuid := (select id from t_adv_ids where label = 'owner_cap10');
  v_team_1 uuid := (select id from t_adv_ids where label = 'team_10_1');
  v_zombies integer;
  s integer;
begin
  -- Simulate candidate rows populated for all 10 squads
  for s in 2..10 loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
    values (
      v_ch,
      (select id from t_adv_ids where label = 'team_10_' || s),
      s,
      500 + s * 300,
      'offered'
    )
    on conflict (challenge_id, team_id) do update set status = 'offered';
  end loop;

  -- Authenticate as Captain 10
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cap10)::text, true);

  -- Decline challenge for team_1
  perform public.decline_open_challenge(v_ch, v_team_1);

  -- Verify all 10 candidate rows are now declined
  select count(*) into v_zombies
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
   where cc.challenge_id = v_ch
     and t.owner_id = v_cap10
     and cc.status in ('offered', 'interested');

  if v_zombies <> 0 then
    raise exception 'FAIL ADV 4: zombie candidate rows remain after decline: %', v_zombies;
  end if;

  raise notice 'PASS ADV 4: Decline cascade eliminated candidate rows across all 10 squads without zombies';
end $$;

rollback;
