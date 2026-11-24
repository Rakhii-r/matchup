# Dispatch: Milestone 3 — UI Selection Components & Booking Modal

## Mission
Implement the interactive frontend components for venue date selection, court/box picking, dynamic time slot grid with Available vs Occupied states, and the booking confirmation modal with double-booking conflict handling ("Slot already taken").

## Inputs & Context
- Original Request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Master Scope: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md`
- Frontend Survey Report: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend\survey_frontend_report.md`
- Domain schemas & utilities: `src/features/venues/domain/venueBookingSchema.ts`, `src/features/venues/domain/slotUtils.ts`
- Query Hooks: `src/features/venues/presentation/useVenueBookings.ts`
- Design Tokens: `src/shared/theme/index.ts`, `src/shared/theme/mockTheme.ts`
- Icons: `src/shared/ui/icons.tsx`
- Buttons & Modals: `src/shared/ui/Button.tsx`, `src/shared/ui/Modal.tsx`
- Working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m3`

## Exclusively Owned Files
- `src/features/venues/presentation/DateStrip.tsx`
- `src/features/venues/presentation/CourtPicker.tsx`
- `src/features/venues/presentation/TimeSlotGrid.tsx`
- `src/features/venues/presentation/BookingModal.tsx`
- `src/features/venues/presentation/CourtSlotPickerSheet.tsx`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements to Implement
1. **`DateStrip.tsx`**:
   - Horizontal scrolling date selector displaying today + next 14 days.
   - Each chip displays short weekday ("Today", "Sat", "Sun"), day number ("05"), and month abbreviation.
   - Active state styled with `M.green` background, dark text.
   - Inactive state styled with `M.card` background, `M.muted` text, `M.border` border.
   - Accessibility: `accessibilityRole="button"`, `accessibilityState={{ selected }}`.

2. **`CourtPicker.tsx`**:
   - Segmented chip row allowing users to toggle between Court 1, Court 2, Box 1, Box 2, etc.
   - Court labels computed via `formatCourtLabel(courtNumber, venue.sport_types)` ("Box N" for box_cricket, otherwise "Court N").
   - If venue has only 1 court (`courts_count === 1`), renders an informational pill or single selected state.
   - Highlights the active court with clear contrast.

3. **`TimeSlotGrid.tsx`**:
   - Renders the computed slots for the selected venue, date, and court.
   - Supports 2-column or 3-column responsive layout.
   - Visual status differentiation:
     - **Available (Selectable)**: `M.card` background, `M.border` border. When selected, border is `M.green` and background is active. Displays time window (e.g. "06:00 PM – 07:00 PM" via `formatSlotWindow`).
     - **Booked / Occupied (Disabled)**: Dimmed background (opacity 0.45 or `M.card`), muted border, badge label "Occupied" / "Booked". Fully non-interactive (`disabled={true}`).
     - **Past (Disabled)**: Disabled styling for elapsed slots today.
   - Shows loading skeleton while slots are fetching.
   - Shows empty message if no slots exist for that day.

4. **`BookingModal.tsx`**:
   - Slide-up bottom sheet or modal confirming booking details:
     - Venue name & address
     - Selected Date formatted cleanly
     - Selected Court / Box
     - Selected Time Slot window
     - Price indicator (e.g. calculated from `price_per_hour` or `price_per_slot` · "Pay at venue")
     - Optional match linking picker if `matches` provided (e.g. dropdown/radio to link ground to an existing open match)
   - "Confirm Booking" CTA button with loading spinner state.
   - **Double-Booking & Conflict Handling (R2)**:
     - If the mutation throws an error containing "Slot already taken" / conflict:
       - Displays prominent error banner / toast: "Slot already taken. Another player just booked this court and slot. Please pick another slot."
       - Automatically triggers query refetch so the occupied slot flips to disabled.

5. **`CourtSlotPickerSheet.tsx`**:
   - Self-contained modal or sheet component combining `DateStrip`, `CourtPicker`, and `TimeSlotGrid`, plus action button "Book Selected Slot" that launches `BookingModal`.
   - Reusable across both Venues tab (`app/(tabs)/venues.tsx`) and Ground Selection (`app/match/[id]/venue.tsx`).

6. **Type Safety & Testing**:
   - Strict TypeScript: no any, full compatibility with `npx tsc --noEmit`.
   - Deliver handoff report and notify via `send_message`.

## 2026-09-04T12:15:33Z

You are worker_m3 (Frontend UI & React Native Specialist).
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m3
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m3\DISPATCH.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\domain\venueBookingSchema.ts
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\domain\slotUtils.ts
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\useVenueBookings.ts

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement:
1. src/features/venues/presentation/DateStrip.tsx (14-day horizontal selector)
2. src/features/venues/presentation/CourtPicker.tsx (court/box segmented selector)
3. src/features/venues/presentation/TimeSlotGrid.tsx (Available vs Occupied slot grid)
4. src/features/venues/presentation/BookingModal.tsx (confirmation sheet & conflict handling displaying 'Slot already taken')
5. src/features/venues/presentation/CourtSlotPickerSheet.tsx (compound sheet integrating the pickers)

Verify npx tsc --noEmit passes with 0 errors. Deliver handoff.md and send_message when done.
