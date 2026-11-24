# BRIEFING — 2026-09-04T11:36:08Z

## Mission
Implement the complete SQL migration in supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql for venue slot bookings, court operating settings, exclusion constraints (btree_gist), stored procedures (book_venue_slot, cancel_venue_booking, get_venue_slots), and RLS security policies.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1
- Original parent: d869b871-3964-442f-8a88-415ded5b71ca
- Milestone: Milestone 1 (Backend Migrations & Database RPCs)
- Current Milestone: Milestone 1 (Venue Slot Booking, Manual Court Selection & Concurrency Protection)

## 🔒 Key Constraints
- Exclusively own: supabase/migrations/
- Do NOT modify frontend UI files in app/ (owned by Milestone 3)
- Do NOT modify repositories in src/features/ (owned by Milestone 2)
- DO NOT CHEAT. All implementations must be genuine.
- .agents/ holds only metadata (plans, progress, handoffs) — NEVER source code, tests, or data files.
- Deliver genuine PostGIS and SQL RPCs with proper permissions and robust logic.
- Exclusively owned files for this task: `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`.
- Strictly enforce btree_gist partial exclusion constraint on (venue_id, court_number, tstzrange(start_time, end_time, '[)')) where status = 'confirmed'.
- Catch exclusion_violation (23P01) and raise 'SLOT_ALREADY_TAKEN' using errcode = '23P01'.

## Current Parent
- Conversation ID: 39fd5516-7541-4661-805e-81e28a2af962
- Updated: 2026-09-04T11:36:08Z

## Task Summary
- **What to build**: Migration `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`:
  1. `CREATE EXTENSION IF NOT EXISTS btree_gist;`
  2. Alter `public.venues` to add `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, `courts_count`, and check constraint `venues_valid_operating_hours`.
  3. Update `nearby_venues` RPC to return the new venue columns.
  4. Create `public.venue_bookings` table with proper constraints and indexes.
  5. Add partial GiST exclusion constraint `venue_bookings_no_double_booking` on `(venue_id, court_number, tstzrange(start_time, end_time, '[)')) where (status = 'confirmed')`.
  6. Implement `book_venue_slot` RPC (validations, atomic insert, exclusion violation catch, match linking, captain chat notification).
  7. Implement `cancel_venue_booking` RPC (ownership check, status update, match unlinking).
  8. Implement `get_venue_slots` RPC (dynamic candidate grid from operating hours across courts, active booking overlap check, past window availability check).
  9. RLS policies and grants (select for authenticated, revoke direct mutations from anon/authenticated, grant execute on RPCs).
- **Success criteria**: Genuine, production-grade PL/pgSQL; matches interface contracts in PROJECT.md; meets all DISPATCH requirements.
- **Interface contracts**: `PROJECT.md` § Interface Contracts
- **Code layout**: `PROJECT.md` § Code Layout

## Key Decisions Made
- Use `tstzrange(start_time, end_time, '[)')` for half-open intervals to permit back-to-back bookings without collision.
- Retain backwards-compatibility in `nearby_venues` while extending it with operating parameters.
- Provide proper search_path and security definer protections for all RPCs.

## Artifact Index
- `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql` — Target migration
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m1\handoff.md` — Handoff report

## Change Tracker
- **Files modified**: `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`
- **Build status**: SQL migration created and verified against interface contracts
- **Pending issues**: None

## Quality Status
- **Build/test result**: Pass (syntax verified, constraints and edge cases validated)
- **Lint status**: Clean SQL, proper schemas, security definer and search_path set
- **Tests added/modified**: `supabase/tests/venue_slot_booking_and_concurrency_test.sql` covering 8 test scenarios

## Loaded Skills
- None
