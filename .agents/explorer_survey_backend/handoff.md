# Handoff Report: Backend Service & Slot Booking Architecture Survey

**Agent**: survey_backend_explorer  
**Milestone**: Backend Architecture Survey  
**Working Directory**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_backend`  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

1. **Venue Directory and Absence of Bookings Table**:
   - `supabase/migrations/20260627063252_phase1_schema.sql` (lines 54–68) establishes `public.venues` as a static directory without operating hours (`open_time`, `close_time`), slot duration (`slot_minutes`), or parallel court count (`courts_count`).
   - `grep_search` across `supabase/migrations` for `create table.*booking` returned 0 results. No `bookings` table exists currently.
   - `MatchUp_Admin_Venue_Booking_Spec.md` (lines 103–128) contains a design draft for double-booking prevention using `btree_gist` exclusion constraints and RPC-based booking, but records that full slot calendar implementation was deferred to Phase 2.

2. **Feature-Driven Architecture & Supabase Client Patterns**:
   - `src/core/api/supabaseClient.ts` (lines 15–22) instantiates a single `createClient<Database>` carrying user JWTs, ensuring Postgres RLS applies to all queries.
   - Codebase strictly enforces the Repository pattern: all 15 repositories located at `src/features/<feature>/data/<feature>Repository.ts` wrap Supabase table queries and RPC calls.
   - Presentation layer uses `@tanstack/react-query` v5.59.0 (`useQuery`, `useMutation`, and `queryClient.invalidateQueries`).

3. **Existing Conflict Error Surfacing & Missing 23P01 Mapping**:
   - `src/core/errors/AppError.ts` (lines 34–43, 84–86) defines `toAppError()`. Lines 66–72 map `team_schedule_conflict` to `conflict` ("This time slot already has an active game..."). Line 84 maps HTTP 409 or Postgres code `23505` (`unique_violation`) to `conflict`.
   - Postgres exclusion constraint violations emit SQLSTATE `23P01` (`exclusion_violation`). `src/core/errors/AppError.ts` does NOT currently catch `23P01` or map it to `"Slot already taken"`.
   - `src/shared/utils/scheduleConflict.ts` (lines 34–46) parses custom formatted exceptions raised by PostgreSQL RPCs using string token matching.

4. **Match Venue Linking**:
   - `supabase/migrations/20260827110000_set_match_venue.sql` (lines 23–84) defines `set_match_venue(in_match_id, in_venue_id)` which attaches an approved venue to an existing match.
   - `src/features/matches/data/matchRepository.ts` (lines 340–348) exposes `setVenue(matchId, venueId)` calling `set_match_venue`.
   - `app/match/[id]/venue.tsx` (lines 79–88) calls `setVenue.mutate(venueId)` on press of a venue card, but does not allow court or slot selection.

5. **Current UI State**:
   - `app/(tabs)/venues.tsx` (lines 224–237) presents a static venue card list with "Call to confirm" and Google Maps directions; it has no date selector, court/box selector, or slot grid.
   - `app/admin/venues.tsx` (lines 100–155) captures only name, address, coordinates, phone, and sports; it lacks fields for `courts_count`, `open_time`, `close_time`, and `slot_minutes`.

6. **TypeScript & Compilation Setup**:
   - `tsconfig.json` extends `expo/tsconfig.base` with `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"noImplicitOverride": true`.
   - `package.json` script `"typecheck": "tsc --noEmit"` validates types.
   - `src/shared/types/database.types.ts` contains database row definitions for Supabase tables and functions.

---

## 2. Logic Chain

1. **Schema Extension (Observation 1)**:
   Because `venues` does not store operating hours, courts count, or slot durations, and no `bookings` table exists, R1 and R2 require a new database migration creating:
   - Columns on `venues`: `courts_count` (int), `open_time` (time), `close_time` (time), `slot_minutes` (int), `open_days` (int[]), `is_bookable` (bool).
   - A `bookings` table with `venue_id`, `court_no`, `start_time`, `end_time`, `time_range (tstzrange)`, `status ('confirmed'|'cancelled')`, `match_id`, and `booked_by`.

2. **Exclusion Constraint & Concurrency Safety (Observations 1 & 3)**:
   To prevent double-booking at the database level (R2):
   - Adding `btree_gist` extension and an exclusion constraint:
     `exclude using gist (venue_id with =, court_no with =, time_range with &&) where (status = 'confirmed')` guarantees that no two overlapping confirmed bookings can ever exist on the same venue court.
   - Adding transactional advisory lock in `book_court_slot` (`pg_advisory_xact_lock(hashtext('booking:' || in_venue_id::text || ':' || in_court_no::text))`) guarantees serialized validation before insert.
   - When a collision occurs, Postgres throws `23P01` or the RPC throws `'SLOT_ALREADY_TAKEN'` with code `23505`. Mapping both in `bookingRepository.ts` and `AppError.ts` produces the user-facing message `"Slot already taken"` exactly as required by R2.

3. **Dynamic Slot Calculation (Observations 1 & 2)**:
   Because slots are computed on the fly rather than statically persisted (avoiding empty slot database bloat):
   - A SQL RPC `get_venue_slots(in_venue_id, in_date)` using `generate_series` against operating hours stepped by `slot_minutes` cross-referenced with `bookings.time_range && tstzrange(slot_start, slot_end)` produces the full grid of courts and times with statuses (`available` vs `booked` vs `past`).
   - A client-side pure calculation utility (`slotUtils.ts`) provides instantaneous optimistic updates and unit-testability.

4. **Instant Release on Cancellation (Observations 1 & 4)**:
   Because the exclusion constraint is conditionally applied (`where (status = 'confirmed')`), updating a booking's status to `'cancelled'` via `cancel_booking` instantly releases the court slot from the exclusion index. Subsequent booking attempts for that exact slot succeed immediately.

5. **Match Linking Flow (Observation 4)**:
   When booking from `app/match/[id]/venue.tsx`, passing `in_match_id` to `book_court_slot` links the booking to the match and atomically updates `matches.venue_id`, `matches.venue_text`, `matches.scheduled_at`, and `matches.end_time`, ensuring the match session boundaries are fixed and reflected in `SlotBadge`.

---

## 3. Caveats

1. **Timezone Handling**:
   Operating hours (e.g. 06:00 to 23:00) represent India Standard Time (IST, UTC+05:30). In the database, timestamps are stored in UTC (`timestamptz`). The calculation must explicitly use `at time zone 'Asia/Kolkata'` in SQL or UTC offset +05:30 in client calculations to ensure slots do not drift with the client device's local timezone.
2. **Pricing and Payments**:
   Requirement R1–R4 specifies booking management, manual court/box selection, and double-booking prevention. As confirmed in the historical spec (`MatchUp_Admin_Venue_Booking_Spec.md` §10), in-app payment collection is excluded from this phase; venues display information-only pricing (`price_per_hour`).
3. **Admin Court Configuration**:
   Admin screen `app/admin/venues.tsx` currently only captures basic directory info. Adding `courts_count`, `open_time`, `close_time`, and `slot_minutes` to the admin form will ensure newly created venues have valid booking configurations.

---

## 4. Conclusion

The existing MatchUp codebase is well-structured for the introduction of dynamic venue slot booking:
- The architectural layers (`Repository` -> `Zod Schema` -> `TanStack Query`) are clean, established, and ready to receive `src/features/bookings/`.
- PostgreSQL with `btree_gist` exclusion constraints and PL/pgSQL RPCs with advisory locking will provide 100% concurrency safety against double bookings.
- Dynamic slot calculation per court/operating hours/date can be executed cleanly in SQL via `get_venue_slots` and mirrored in client-side TypeScript utilities.
- Surfacing `"Slot already taken"` requires adding SQLSTATE `23P01` and token `'SLOT_ALREADY_TAKEN'` to the repository error mapping and `toAppError.ts`.
- All detailed findings, schemas, algorithms, and implementation steps are documented in `survey_backend_report.md`.

---

## 5. Verification Method

1. **Document Verification**:
   Inspect `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_backend\survey_backend_report.md` for full schema specifications, SQL DDL, slot generation algorithms, and repository designs.
2. **Database Concurrency Independent Verification**:
   - In PostgreSQL, verify exclusion constraint behavior:
     ```sql
     -- Attempting to insert overlapping confirmed booking must fail with 23P01:
     insert into public.bookings (venue_id, court_no, start_time, end_time, status, booked_by)
     values ('<venue_id>', 1, '2026-09-04 10:00:00+05:30', '2026-09-04 11:00:00+05:30', 'confirmed', '<uid1>');
     -- Concurrent insert:
     insert into public.bookings (venue_id, court_no, start_time, end_time, status, booked_by)
     values ('<venue_id>', 1, '2026-09-04 10:30:00+05:30', '2026-09-04 11:30:00+05:30', 'confirmed', '<uid2>');
     -- Expected: ERROR 23P01: conflicting key value violates exclusion constraint "no_double_booking"
     ```
   - In PostgreSQL, verify cancellation release:
     ```sql
     update public.bookings set status = 'cancelled' where id = '<booking_1>';
     -- Re-attempt second booking:
     insert into public.bookings (venue_id, court_no, start_time, end_time, status, booked_by)
     values ('<venue_id>', 1, '2026-09-04 10:00:00+05:30', '2026-09-04 11:00:00+05:30', 'confirmed', '<uid2>');
     -- Expected: Success (row inserted).
     ```
3. **TypeScript Compilation**:
   Run `npm run typecheck` or `npx tsc --noEmit` from the project root to ensure 0 type errors.
