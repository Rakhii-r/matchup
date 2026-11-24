# Dispatch: Milestone 4 — Screen Integration, Match Linking & Booking Management

## Mission
Integrate court and slot booking into the user-facing screens: Venues tab, Ground Selection screen for matches, Match detail screen, My Bookings management modal, and Admin venue configuration.

## Inputs & Context
- Original Request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Master Scope: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md`
- Presentation Components: `src/features/venues/presentation/CourtSlotPickerSheet.tsx`, `BookingModal.tsx`, `DateStrip.tsx`, `CourtPicker.tsx`, `TimeSlotGrid.tsx`
- Hooks: `useVenueBookings.ts` (`useMyBookings`, `useCancelBooking`, `useVenueSlots`, `useBookSlot`, `useMatchBooking`)
- Design Tokens: `src/shared/theme/index.ts`, `src/shared/theme/mockTheme.ts`
- Working Directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4`

## Exclusively Owned Files
- `src/features/venues/presentation/MyBookingsModal.tsx`
- `app/(tabs)/venues.tsx`
- `app/match/[id]/venue.tsx`
- `app/match/[id]/index.tsx`
- `app/admin/venues.tsx`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements to Implement

1. **`src/features/venues/presentation/MyBookingsModal.tsx`**:
   - Modal displaying the user's bookings fetched via `useMyBookings()`.
   - Header with title "My Ground Bookings", close button, and tab filter ("Upcoming" vs "Past / Cancelled").
   - Booking Card elements:
     - Venue name & address
     - Sport icon or badge
     - Court / Box label (e.g. "Court 1", "Box 2")
     - Formatted Date & Time Slot window (`formatSlotWindow`)
     - Status badge: Confirmed (`M.green` / active), Cancelled (`M.muted`)
     - Linked match indicator if `match_id` is present (with navigation to `/match/[match_id]`)
     - "Cancel Booking" action:
       - Confirms via Alert or prompt
       - Invokes `useCancelBooking().mutate(booking.id)`
       - Immediately updates list, frees court slot, and shows success toast/feedback
   - Clean empty state with "No upcoming bookings" and CTA to browse venues.

2. **`app/(tabs)/venues.tsx`**:
   - Header action: Add "My Bookings" button (e.g. pill or button with calendar/ticket icon and active bookings badge count).
   - Venue Card: Add primary "Book Court" / "Book Slot" button (`M.green` styling) alongside existing "Call to confirm" and directions buttons.
   - Pressing "Book Slot" opens `CourtSlotPickerSheet` for that selected venue.
   - Successful booking shows confirmation toast and offers to view in "My Bookings".

3. **`app/match/[id]/venue.tsx` (Ground Selection for Matches)**:
   - When opened by match creator, selecting a venue opens the court & slot selector sheet.
   - Pre-populates the date with the match's scheduled date if set.
   - Passes `match_id` into the booking flow so `book_venue_slot` atomically links the booking to the match, sets `matches.venue_id`, `matches.venue_text`, `matches.scheduled_at = start_time`, and `matches.end_time = end_time`.
   - On successful booking, closes sheet and navigates back to `/match/[id]` with immediate cache invalidation.

4. **`app/match/[id]/index.tsx` (Match Detail Screen)**:
   - In "📍 Venue & Ground" card:
     - Check if match has an active linked booking using `useMatchBooking(match.id)` or existing fields.
     - If confirmed booking exists:
       - Display confirmed Venue name and address.
       - Display confirmed Court / Box name (e.g. "Court 2" or "Box 1") and confirmed time slot (e.g. "07:00 PM – 08:00 PM").
       - Status badge: "Slot Confirmed" (Green).
       - If user is match creator, provide "Change Slot" or "Cancel Ground Booking" button.
     - If no booking exists: keep "Select ground" button that opens `/match/[id]/venue`.

5. **`app/admin/venues.tsx`**:
   - Extend the venue creation/editing form to support:
     - `operating_hours_start` (default "06:00")
     - `operating_hours_end` (default "23:00")
     - `slot_duration_minutes` (e.g. 60)
     - `courts_count` (e.g. 2)
   - Persist these values in Supabase venue inserts/updates.

6. **Quality & Verification**:
   - Strict TypeScript safety under `noUncheckedIndexedAccess`.
   - Run `npx tsc --noEmit` to confirm 0 errors.
   - Run `npx tsx tests/e2e/run_e2e_tests.ts` to confirm all tests pass.
- Deliver `handoff.md` and report via `send_message`.

## 2026-09-04T12:45:08Z
You are worker_m4 (Screen Integration & User Flow Specialist).
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4\DISPATCH.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\CourtSlotPickerSheet.tsx
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\useVenueBookings.ts

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement:
1. src/features/venues/presentation/MyBookingsModal.tsx (user booking view and instant cancellation to release slots)
2. app/(tabs)/venues.tsx ("Book Slot" CTA on venue cards + "My Bookings" header action)
3. app/match/[id]/venue.tsx (ground selection with court and slot booking linked to match)
4. app/match/[id]/index.tsx (display confirmed booked court & slot time, cancel option)
5. app/admin/venues.tsx (operating hours start/end, slot duration, courts count)

Verify npx tsc --noEmit passes with 0 errors and all E2E tests pass. Deliver handoff.md and send_message when done.

## 2026-09-04T14:46:09Z
You are worker_m4 (Screen Integration & User Flow Specialist).
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4\DISPATCH.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\CourtSlotPickerSheet.tsx
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\useVenueBookings.ts

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement Milestone 4:
1. src/features/venues/presentation/MyBookingsModal.tsx (user booking view and instant cancellation to release slots)
2. app/(tabs)/venues.tsx ("Book Slot" CTA on venue cards + "My Bookings" header action)
3. app/match/[id]/venue.tsx (ground selection with court and slot booking linked to match)
4. app/match/[id]/index.tsx (display confirmed booked court & slot time, cancel option)
5. app/admin/venues.tsx (operating hours start/end, slot duration, courts count)

Verify npx tsc --noEmit passes with 0 errors and all E2E tests pass. Deliver handoff.md and send_message when done.

