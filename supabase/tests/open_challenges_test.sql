-- ============================================================================
-- open_challenges_test.sql — verification for 20260812061500_open_challenges.
--
-- Run against a LOCAL stack or a Supabase BRANCH. Never against production:
-- it creates and deletes rows, and the final ROLLBACK only protects you if the
-- whole file runs in one session.
--
--   supabase start
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/open_challenges_test.sql
--
-- Every check raises on failure, so a clean exit means all passed.
-- ============================================================================

begin;

set local client_min_messages to notice;

-- ---------------------------------------------------------------------------
-- Fixtures. Three teams around Pune: A posts, B is 2km from the venue, C is
-- 8km, D is 60km (out of radius) and E plays the wrong sport.
-- ---------------------------------------------------------------------------
create temporary table t_ids (label text primary key, id uuid not null);

do $$
declare
  v_venue uuid;
  v_owner uuid;
  v_team  uuid;
  r record;
begin
  -- Venue at Kothrud.
  insert into public.venues (name, address, lat, lng, sport_types)
  values ('Test Ground', 'Kothrud', 18.5074, 73.8077, array['box_cricket'])
  returning id into v_venue;
  insert into t_ids values ('venue', v_venue);

  -- label, sport, home lat, home lng
  for r in
    select * from (values
      ('A', 'box_cricket', 18.5080, 73.8080),   -- poster, at the venue
      ('B', 'box_cricket', 18.5200, 73.8100),   -- ~1.5 km
      ('C', 'box_cricket', 18.5700, 73.8500),   -- ~8 km
      ('D', 'box_cricket', 19.0760, 72.8777),   -- Mumbai, ~120 km, out of range
      ('E', 'badminton',   18.5090, 73.8090)    -- wrong sport, next door
    ) as v(label, sport, lat, lng)
  loop
    insert into auth.users (id, instance_id, aud, role, email)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'owner-' || r.label || '@test.local')
    returning id into v_owner;

    insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
    values (v_owner, 'Owner ' || r.label, r.lat, r.lng, array[r.sport]);

    insert into public.teams (name, sport, owner_id, invite_code)
    values ('Team ' || r.label, r.sport, v_owner, public.gen_share_code())
    returning id into v_team;

    insert into t_ids values ('owner_' || r.label, v_owner);
    insert into t_ids values ('team_'  || r.label, v_team);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1. team_location returns a point for a team with located members, and null
--    for a team with none.
-- ---------------------------------------------------------------------------
do $$
declare v_loc geography;
begin
  select public.team_location(id) into v_loc from t_ids where label = 'team_B';
  if v_loc is null then
    raise exception 'FAIL 1a: team_location returned null for a located team';
  end if;
  raise notice 'PASS 1a: team_location resolves';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ranking: B before C (closer), D excluded (out of radius), E excluded
--    (wrong sport), A excluded (is the poster).
-- ---------------------------------------------------------------------------
do $$
declare
  v_ch    uuid;
  v_ranks uuid[];
begin
  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, status
  )
  select (select id from t_ids where label = 'team_A'),
         null,
         (select id from t_ids where label = 'owner_A'),
         'Ranking probe',
         (select id from t_ids where label = 'venue'),
         now() + interval '2 days',
         20,
         'open'
  returning id into v_ch;
  insert into t_ids values ('challenge_rank', v_ch);

  select array_agg(team_id order by rank)
    into v_ranks
    from public.rank_challenge_candidates(v_ch, 25000, 5);

  if v_ranks is null or array_length(v_ranks, 1) <> 2 then
    raise exception 'FAIL 2a: expected exactly 2 candidates, got %',
      coalesce(array_length(v_ranks, 1), 0);
  end if;
  if v_ranks[1] <> (select id from t_ids where label = 'team_B') then
    raise exception 'FAIL 2b: nearest candidate should be team B';
  end if;
  if v_ranks[2] <> (select id from t_ids where label = 'team_C') then
    raise exception 'FAIL 2c: second candidate should be team C';
  end if;
  raise notice 'PASS 2: ranking order and hard filters correct';
end $$;

-- ---------------------------------------------------------------------------
-- 3. addressee_matches_status forbids an open challenge carrying an addressee.
--    This is the constraint that made an earlier draft of accept_open_challenge
--    fail; it must stay enforced.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.team_challenges
       set to_team_id = (select id from t_ids where label = 'team_B')
     where id = (select id from t_ids where label = 'challenge_rank');
    raise exception 'FAIL 3: open challenge accepted an addressee';
  exception when check_violation then
    raise notice 'PASS 3: addressee_matches_status holds';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A team that was never offered the fixture cannot accept it.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m)
  values ((select id from t_ids where label = 'challenge_rank'),
          (select id from t_ids where label = 'team_B'), 1, 1500);

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_C'))::text, true);

  begin
    perform public.accept_open_challenge(
      (select id from t_ids where label = 'challenge_rank'),
      (select id from t_ids where label = 'team_C'));
    raise exception 'FAIL 4: a non-offered team accepted the fixture';
  exception when sqlstate '42501' then
    raise notice 'PASS 4: NOT_OFFERED enforced';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The offered team can accept: match is created, both squads seated,
--    challenge closes, candidate row marked accepted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_c      public.team_challenges%rowtype;
  v_seated integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_B'))::text, true);

  v_c := public.accept_open_challenge(
    (select id from t_ids where label = 'challenge_rank'),
    (select id from t_ids where label = 'team_B'));

  if v_c.status <> 'accepted' then
    raise exception 'FAIL 5a: status is % not accepted', v_c.status;
  end if;
  if v_c.match_id is null then
    raise exception 'FAIL 5b: no match created';
  end if;
  if v_c.to_team_id <> (select id from t_ids where label = 'team_B') then
    raise exception 'FAIL 5c: to_team_id not recorded';
  end if;

  -- Only the two captains are confirmed. Everyone else must be 'invited' and
  -- asked, not committed on their behalf.
  select count(*) into v_seated
    from public.match_players where match_id = v_c.match_id and status = 'confirmed';
  if v_seated < 1 then
    raise exception 'FAIL 5d: no captain seated';
  end if;
  if exists (
    select 1
      from public.match_players mp
      join public.team_members tm
        on tm.user_id = mp.user_id
       and tm.team_id in (v_c.from_team_id, v_c.to_team_id)
     where mp.match_id = v_c.match_id
       and mp.status = 'confirmed'
       and tm.role <> 'owner'
  ) then
    raise exception 'FAIL 5f: a non-owner was auto-confirmed without being asked';
  end if;

  -- filled_slots counts only confirmed players, so an invite must not inflate it.
  if (select filled_slots from public.matches where id = v_c.match_id)
     > 1 + v_seated then
    raise exception 'FAIL 5g: filled_slots counted unconfirmed players';
  end if;

  if not exists (
    select 1 from public.challenge_candidates
     where challenge_id = v_c.id
       and team_id = (select id from t_ids where label = 'team_B')
       and status = 'accepted'
  ) then
    raise exception 'FAIL 5e: candidate not marked accepted';
  end if;

  raise notice 'PASS 5: accept creates match and closes challenge';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Second accept on the same challenge is refused (first-wins).
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m)
  values ((select id from t_ids where label = 'challenge_rank'),
          (select id from t_ids where label = 'team_C'), 2, 8000)
  on conflict do nothing;

  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_C'))::text, true);

  begin
    perform public.accept_open_challenge(
      (select id from t_ids where label = 'challenge_rank'),
      (select id from t_ids where label = 'team_C'));
    raise exception 'FAIL 6: challenge was accepted twice';
  exception when sqlstate '23514' then
    raise notice 'PASS 6: CHALLENGE_ALREADY_TAKEN enforced';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Zero candidates is not an error. Post from team D, which is 120 km away
--    from every other team, and confirm the challenge still lands.
-- ---------------------------------------------------------------------------
do $$
declare v_row public.team_challenges%rowtype;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_D'))::text, true);

  v_row := public.post_open_challenge(
    (select id from t_ids where label = 'team_D'),
    'Lonely fixture',
    (select id from t_ids where label = 'venue'),
    now() + interval '3 days',
    20,
    null,
    1000            -- 1 km radius: nothing can qualify
  );

  if v_row.status <> 'open' then
    raise exception 'FAIL 7a: challenge not open';
  end if;
  if exists (select 1 from public.challenge_candidates where challenge_id = v_row.id) then
    raise exception 'FAIL 7b: candidates found inside a 1km radius';
  end if;
  insert into t_ids values ('challenge_D', v_row.id);
  raise notice 'PASS 7: zero candidates degrades to an empty offer list';
end $$;

-- ---------------------------------------------------------------------------
-- 8. team_schedule_conflict — overlap, not "any open challenge exists".
--
-- Team D has one open challenge from test 7, at now()+3 days, no end_time
-- (assumed to run 3 hours per team_schedule_conflict's fallback).
-- ---------------------------------------------------------------------------
do $$
declare v_row public.team_challenges%rowtype;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_D'))::text, true);

  -- 8a. A non-overlapping date must be allowed — this is exactly the bug
  -- being fixed: the old rule blocked ANY second post regardless of when.
  v_row := public.post_open_challenge(
    (select id from t_ids where label = 'team_D'),
    'Non-overlapping fixture',
    (select id from t_ids where label = 'venue'),
    now() + interval '4 days', 20, null, 1000);
  if v_row.status <> 'open' then
    raise exception 'FAIL 8a: non-overlapping post was not allowed';
  end if;
  raise notice 'PASS 8a: a team may hold two open challenges on different dates';

  -- 8b. A time that overlaps the test-7 challenge's assumed 3-hour window
  -- must be blocked.
  begin
    perform public.post_open_challenge(
      (select id from t_ids where label = 'team_D'),
      'Overlapping fixture',
      (select id from t_ids where label = 'venue'),
      now() + interval '3 days' + interval '1 hour', 20, null, 1000);
    raise exception 'FAIL 8b: an overlapping post was allowed';
  exception when sqlstate '23505' then
    if sqlerrm not like 'TEAM_SCHEDULE_CONFLICT|%' then
      raise exception 'FAIL 8b: wrong conflict raised: %', sqlerrm;
    end if;
    raise notice 'PASS 8b: TEAM_SCHEDULE_CONFLICT enforced for an overlapping time';
  end;

  -- 8c. Withdrawing the conflicting challenge frees the slot — matches
  -- searching.tsx's "Change radius" flow, which withdraws before re-posting.
  perform public.cancel_challenge(
    (select id from t_ids where label = 'challenge_D')
  );
  v_row := public.post_open_challenge(
    (select id from t_ids where label = 'team_D'),
    'Re-posted after withdraw',
    (select id from t_ids where label = 'venue'),
    now() + interval '3 days' + interval '1 hour', 20, null, 1000);
  if v_row.status <> 'open' then
    raise exception 'FAIL 8c: post after withdrawing the conflict was not allowed';
  end if;
  raise notice 'PASS 8c: withdrawing the conflicting challenge unblocks the slot';
end $$;

-- ---------------------------------------------------------------------------
-- 8d. The same check also fires against a real `matches` row, not only
-- `team_challenges`. Team A has a confirmed match from test 5, at
-- now()+2 days, status 'open'. Posting a new challenge for team A at an
-- overlapping time must be blocked; a clear day must not be.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from t_ids where label = 'owner_A'))::text, true);

  begin
    perform public.post_open_challenge(
      (select id from t_ids where label = 'team_A'),
      'Clashes with the confirmed match',
      (select id from t_ids where label = 'venue'),
      now() + interval '2 days' + interval '1 hour', 20, null, 1000);
    raise exception 'FAIL 8d: a post overlapping a confirmed match was allowed';
  exception when sqlstate '23505' then
    if sqlerrm not like 'TEAM_SCHEDULE_CONFLICT|%' then
      raise exception 'FAIL 8d: wrong conflict raised: %', sqlerrm;
    end if;
    raise notice 'PASS 8d: TEAM_SCHEDULE_CONFLICT enforced against a real match';
  end;

  perform public.post_open_challenge(
    (select id from t_ids where label = 'team_A'),
    'A clear day is fine',
    (select id from t_ids where label = 'venue'),
    now() + interval '9 days', 20, null, 1000);
  raise notice 'PASS 8e: a non-overlapping day is unaffected by the confirmed match';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Expiry closes past open challenges and their outstanding offers.
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  update public.team_challenges
     set scheduled_at = now() - interval '1 hour'
   where status = 'open';

  v_n := public.expire_open_challenges();
  if v_n < 1 then
    raise exception 'FAIL 9a: expire_open_challenges closed nothing';
  end if;
  if exists (select 1 from public.team_challenges where status = 'open') then
    raise exception 'FAIL 9b: an open challenge survived expiry';
  end if;
  raise notice 'PASS 9: expiry closes challenges and offers';
end $$;

rollback;
