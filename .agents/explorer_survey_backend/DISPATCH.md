# Dispatch: Backend Service & Slot Calculation Architecture Survey

## Mission
Investigate the existing service layer, state management, Supabase client operations, slot computation logic, conflict error handling, and match linking.

## Context & Inputs
- Codebase root: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`
- Original user request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Your working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_backend`

## Specific Investigation Tasks
1. Identify how backend/API requests and Supabase queries are structured (e.g. `src/services/`, `src/lib/`, hooks, or context).
2. Look for existing venue and booking services, types, and mock data (if any).
3. Investigate the dynamic time slot computation algorithm needed:
   - Given a venue with operating hours (e.g., `06:00` to `23:00`), slot duration (e.g., 60 mins), and number of courts (`courts_count`, e.g. 1..N):
   - For any selected date, generate all candidate time slots for each court.
   - Cross-reference with existing confirmed bookings for that venue, court, and date to flag slots as available or booked/occupied.
4. Investigate how double-booking errors are caught and surfaced:
   - Detect DB constraint failure or RPC conflict error code/message.
   - Return clean "Slot already taken" error message to caller/UI.
5. Investigate booking cancellation flow and match linking:
   - How matches reference venue bookings or ground slots.
   - How canceling a booking updates the DB and frees the slot in state.
6. Check TypeScript build setup (`tsconfig.json`, `package.json`, build/test scripts).

## Output
Write a comprehensive report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_backend\survey_backend_report.md` and complete your `handoff.md`.
