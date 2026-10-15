-- ============================================================================
-- venue_slot_booking_and_concurrency_test.sql
-- Verification test suite for 20260904120000_venue_slot_booking_and_concurrency.sql
-- ============================================================================

begin;

set local client_min_messages to notice;

-- Test fixtures
create temporary table t_m1_venue_test_ids (label text primary key, id uuid not null);

do $$
declare
  v_venue_id         uuid;
  v_pending_venue_id uuid;
  v_user1_id         uuid;
  v_user2_id         uuid;
  v_match_id         uuid;
  v_booking1         public.venue_bookings%rowtype;
  v_booking2         public.venue_bookings%rowtype;
  v_booking3         public.venue_bookings%rowtype;
  v_booking4         public.venue_bookings%rowtype;
  v_slot_count       integer;
  v_avail_cnt        integer;
  v_occ_cnt          integer;
  v_start_time       timestamptz;
  v_end_time         timestamptz;
  v_early_start      timestamptz;
  v_early_end        timestamptz;
  v_late_start       timestamptz;
  v_late_end         timestamptz;
  v_unaligned_start  timestamptz;
  v_unaligned_end    timestamptz;
  v_nearby_count     integer;
  v_nearby_venue     record;
  v_err_code         text;
  v_err_msg          text;
  v_match_row        public.matches%rowtype;
begin
  raise notice 'Starting Venue Slot Booking and Concurrency Test Suite...';

  -- 1. Create Test Venue with 2 courts, 60-min slots, 06:00 to 23:00
  insert into public.venues (
    name, address, lat, lng, sport_types, status,
    operating_hours_start, operating_hours_end, slot_duration_minutes, courts_count
  ) values (
    'Central Arena Pune', 'Shivajinagar, Pune', 18.5314, 73.8446, array['box_cricket', 'football'], 'approved',
    '06:00:00', '23:00:00', 60, 2
  ) returning id into v_venue_id;
  insert into t_m1_venue_test_ids values ('venue', v_venue_id);

  -- 2. Create Test Users
  v_user1_id := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_user1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user1@venue.test');
  insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
  values (v_user1_id, 'Alice Organizer', 18.5314, 73.8446, array['box_cricket']);
  insert into t_m1_venue_test_ids values ('user1', v_user1_id);

  v_user2_id := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email)
  values (v_user2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user2@venue.test');
  insert into public.profiles (id, full_name, home_lat, home_lng, sport_pref)
  values (v_user2_id, 'Bob Player', 18.5314, 73.8446, array['box_cricket']);
  insert into t_m1_venue_test_ids values ('user2', v_user2_id);

  -- Target tomorrow 10:00 AM to 11:00 AM Asia/Kolkata
  v_start_time := ((current_date + interval '1 day') + time '10:00:00') at time zone 'Asia/Kolkata';
  v_end_time   := ((current_date + interval '1 day') + time '11:00:00') at time zone 'Asia/Kolkata';

  -- TEST 1: User 1 books Court 1 for 10:00-11:00
  -- Simulate auth as user 1
  perform set_config('request.jwt.claim.sub', v_user1_id::text, true);

  v_booking1 := public.book_venue_slot(
    in_venue_id     := v_venue_id,
    in_court_number := 1,
    in_start_time   := v_start_time,
    in_end_time     := v_end_time,
    in_match_id     := null,
    in_notes        := 'Practice match'
  );

  assert v_booking1.id is not null, 'Test 1 Failed: booking1 should be created';
  assert v_booking1.status = 'confirmed', 'Test 1 Failed: status must be confirmed';
  assert v_booking1.court_number = 1, 'Test 1 Failed: court must be 1';
  raise notice 'Test 1 Passed: Initial slot booking confirmed for Court 1.';

  -- TEST 2: Double-Booking Prevention: User 2 tries to book the EXACT SAME slot on Court 1
  perform set_config('request.jwt.claim.sub', v_user2_id::text, true);

  begin
    v_booking2 := public.book_venue_slot(
      in_venue_id     := v_venue_id,
      in_court_number := 1,
      in_start_time   := v_start_time,
      in_end_time     := v_end_time
    );
    raise exception 'Test 2 Failed: Double booking was not prevented!';
  exception
    when sqlstate '23P01' then
      get stacked diagnostics v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      assert v_err_msg = 'SLOT_ALREADY_TAKEN', 'Test 2 Failed: Expected SLOT_ALREADY_TAKEN message';
      raise notice 'Test 2 Passed: Exact overlap prevented with 23P01 / SLOT_ALREADY_TAKEN.';
  end;

  -- TEST 3: Multi-Court Independence: User 2 books Court 2 for the SAME time window (10:00-11:00)
  v_booking2 := public.book_venue_slot(
    in_venue_id     := v_venue_id,
    in_court_number := 2,
    in_start_time   := v_start_time,
    in_end_time     := v_end_time,
    in_notes        := 'Simultaneous match on Court 2'
  );
  assert v_booking2.id is not null, 'Test 3 Failed: Court 2 booking must succeed';
  assert v_booking2.court_number = 2, 'Test 3 Failed: Court number must be 2';
  raise notice 'Test 3 Passed: Multi-court concurrent bookings succeed independently.';

  -- TEST 4: Adjacent Slot Allowed: User 2 books Court 1 for 11:00-12:00 (back-to-back half-open range)
  v_booking3 := public.book_venue_slot(
    in_venue_id     := v_venue_id,
    in_court_number := 1,
    in_start_time   := v_end_time,
    in_end_time     := v_end_time + interval '1 hour'
  );
  assert v_booking3.id is not null, 'Test 4 Failed: Adjacent back-to-back slot must succeed';
  raise notice 'Test 4 Passed: Adjacent back-to-back slot succeeded with half-open intervals.';

  -- TEST 5: Dynamic Slot Matrix Calculation (get_venue_slots)
  perform set_config('request.jwt.claim.sub', v_user1_id::text, true);

  select count(*),
         count(*) filter (where is_available),
         count(*) filter (where not is_available)
    into v_slot_count, v_avail_cnt, v_occ_cnt
    from public.get_venue_slots(v_venue_id, current_date + 1, 'Asia/Kolkata');

  -- Operating hours: 06:00 to 23:00 -> 17 hours per court * 2 courts = 34 total slots
  assert v_slot_count = 34, 'Test 5 Failed: Expected 34 total slots (17 hours * 2 courts), got ' || v_slot_count;
  -- 3 bookings exist: Court 1 (10-11, 11-12) and Court 2 (10-11) -> 3 occupied slots
  assert v_occ_cnt = 3, 'Test 5 Failed: Expected 3 occupied slots, got ' || v_occ_cnt;
  assert v_avail_cnt = 31, 'Test 5 Failed: Expected 31 available slots, got ' || v_avail_cnt;
  raise notice 'Test 5 Passed: Dynamic slot calculation matches expected availability matrix (34 total, 3 booked).';

  -- TEST 6: User 1 cancels booking on Court 1 (10:00-11:00)
  v_booking1 := public.cancel_venue_booking(v_booking1.id);
  assert v_booking1.status = 'cancelled', 'Test 6 Failed: Booking status should be cancelled';
  assert v_booking1.cancelled_at is not null, 'Test 6 Failed: cancelled_at should be populated';
  raise notice 'Test 6 Passed: Booking cancellation succeeded.';

  -- TEST 7: Instant Slot Re-booking after cancellation: User 2 can now book Court 1 for 10:00-11:00
  perform set_config('request.jwt.claim.sub', v_user2_id::text, true);

  v_booking4 := public.book_venue_slot(
    in_venue_id     := v_venue_id,
    in_court_number := 1,
    in_start_time   := v_start_time,
    in_end_time     := v_end_time
  );
  assert v_booking4.id is not null, 'Test 7 Failed: Slot must be immediately available after cancellation';
  raise notice 'Test 7 Passed: Immediate slot re-booking confirmed after cancellation.';

  -- TEST 8: Match Linking & Unlinking
  -- Create an open match owned by User 1
  insert into public.matches (
    sport, creator_id, match_type, status, scheduled_at, duration_minutes
  ) values (
    'box_cricket', v_user1_id, 'casual_match', 'open', v_start_time + interval '2 days', 60
  ) returning id into v_match_id;

  perform set_config('request.jwt.claim.sub', v_user1_id::text, true);

  -- Book slot linked to the match
  v_booking1 := public.book_venue_slot(
    in_venue_id     := v_venue_id,
    in_court_number := 1,
    in_start_time   := v_start_time + interval '2 days',
    in_end_time     := v_end_time + interval '2 days',
    in_match_id     := v_match_id
  );

  select * into v_match_row from public.matches where id = v_match_id;
  assert v_match_row.venue_id = v_venue_id, 'Test 8 Failed: Match venue_id must match venue';
  assert v_match_row.venue_text like '%(Court 1)', 'Test 8 Failed: Match venue_text must include court';
  assert v_match_row.scheduled_at = (v_start_time + interval '2 days'), 'Test 8 Failed: Match scheduled_at must be updated';
  raise notice 'Test 8 Passed: Match atomically linked to venue booking.';

  -- Cancel booking and verify match venue reference is cleared
  v_booking1 := public.cancel_venue_booking(v_booking1.id);
  select * into v_match_row from public.matches where id = v_match_id;
  assert v_match_row.venue_id is null, 'Test 8 Failed: Match venue_id must be cleared on cancellation';
  assert v_match_row.venue_text is null, 'Test 8 Failed: Match venue_text must be cleared on cancellation';
  raise notice 'Test 8 Passed: Match atomically unlinked on cancellation.';

  -- TEST 9: nearby_venues filters on status = 'approved' and exposes operating fields
  insert into public.venues (
    name, address, lat, lng, sport_types, status,
    operating_hours_start, operating_hours_end, slot_duration_minutes, courts_count
  ) values (
    'Pending Test Ground', 'Kothrud, Pune', 18.5074, 73.8077, array['box_cricket'], 'pending',
    '07:00:00', '22:00:00', 60, 1
  ) returning id into v_pending_venue_id;

  -- Query nearby_venues near Pune
  select count(*) into v_nearby_count
    from public.nearby_venues(18.5314, 73.8446, 50000, 'box_cricket')
   where id = v_pending_venue_id;

  assert v_nearby_count = 0, 'Test 9 Failed: Pending venue must not be returned by nearby_venues';

  select * into v_nearby_venue
    from public.nearby_venues(18.5314, 73.8446, 50000, 'box_cricket')
   where id = v_venue_id;

  assert v_nearby_venue.id is not null, 'Test 9 Failed: Approved venue must be returned by nearby_venues';
  assert v_nearby_venue.operating_hours_start = time '06:00:00', 'Test 9 Failed: operating_hours_start mismatch';
  assert v_nearby_venue.operating_hours_end = time '23:00:00', 'Test 9 Failed: operating_hours_end mismatch';
  assert v_nearby_venue.slot_duration_minutes = 60, 'Test 9 Failed: slot_duration_minutes mismatch';
  assert v_nearby_venue.courts_count = 2, 'Test 9 Failed: courts_count mismatch';
  raise notice 'Test 9 Passed: nearby_venues filters status = approved and correctly exposes operating configuration.';

  -- TEST 10: Operating Hours Validation (OUTSIDE_OPERATING_HOURS, 23514)
  perform set_config('request.jwt.claim.sub', v_user1_id::text, true);

  -- 10a. Attempt early booking: 05:00 to 06:00 (venue opens at 06:00)
  v_early_start := ((current_date + interval '3 days') + time '05:00:00') at time zone 'Asia/Kolkata';
  v_early_end   := ((current_date + interval '3 days') + time '06:00:00') at time zone 'Asia/Kolkata';
  begin
    perform public.book_venue_slot(
      in_venue_id     := v_venue_id,
      in_court_number := 1,
      in_start_time   := v_early_start,
      in_end_time     := v_early_end
    );
    raise exception 'Test 10a Failed: Early slot before operating hours was not rejected!';
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      assert v_err_msg = 'OUTSIDE_OPERATING_HOURS', 'Test 10a Failed: Expected OUTSIDE_OPERATING_HOURS, got ' || coalesce(v_err_msg, 'null');
      raise notice 'Test 10a Passed: Booking before operating_hours_start rejected with OUTSIDE_OPERATING_HOURS.';
  end;

  -- 10b. Attempt late booking: 23:00 to 00:00 (venue closes at 23:00)
  v_late_start := ((current_date + interval '3 days') + time '23:00:00') at time zone 'Asia/Kolkata';
  v_late_end   := ((current_date + interval '4 days') + time '00:00:00') at time zone 'Asia/Kolkata';
  begin
    perform public.book_venue_slot(
      in_venue_id     := v_venue_id,
      in_court_number := 1,
      in_start_time   := v_late_start,
      in_end_time     := v_late_end
    );
    raise exception 'Test 10b Failed: Late slot after operating hours was not rejected!';
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      assert v_err_msg = 'OUTSIDE_OPERATING_HOURS', 'Test 10b Failed: Expected OUTSIDE_OPERATING_HOURS, got ' || coalesce(v_err_msg, 'null');
      raise notice 'Test 10b Passed: Booking after operating_hours_end rejected with OUTSIDE_OPERATING_HOURS.';
  end;

  -- TEST 11: Discrete Slot Grid Alignment (UNALIGNED_SLOT_START, 23514)
  -- 10:15 to 11:15 is within operating hours (06:00-23:00) and duration 60 mins is valid,
  -- but start is offset by 15 mins from operating grid (06:00 + 4h15m)
  v_unaligned_start := ((current_date + interval '3 days') + time '10:15:00') at time zone 'Asia/Kolkata';
  v_unaligned_end   := ((current_date + interval '3 days') + time '11:15:00') at time zone 'Asia/Kolkata';
  begin
    perform public.book_venue_slot(
      in_venue_id     := v_venue_id,
      in_court_number := 1,
      in_start_time   := v_unaligned_start,
      in_end_time     := v_unaligned_end
    );
    raise exception 'Test 11 Failed: Unaligned slot start was not rejected!';
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      assert v_err_msg = 'UNALIGNED_SLOT_START', 'Test 11 Failed: Expected UNALIGNED_SLOT_START, got ' || coalesce(v_err_msg, 'null');
      raise notice 'Test 11 Passed: Unaligned start time rejected with UNALIGNED_SLOT_START.';
  end;

  -- TEST 12: Unapproved Venue Direct Booking Rejection (VENUE_NOT_FOUND, P0002)
  begin
    perform public.book_venue_slot(
      in_venue_id     := v_pending_venue_id,
      in_court_number := 1,
      in_start_time   := ((current_date + interval '3 days') + time '10:00:00') at time zone 'Asia/Kolkata',
      in_end_time     := ((current_date + interval '3 days') + time '11:00:00') at time zone 'Asia/Kolkata'
    );
    raise exception 'Test 12 Failed: Booking unapproved venue was not rejected!';
  exception
    when sqlstate 'P0002' then
      get stacked diagnostics v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      assert v_err_msg = 'VENUE_NOT_FOUND', 'Test 12 Failed: Expected VENUE_NOT_FOUND, got ' || coalesce(v_err_msg, 'null');
      raise notice 'Test 12 Passed: Booking unapproved venue rejected with VENUE_NOT_FOUND.';
  end;

  raise notice 'All 12 Venue Slot Booking, Status Filtering and Operating Boundary Tests Passed Successfully!';
end;
$$;

rollback;
