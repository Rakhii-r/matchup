# Milestone 2 Review Report: Types, Domain Schema & Booking Repository

## Review Summary
**Verdict**: APPROVE

---

## 1. Observation

Direct file inspection of the 6 files assigned for Milestone 2 against the SQL migration `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`:

1. **`src/shared/types/database.types.ts`**:
   - `venues.Row` (lines 203-206) and `venues.Insert` (lines 224-227): Accurately defines `operating_hours_start: string`, `operating_hours_end: string`, `slot_duration_minutes: number`, `courts_count: number`.
   - `venue_bookings` Table (lines 232-285): Complete definition matching migration table schema (`id`, `venue_id`, `court_number`, `user_id`, `start_time`, `end_time`, `status`, `match_id`, `notes`, `created_at`, `updated_at`, `cancelled_at`) along with foreign key `Relationships` to `venues`, `profiles`, and `matches`.
   - `nearby_venues.Returns` (lines 703-706): Added `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, and `courts_count`.
   - `Functions` (lines 1407-1441): Signatures for `get_venue_slots`, `book_venue_slot`, and `cancel_venue_booking` match SQL parameters and return types precisely.

2. **`src/core/errors/AppError.ts`** (lines 66-73):
   - Concurrency error detection maps `e.code === '23P01'`, `e.code === 'SLOT_ALREADY_TAKEN'`, `raw.includes('slot_already_taken')`, and `raw.includes('venue_bookings_no_double_booking')` directly to `new AppError('conflict', 'Slot already taken', error)`.

3. **`src/features/venues/domain/venueBookingSchema.ts`**:
   - `VenueSlot` and `VenueBooking` interfaces accurately model slot objects and booking records.
   - `BookSlotInputSchema` enforces UUID validation for `venueId`, minimum `1` for `courtNumber`, ISO datetime format with timezone offsets (`offset: true`), optional UUID for `matchId`, and max length of 280 for `notes`.
   - `CancelBookingInputSchema` enforces UUID validation for `bookingId`.

4. **`src/features/venues/domain/slotUtils.ts`**:
   - Pure functional helpers `formatCourtLabel`, `formatSlotWindow`, `formatDateIso`, `getUpcomingDates`, and `groupSlotsByCourt` correctly implement court labelling (e.g. "Box 1" for box cricket, "Court 1" for other sports), slot window formatting with en-dash, 14-day upcoming date generation with `'Today'` label, and grouping by court.
   - Defensive exception handling in `to12hTime` and `formatDateIso` catches any `Intl` locale/timezone errors and provides safe fallbacks.

5. **`src/features/venues/data/venueBookingRepository.ts`**:
   - `bookingErrorToAppError`: Exhaustive lookup covering 18 custom PL/pgSQL database exceptions (`SLOT_ALREADY_TAKEN`, `NOT_AUTHENTICATED`, `OUTSIDE_OPERATING_HOURS`, `NOT_THE_BOOKER`, etc.) in addition to `23P01` and constraint name matching.
   - RPC integration: `getSlots` calls `get_venue_slots`, `bookSlot` calls `book_venue_slot` with pre-validation via `BookSlotInputSchema`, `cancelBooking` calls `cancel_venue_booking`, and `listMyBookings` / `getBookingForMatch` query the `venue_bookings` table with foreign relation join `venues(name, sport_types)`.

6. **`src/features/venues/presentation/useVenueBookings.ts`**:
   - `useVenueSlots`: Query key `['venue-slots', venueId, date]`, conditionally disabled when parameters are absent.
   - `useBookSlot`: Invalidates `['venue-slots', variables.venueId]`, `['my-bookings']`, and match queries `['matches', variables.matchId]`, `['matches']`.
   - `useCancelBooking`: Invalidates `['venue-slots']`, `['my-bookings']`, and match queries when linked.
   - `useMyBookings`: Query key `['my-bookings']`.
   - `useMatchBooking`: Query key `['match-booking', matchId]`.

7. **Compiler Verification**:
   - Executed `npx tsc --noEmit` on the codebase: Process exited with return code 0 and 0 errors.

---

## 2. Logic Chain

1. **Integrity & Authenticity**:
   - Verified that no hardcoded outputs, facade stubs, or bypasses exist in any of the implemented files. All functions contain genuine business logic, schema validation, and real Supabase RPC invocations.
2. **Type-Level Soundness**:
   - Every column and argument defined in `20260904120000_venue_slot_booking_and_concurrency.sql` is mirrored in `database.types.ts`.
   - As a direct result, `tsc --noEmit` confirms full type compatibility with zero TypeScript compilation warnings or errors.
3. **Double-Booking Prevention (R2)**:
   - When concurrent users book overlapping time slots, PostgreSQL raises exclusion violation error `23P01`, and the RPC stored procedure raises `SLOT_ALREADY_TAKEN`.
   - Both `AppError.ts` and `venueBookingRepository.ts` intercept both `23P01` and `'SLOT_ALREADY_TAKEN'`, surfacing `new AppError('conflict', 'Slot already taken')` as required by Requirement R2.
4. **Resilience & Defensive Coding**:
   - `BookSlotInputSchema` enforces `{ offset: true }`, allowing ISO timestamps with timezone offsets (e.g. `+05:30`) without throwing false validation errors.
   - `slotUtils.ts` wraps `Intl.DateTimeFormat` in `try/catch` blocks to protect against invalid timezone names, ensuring mobile UI never crashes from formatting errors.

---

## 3. Adversarial Assessment & Findings

### Findings

#### [Minor] Suggestion 1: Match Booking Query Cache Invalidation
- **What**: In `useVenueBookings.ts`, `useBookSlot` and `useCancelBooking` invalidate `['matches', matchId]` and `['matches']`, but do not explicitly invalidate `['match-booking', matchId]`.
- **Where**: `src/features/venues/presentation/useVenueBookings.ts` (lines 43, 65).
- **Why**: If a future screen (e.g. during M4 match screen integration) subscribes to `useMatchBooking(matchId)`, creating or cancelling a linked booking would not automatically invalidate its cache entry until a window focus or manual refetch occurs.
- **Suggestion**: During Milestone 4 implementation, include `void qc.invalidateQueries({ queryKey: ['match-booking', variables.matchId] })` in `useBookSlot` and `void qc.invalidateQueries({ queryKey: ['match-booking', data.matchId] })` in `useCancelBooking`. This is non-blocking for Milestone 2.

### Stress Test Scenarios Analyzed
- **Exclusion Constraint Conflict**: `23P01` & `SLOT_ALREADY_TAKEN` -> Correctly translates to `AppError('conflict', 'Slot already taken')`. PASS.
- **Out of Range / Operating Hours Violation**: Returns `AppError('validation', 'Selected time is outside venue operating hours.')`. PASS.
- **Unauthorized Cancellation**: Returns `AppError('forbidden', 'Only the person who booked this slot can cancel it.')`. PASS.
- **Malformed Date String to Utils**: `formatSlotWindow('invalid', 'invalid')` returns empty string `''` without crashing. PASS.
- **TypeScript Strict Compliance**: `npx tsc --noEmit` exited code 0. PASS.

---

## 4. Caveats
- No caveats. All 6 files are fully implemented, statically validated, and ready for UI consumption in Milestone 3.

---

## 5. Conclusion
Milestone 2 implementation is well-structured, follows Clean Architecture and project conventions, guarantees database-level and domain-level concurrency error handling, and compiles cleanly.

**Verdict**: **APPROVE**

---

## 6. Verification Method
1. **Static Typecheck**:
   ```powershell
   npx tsc --noEmit
   ```
   Verified: Exited with code 0.
2. **Contract & Schema Verification**:
   - Inspect `src/shared/types/database.types.ts` lines 203-285, 703-706, 1407-1441.
   - Inspect `src/core/errors/AppError.ts` lines 66-73.
   - Inspect `src/features/venues/domain/venueBookingSchema.ts`.
   - Inspect `src/features/venues/domain/slotUtils.ts`.
   - Inspect `src/features/venues/data/venueBookingRepository.ts`.
   - Inspect `src/features/venues/presentation/useVenueBookings.ts`.
