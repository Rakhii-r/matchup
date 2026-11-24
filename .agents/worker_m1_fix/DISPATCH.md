# Dispatch: Worker M1 Fix (Iteration 2)

## Mission
Fix the two issues identified by Reviewer 2 in `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`:
1. In `nearby_venues`, re-add `where v.status = 'approved'`.
2. In `book_venue_slot`, add validation that booking falls within operating hours and aligns with slot boundaries in IST (`Asia/Kolkata`).

## Context & Feedback
- Target file: `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`
- Companion test: `supabase/tests/venue_slot_booking_and_concurrency_test.sql`
- Reviewer 2 Feedback:
  - Critical Regression: `nearby_venues` dropped `where v.status = 'approved'`, re-exposing unapproved venues.
  - Edge Case: `book_venue_slot` allowed booking times outside `operating_hours_start`/`end` and unaligned start times (e.g. 10:15–11:15), which poisoned court availability for discrete slots in the GiST index.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Fix Requirements
1. **`nearby_venues`**:
   Ensure the query contains:
   ```sql
   where v.status = 'approved'
     and ST_DWithin(v.location, v_origin, in_radius_meters)
     and (in_sport is null or in_sport = any(v.sport_types))
   ```
2. **`book_venue_slot`**:
   Add operating hours boundary and alignment check in `Asia/Kolkata`:
   ```sql
   -- Operating hours & slot grid alignment check
   declare
     v_tz text := 'Asia/Kolkata';
     v_local_start time := (in_start_time at time zone v_tz)::time;
     v_local_end   time := (in_end_time at time zone v_tz)::time;
     v_offset_min  integer;
   begin
     if v_local_start < v_venue.operating_hours_start or v_local_end > v_venue.operating_hours_end then
       raise exception 'OUTSIDE_OPERATING_HOURS' using errcode = '23514';
     end if;

     v_offset_min := round(extract(epoch from (v_local_start - v_venue.operating_hours_start)) / 60)::integer;
     if v_offset_min < 0 or (v_offset_min % v_venue.slot_duration_minutes <> 0) then
       raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
     end if;
   ```
3. Update `supabase/tests/venue_slot_booking_and_concurrency_test.sql` to verify these two validations.
4. Deliver `handoff.md` and report back via `send_message`.

## 2026-09-04T11:48:22Z
You are worker_m1_fix.
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1_fix
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1_fix\DISPATCH.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\supabase\migrations\20260904120000_venue_slot_booking_and_concurrency.sql
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\supabase\tests\venue_slot_booking_and_concurrency_test.sql

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Apply the required fixes:
1. Re-add where v.status = 'approved' to nearby_venues.
2. In book_venue_slot, add validation that in_start_time and in_end_time fall within operating hours and align with discrete slot step boundaries in Asia/Kolkata.
3. Update tests in supabase/tests/venue_slot_booking_and_concurrency_test.sql.
Deliver handoff.md and send_message when done.
