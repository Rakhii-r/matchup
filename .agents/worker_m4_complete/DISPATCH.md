# Dispatch: Worker M4 Complete (Screen Integration & Booking Management)

## Mission
Complete all screen integration, match linking, and booking management flows across the 5 target files:
1. `src/features/venues/presentation/MyBookingsModal.tsx` (User booking management sheet & instant slot release)
2. `app/(tabs)/venues.tsx` (Venue cards "Book Court" action & "My Bookings" header button)
3. `app/match/[id]/venue.tsx` (Organiser ground selection linking court and slot to match)
4. `app/match/[id]/index.tsx` (Display confirmed court number and time slot in Venue card, with cancel action)
5. `app/admin/venues.tsx` (Admin form fields for operating_hours_start, operating_hours_end, slot_duration_minutes, courts_count)

## Inputs & Context
- Original Request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Master Scope: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md`
- UI Components: `src/features/venues/presentation/CourtSlotPickerSheet.tsx`, `BookingModal.tsx`, `TimeSlotGrid.tsx`, `CourtPicker.tsx`, `DateStrip.tsx`
- Hooks: `src/features/venues/presentation/useVenueBookings.ts` (`useMyBookings`, `useCancelBooking`, `useMatchBooking`, `useBookSlot`)
- Slot Utilities: `src/features/venues/domain/slotUtils.ts` (`formatCourtLabel`, `formatSlotWindow`, `formatDateIso`)
- Design Tokens: `src/shared/theme/index.ts`, `src/shared/theme/mockTheme.ts`
- Working Directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4_complete`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Requirements to Complete

1. **`src/features/venues/presentation/MyBookingsModal.tsx`**:
   - Ensure it is cleanly exported and handles viewing active/past bookings, cancelling bookings via `useCancelBooking()`, and navigating to linked matches.

2. **`app/(tabs)/venues.tsx`**:
   - Add "My Bookings" button in header (with icon and badge for active upcoming bookings count).
   - In venue card (`venues.map`), add primary "Book Court" / "Book Slot" button styled with `M.green`.
   - Pressing "Book Court" opens `CourtSlotPickerSheet` for that venue.
   - When booking succeeds, show feedback and offer to view in "My Bookings".

3. **`app/match/[id]/venue.tsx`**:
   - When organiser taps a venue, open `CourtSlotPickerSheet` pre-configured with `match_id = matchId` and date defaulting to match scheduled date.
   - When booked, `book_venue_slot` links the booking to the match and updates `matches.venue_id`, `matches.venue_text`, and start/end times.
   - Automatically navigate back to `/match/[id]`.

4. **`app/match/[id]/index.tsx`**:
   - In "📍 Venue & Ground" card (`lines 776-813`):
     - Use `useMatchBooking(matchId)` to detect linked confirmed booking.
     - If confirmed booking exists:
       - Display confirmed Venue name and address.
       - Display confirmed Court / Box label (e.g. "Court 2" or "Box 1") and confirmed time slot (e.g. "07:00 PM – 08:00 PM").
       - Show "Slot Confirmed" badge (Green).
       - For organiser: provide "Cancel Ground Booking" button (which calls `useCancelBooking` and detaches the venue) and "Change Ground" button.
     - If no booking exists: keep "Select ground" button that opens `/match/[id]/venue`.

5. **`app/admin/venues.tsx`**:
   - Add state & inputs for:
     - `operatingHoursStart` (default '06:00')
     - `operatingHoursEnd` (default '23:00')
     - `slotDurationMinutes` (default '60')
     - `courtsCount` (default '2')
   - In `createVenue` and `updateVenue` mutation payloads, pass these 4 fields.
   - Populate them when editing an existing venue (`startEdit`).

6. **Verification**:
   - Run `npx tsc --noEmit` and confirm 0 TypeScript errors under `noUncheckedIndexedAccess`.
   - Run `npx tsx tests/e2e/run_e2e_tests.ts` to confirm 100% test pass.
   - Deliver `handoff.md` and report via `send_message`.
