# Dispatch: Milestone 1 — Database Schema, Exclusion Constraints & Booking RPCs

## Mission
Implement the full database schema migration for venue slot bookings, court operating settings, exclusion constraints (`btree_gist`), stored procedures (`book_venue_slot`, `cancel_venue_booking`, `get_venue_slots`), and RLS security policies.

## Inputs & Context
- Original Request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Project Document: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md`
- Database Survey Report: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_db\survey_db_report.md`
- Your working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1`
- Exclusively Owned Files: `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements to Implement
In `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`:
1. **Enable Extension**:
   `CREATE EXTENSION IF NOT EXISTS btree_gist;`
2. **Alter `public.venues`**:
   Add:
   - `operating_hours_start time not null default '06:00:00'`
   - `operating_hours_end time not null default '23:00:00'`
   - `slot_duration_minutes integer not null default 60 check (slot_duration_minutes in (30, 45, 60, 90, 120))`
   - `courts_count integer not null default 2 check (courts_count >= 1 and courts_count <= 20)`
   - Check constraint `venues_valid_operating_hours check (operating_hours_end > operating_hours_start)`
3. **Update `nearby_venues` RPC**:
   Ensure `nearby_venues` returns the new columns: `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, `courts_count`.
4. **Create `public.venue_bookings` Table**:
   - `id uuid primary key default gen_random_uuid()`
   - `venue_id uuid not null references public.venues(id) on delete cascade`
   - `court_number integer not null check (court_number >= 1)`
   - `user_id uuid not null references public.profiles(id) on delete cascade`
   - `start_time timestamptz not null`
   - `end_time timestamptz not null`
   - `status text not null default 'confirmed' check (status in ('confirmed', 'cancelled'))`
   - `match_id uuid references public.matches(id) on delete set null`
   - `notes text check (notes is null or char_length(notes) <= 280)`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()`
   - `cancelled_at timestamptz`
   - Check constraint `venue_bookings_valid_window check (end_time > start_time)`
   - Supporting indexes on `(venue_id, court_number, start_time) where status = 'confirmed'`, `(user_id, status)`, `(match_id) where match_id is not null`.
5. **Add Partial GiST Exclusion Constraint**:
   ```sql
   alter table public.venue_bookings
     add constraint venue_bookings_no_double_booking
     exclude using gist (
       venue_id with =,
       court_number with =,
       tstzrange(start_time, end_time, '[)') with &&
     ) where (status = 'confirmed');
   ```
6. **Implement `book_venue_slot` RPC**:
   - Security definer, search_path = public.
   - Validates user authenticated, active, venue approved, court in range [1, courts_count], valid time window, start_time not in distant past.
   - Validates match linkage if provided (user is creator, sport matches, match status open/locked).
   - Inserts booking into `public.venue_bookings`.
   - Catches `exclusion_violation` (23P01) and raises `exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';`.
   - Atomically updates match row: `venue_id`, `venue_text`, `scheduled_at = start_time`, `end_time = end_time` if `in_match_id` is passed.
   - Returns the created `venue_bookings` row.
7. **Implement `cancel_venue_booking` RPC**:
   - Security definer, search_path = public.
   - Validates caller is booking owner or admin.
   - Updates `status = 'cancelled'`, `cancelled_at = now()`, `updated_at = now()`.
   - Clears `matches.venue_id` and `matches.venue_text` if linked.
   - Returns updated booking.
8. **Implement `get_venue_slots` RPC**:
   - Stable, security definer.
   - Computes time slots across courts based on venue operating hours and slot duration interval.
   - Left joins `venue_bookings` on venue, court, confirmed status, and interval overlap.
   - Flags `is_available = (b.id is null and slot.start_time >= now() - interval '5 minutes')`.
   - Returns: `court_number`, `court_label`, `start_time`, `end_time`, `time_hhmm`, `end_time_hhmm`, `is_available`, `booking_id`, `is_my_booking`.
9. **RLS Policies & Permissions**:
   - Enable RLS on `venue_bookings`.
   - `SELECT` policy for authenticated users.
   - Direct INSERT/UPDATE/DELETE revoked from anon and authenticated.
   - Grant execute on the RPCs to authenticated.

## Deliverable
Write clean, robust SQL migration in `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`.
Deliver handoff report and notify via `send_message`.

## 2026-09-04T11:36:08Z
User Request:
You are worker_m1 (Database Migration Worker).
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_db\survey_db_report.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1\DISPATCH.md

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your mission:
Implement the complete SQL migration in supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql per the requirements in DISPATCH.md.
Deliver your handoff.md and send_message when done.
