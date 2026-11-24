# Handoff Report: Database & Concurrency Architecture Survey

## 1. Observation
1. **Existing Venue Table & Columns:**
   - In `supabase/migrations/20260627063252_phase1_schema.sql` (lines 54–67), `public.venues` was created with `id`, `name`, `address`, `lat`, `lng`, `location`, `sport_types`, `phone`, `confirm_note`, `created_by`, `created_at`.
   - In `supabase/migrations/20260815070000_venue_media_and_facilities.sql` (lines 5–12), `image_url`, `rating`, `rating_count`, `price_per_hour`, and `facilities` were added.
   - In `supabase/migrations/20260830120000_venue_status.sql` (lines 20–28), `status` (`'approved' | 'pending' | 'hidden'`) was added.
   - Grepping for `operating_hours` or `court` in migrations returned 0 matches: `public.venues` currently lacks operating hours, slot duration, and court configuration columns.
2. **Existing Booking Architecture:**
   - Grep search for `CREATE TABLE` across `supabase/migrations` revealed 14 table-creating migrations. No table named `bookings` or `venue_bookings` exists.
   - In `supabase/migrations/20260830130000_venue_notifies_captain_chat.sql` (line 91), the existing organiser venue assignment sends the note: *"sixfour24 has not reserved this turf, so call the ground to confirm the slot."*
   - In `app/(tabs)/venues.tsx` (lines 225–233), the only action button on venue cards is `callVenue(v.phone)` ("Call to confirm").
   - In `app/match/[id]/venue.tsx` (lines 79–88), selecting a ground calls `useSetMatchVenue` -> RPC `set_match_venue(in_match_id, in_venue_id)`, setting `matches.venue_id` without reserving any slot or picking a court.
3. **PostgreSQL Extensions:**
   - In `20260627063252_phase1_schema.sql`, `postgis` and `pgcrypto` are enabled. In `20260808084324_push_notifications.sql`, `pg_net` and `pg_cron` are enabled.
   - `btree_gist` is currently not installed.
4. **TypeScript Database Types:**
   - `src/shared/types/database.types.ts` contains types for `venues` (lines 178–223) and `matches` (lines 224–302). It does not contain `venue_bookings`.
5. **App Error Handling:**
   - `src/core/errors/AppError.ts` (lines 80–87) maps HTTP status codes and Postgres error codes `42501`, `PGRST116`, `23505`, `23514`, `429`. Code `23P01` (`exclusion_violation`) is not yet mapped and currently defaults to `unknown`.

## 2. Logic Chain
1. **Operating Settings on `public.venues`:**
   - Requirement R1 requires configurable operating hours, slot duration, and court count per venue.
   - Adding `operating_hours_start time not null default '06:00:00'`, `operating_hours_end time not null default '23:00:00'`, `slot_duration_minutes integer not null default 60`, and `courts_count integer not null default 2` satisfies R1 without breaking existing venue data.
   - Updating `nearby_venues` RPC to return these columns allows the client UI to immediately configure date and slot grids.
2. **Double-Booking Concurrency Invariant:**
   - Under concurrent requests, row-level locking (`SELECT ... FOR UPDATE`) fails on vacant slots because non-existent rows cannot be locked without coarse table- or venue-level locks.
   - A PostgreSQL exclusion constraint using `tstzrange(start_time, end_time, '[)')` with GiST index enforces interval exclusivity at the database engine level.
   - Because `uuid` and `integer` equality (`=`) in GiST requires B-tree operator classes, installing the `btree_gist` extension is mandatory.
   - Adding `WHERE (status = 'confirmed')` creates a partial index that immediately excludes cancelled bookings.
3. **Atomic Booking & User Flow (RPC):**
   - The RPC `book_venue_slot` validates that `court_number <= courts_count`, validates time boundaries against operating hours, catches `exclusion_violation` (`23P01`), and translates it to `SLOT_ALREADY_TAKEN`.
   - If `in_match_id` is passed, `book_venue_slot` updates `matches.venue_id`, `matches.venue_text`, `matches.scheduled_at`, and `matches.end_time` in the same atomic transaction.
4. **Immediate Slot Freeing via Cancellation (RPC):**
   - The RPC `cancel_venue_booking` sets `status = 'cancelled'`.
   - Because the GiST index predicate is `WHERE (status = 'confirmed')`, updating `status` removes the row from the index in the exact same transaction, releasing the slot instantly.
5. **Dynamic Slot Grid RPC:**
   - `get_venue_slots(in_venue_id, in_date, in_timezone)` generates the full grid using `generate_series` across venue operating hours and cross-joins with courts (1..`courts_count`), left-joining confirmed bookings.
   - This delivers a fast, server-side computed availability grid per court for any selected date in one network call.

## 3. Caveats
1. **Timezone Context:** The database timestamps (`start_time`, `end_time`, `scheduled_at`) are stored in UTC (`timestamptz`). Venue operating hours (`06:00:00` to `23:00:00`) represent local wall-clock time at the physical venue. By defaulting `in_timezone` to `'Asia/Kolkata'` in the RPC (with override capability), all slots align with India Standard Time.
2. **Past Slot Bookings:** The booking RPC rejects booking slots in the past (`in_start_time < now() - interval '5 minutes'`). A 5-minute buffer is provided to avoid rejecting bookings during clock-skew or brief user hesitation.
3. **Payment Gateways:** The current request models slot reservation and availability directly. No external payment gateway (Razorpay/Stripe) integration was requested or assumed.

## 4. Conclusion
1. Implement the new migration `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`:
   - Enable `btree_gist`.
   - Alter `public.venues` to add `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, `courts_count`.
   - Create `public.venue_bookings` with partial GiST exclusion constraint `venue_bookings_no_double_booking`.
   - Implement `book_venue_slot`, `cancel_venue_booking`, and `get_venue_slots` RPCs.
   - Update `nearby_venues` RPC with the new venue fields.
   - Configure RLS policies (authenticated read, RPC-only writes).
2. Update `src/shared/types/database.types.ts` with the new columns, tables, and RPC signatures.
3. Update `src/core/errors/AppError.ts` to map `23P01` and `SLOT_ALREADY_TAKEN` to `AppError('conflict', 'Slot already taken. Please choose another court or time.')`.
4. Detailed blueprint, SQL code, and TypeScript types are documented in `survey_db_report.md`.

## 5. Verification Method
1. **Migration Syntax & Idempotency:**
   - Inspect `survey_db_report.md` Section 6, 7, and 9 for SQL definitions.
   - Verify `CREATE EXTENSION IF NOT EXISTS btree_gist;` and table creation with `IF NOT EXISTS`.
2. **Postgres Exclusion Constraint Behavior:**
   - Test inserting two overlapping rows:
     `INSERT INTO venue_bookings (venue_id, court_number, user_id, start_time, end_time, status) VALUES ('...', 1, '...', '2026-09-05 10:00+00', '2026-09-05 11:00+00', 'confirmed');`
     Second identical or overlapping insert must fail with error code `23P01`.
   - Test back-to-back rows (`10:00-11:00` and `11:00-12:00`): must both succeed due to `'[)'` half-open bounds.
   - Test different courts (`court_number` 1 vs 2): must both succeed.
   - Test cancellation: Update first booking to `status = 'cancelled'`. Inserting an identical time slot on Court 1 must immediately succeed.
3. **Type Checking:**
   - Run `npx tsc --noEmit` after updating `database.types.ts` and `AppError.ts` to verify 0 compiler errors.
