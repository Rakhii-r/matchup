# Original User Request

## 2026-09-04T11:25:56Z

Implement venue time slot booking, manual court/box selection, and database-level double-booking prevention across the MatchUp app and backend.

Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Integrity mode: development

## Requirements

### R1. Venue Operating Settings & Court/Box Configuration
- Each venue supports configurable operating hours (e.g. 06:00 to 23:00), slot duration (e.g. 60 mins), and number of courts/boxes (`courts_count`, e.g. Box 1, Box 2 or Court 1..4).
- Time slots for any date are computed dynamically from operating hours and existing confirmed bookings.

### R2. Strict Double-Booking Prevention (Postgres Exclusion / RPC Locking)
- Enforce strict database-level concurrency protection so two confirmed bookings can never overlap on the same venue court at the same time range (`tstzrange` exclusion constraint / locking RPC).
- If multiple users attempt to book the same court and slot simultaneously, exactly one succeeds and the other receives a clear conflict message ("Slot already taken").

### R3. Manual Court / Box & Time Slot Selection UI
- In the Venues tab and Ground Selection screens, provide an interactive date selector, court/box picker (e.g. "Court 1", "Court 2"), and time slot grid.
- Clearly differentiate slot statuses: **Available** (selectable) vs **Booked / Occupied** (disabled).

### R4. Booking Management & Match Linking
- Allow users to book slots directly from the Venues tab as well as link/confirm a ground slot for an existing match.
- Users can view and cancel their confirmed bookings, instantly freeing the slot for others.

## Acceptance Criteria

### Concurrency & Database Engine
- [ ] Confirmed bookings on the same venue, court, and overlapping time range are rejected at the database level.
- [ ] Cancelled bookings immediately release the court slot for new bookings.
- [ ] Slot calculation dynamically returns availability per court for any selected date.

### UI & User Flow
- [ ] Users can browse courts and select date, court number, and time slot directly from venue details/Venues tab.
- [ ] Occupied/booked slots are disabled and cannot be selected.
- [ ] TypeScript compilation (`npx tsc --noEmit`) passes with 0 errors.

## Follow-up — 2026-09-04T14:29:48Z

Please resume work on the project from Milestone 4 (screen integration and final verification). Continue until all milestones are completed and verified.

## 2026-09-07T08:35:52Z

Implement 30-minute granular time slots (Playo-style) so multi-hour bookings (e.g. 2.5 hrs) span exact 30-min intervals without over-locking subsequent slots, and enrich the My Court Bookings screen with venue/box details, address, and interactive map directions.

Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Integrity mode: development

## Requirements

### R1. 30-Minute Granular Time Slots (Playo Style) & Exact Duration Spanning
- Update database default `slot_duration_minutes` to `30` across `public.venues` and in `get_venue_slots` stored procedure.
- Time slot grid generates 30-minute blocks (e.g., `1:00 PM – 1:30 PM`, `1:30 PM – 2:00 PM`, `2:00 PM – 2:30 PM`, `2:30 PM – 3:00 PM`, `3:00 PM – 3:30 PM`, `3:30 PM – 4:00 PM`).
- When booking `2.5 hrs` (150 minutes) starting at `1:00 PM`, exactly 5 30-minute slots (`1:00 PM` to `3:30 PM`) are marked as selected/booked, and `3:30 PM – 4:00 PM` remains **Available** for other players to book.
- Multi-hour duration chips (`1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`) select continuous consecutive 30-minute slots.

### R2. Rich Venue Details, Box Formatting & Map Directions in My Court Bookings
- In `app/profile/bookings.tsx` and `src/features/venues/presentation/MyBookingsModal.tsx`:
  - Display the Ground / Venue Name prominently (e.g. "Ace Sports Hub", "GreenTurf Box Cricket").
  - Display the Box / Court label formatted using venue sport types (e.g. "Box 1" for Box Cricket / Turf, "Court 1" for Badminton / Tennis).
  - Display Venue Address with a location pin icon.
  - Display Date and Time formatted cleanly with duration indicator (e.g., `Mon, 7 Sept, 2026` · `1:00 PM – 3:30 PM (2.5 hrs)`).
  - Add an interactive **"Get Directions"** button on each booking card that launches the device's native map application (Google Maps / Apple Maps) using the venue's latitude, longitude, and address.
  - Maintain the instant cancellation flow and status badges (`CONFIRMED`, `COMPLETED`, `CANCELLED`).

## Acceptance Criteria

### Slot Calculation & Duration Representation
- [ ] Venues generate 30-minute time slots (00:00 to 24:00).
- [ ] Selecting 2.5 hrs starting at 1:00 PM books strictly 1:00 PM to 3:30 PM.
- [ ] Slot at 3:30 PM – 4:00 PM remains Available and selectable after a 1:00 PM – 3:30 PM booking.
- [ ] Unit tests for 30-minute slot ranges and duration selection pass 100%.

### My Court Bookings UI & Directions
- [ ] Booking cards show Venue Name, "Box N" / "Court N", address, and booking time with duration.
- [ ] Tapping "Get Directions" opens Google Maps / Native Maps to the venue coordinates/address.
- [ ] TypeScript compilation (`npx tsc --noEmit`) passes with 0 errors.
- [ ] Release APK builds successfully without errors.

## 2026-09-09T06:53:13Z

Build an automated end-to-end test suite and verification harness for multi-team matching scenarios involving three or more teams simultaneously, validating discovery, concurrent open challenge applications, schedule conflict detection, and race-condition resolution.

Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Integrity mode: development

## Requirements

### R1. Multi-Team Matching Concurrency & Challenge Flow
Validate the complete lifecycle when 3+ teams interact within the same geographical radius and sport:
- **Scenario A (1 Host vs Multiple Applicants):** Team A posts an open challenge; Team B and Team C simultaneously attempt to accept/take the challenge. Exactly one team is confirmed (`status: 'accepted'`) and the competing applicant receives `CHALLENGE_ALREADY_TAKEN` or appropriate conflict without data corruption.
- **Scenario B (Multiple Concurrent Hosts & Cross-Matching):** Teams A, B, and C all post open challenges for the same time window. Ensure teams discover each other's open fixtures, and when Team B matches with Team A, Team B's existing open challenge is properly handled or schedule conflicts (`TEAM_SCHEDULE_CONFLICT` / `OPPONENT_SCHEDULE_CONFLICT`) prevent conflicting double-bookings.
- **Scenario C (Shared Player & Squad Integrity Across 3+ Teams):** Verify that if a player belongs to both Team A and Team C, Team A and Team C cannot be matched (`SHARED_PLAYER`), but Team A and Team B can match cleanly.

### R2. Deterministic In-Memory Simulation Harness
Implement or extend an in-memory harness (following the architectural pattern of `tests/e2e/harness/venueBookingHarness.ts` or standalone Node.js test runner) simulating:
- Team creation and roster membership.
- Open challenge creation (`post_open_challenge` / `create_challenge`).
- Discovery of nearby challenges (`list_nearby_open_challenges`).
- Application and acceptance (`apply_to_open_challenge`, `accept_open_challenge`, `answer_challenge`).
- Error and token mapping (`SHARED_PLAYER`, `CHALLENGE_ALREADY_TAKEN`, `TEAM_SCHEDULE_CONFLICT`, `OPPONENT_SCHEDULE_CONFLICT`, `FORMAT_MISMATCH`).

### R3. Automated Test Execution and Reporting
Provide executable test scripts runnable via `npm test` or Node test runner (`node:test`) that run clean, deterministic, and assert against all edge cases without network flakiness.

## Acceptance Criteria

### Concurrent Matchmaking Invariants
- [ ] In a 3-team race where Team B and Team C apply to Team A's open fixture concurrently, exactly 1 team wins, 1 team is cleanly rejected with `CHALLENGE_ALREADY_TAKEN`, and the match record contains exactly 2 participating teams.
- [ ] When Team A matches with Team B for a time slot, subsequent challenge attempts for either team during overlapping time windows fail with `TEAM_SCHEDULE_CONFLICT` or `OPPONENT_SCHEDULE_CONFLICT`.
- [ ] If Team A and Team C share a player in their roster/lineup, any match creation or challenge acceptance between them is rejected with `SHARED_PLAYER`.
- [ ] Format compatibility check is strictly enforced: an 8v8 team cannot accept a 6v6 challenge (`FORMAT_MISMATCH` / `OPPONENT_FORMAT_MISMATCH`).

### Test Suite Execution
- [ ] All tests execute deterministically with 100% pass rate using `npx ts-node` or `node:test` runner.
- [ ] Zero unhandled promise rejections or leaked database states across test runs.

