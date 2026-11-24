# Dispatch: Database & Concurrency Architecture Survey

## Mission
Investigate the existing codebase regarding database schema, Supabase migrations/tables, venue operating settings, court/box configuration, and double-booking concurrency protection.

## Context & Inputs
- Codebase root: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`
- Original user request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Your working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_db`

## Specific Investigation Tasks
1. Search for existing Supabase migrations, SQL scripts, or database schema definitions related to `venues`, `grounds`, `bookings`, `courts`, `matches`, etc.
2. Determine how venue operating settings (`operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, `courts_count`) are or can be stored.
3. Determine how bookings are stored (table name, columns: `venue_id`, `court_number`, `start_time`, `end_time`, `status`, `match_id`, etc.).
4. Investigate PostgreSQL concurrency protection options for this project: `btree_gist` extension, `tstzrange` exclusion constraint (`EXCLUDE USING gist (venue_id WITH =, court_number WITH =, tstzrange(start_time, end_time) WITH &&) WHERE (status = 'confirmed')`), or database RPC function with row locking (`SELECT ... FOR UPDATE`).
5. Check how cancellation is handled (updating status to 'cancelled' so exclusion constraint releases the slot immediately).
6. Detail exact SQL statements, migration files, and type changes needed.

## Output
Write a comprehensive report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_db\survey_db_report.md` and complete your `handoff.md`.

## 2026-09-04T11:27:44Z
Investigate the database architecture, Supabase schema/migrations, existing venue and booking tables, PostgreSQL exclusion constraints (tstzrange with btree_gist) or locking RPCs, cancellation logic, and necessary schema updates.
Write findings to `survey_db_report.md` and deliver complete `handoff.md`.
