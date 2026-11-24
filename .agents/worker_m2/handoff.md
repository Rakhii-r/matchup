# Milestone 2 Handoff Report: TypeScript Types, Domain Schema & Booking Repository

## 1. Observation
The following files were updated or created within Milestone 2:

1. **`src/shared/types/database.types.ts`**:
   - `venues.Row` (lines 203-206): Added `operating_hours_start: string`, `operating_hours_end: string`, `slot_duration_minutes: number`, `courts_count: number`.
   - `venues.Insert` (lines 224-227): Added matching optional fields `operating_hours_start?: string`, `operating_hours_end?: string`, `slot_duration_minutes?: number`, `courts_count?: number`.
   - `venue_bookings` Table (lines 232-285): Added table definition with `Row`, `Insert`, `Update`, and foreign key `Relationships` to `venues`, `profiles`, and `matches`.
   - `nearby_venues.Returns` (lines 703-706): Added `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, and `courts_count`.
   - `Functions` (lines 1407-1441): Added typed RPC signatures for `get_venue_slots`, `book_venue_slot`, and `cancel_venue_booking`.

2. **`src/core/errors/AppError.ts`** (lines 66-73):
   - Added detection for PostgreSQL exclusion error `e.code === '23P01'`, `e.code === 'SLOT_ALREADY_TAKEN'`, `raw.includes('slot_already_taken')`, and `raw.includes('venue_bookings_no_double_booking')`.
   - Verbatim error mapping to `new AppError('conflict', 'Slot already taken', error)`.

3. **`src/features/venues/domain/venueBookingSchema.ts`**:
   - Defined and exported `VenueSlot` interface (with `courtNumber`, `courtLabel`, `startTime`, `endTime`, `timeHhmm`, `endTimeHhmm`, `isAvailable`, `bookingId`, `isMyBooking`).
   - Defined and exported `VenueBooking` interface and `BookingStatus` type.
   - Defined and exported `BookSlotInputSchema` Zod validation schema (enforcing UUID format, court number >= 1, ISO datetimes with offset support, optional matchId UUID, and notes <= 280 characters) and `BookSlotInput` type.
   - Defined and exported `CancelBookingInputSchema` Zod schema and `CancelBookingInput` type.

4. **`src/features/venues/domain/slotUtils.ts`**:
   - `formatCourtLabel(courtNumber: number, sportTypes?: string[]): string`: Returns `"Box N"` when `box_cricket` is present, otherwise `"Court N"`.
   - `formatSlotWindow(startTimeIso: string, endTimeIso: string, timezone?: string): string`: Formats 12-hour start and end windows (e.g. `"06:00 PM – 07:00 PM"`).
   - `formatDateIso(date: Date, timezone?: string): string`: Formats date to `"YYYY-MM-DD"`.
   - `getUpcomingDates(daysCount?: number): UpcomingDateItem[]`: Returns 14-day date items with `dateStr`, `dayLabel` (`"Today"` for day 0, otherwise short weekday), `dayNumber` (`"05"`), and `monthLabel`.
   - `groupSlotsByCourt(slots: VenueSlot[]): Record<number, VenueSlot[]>`: Groups flat slot arrays by court number.

5. **`src/features/venues/data/venueBookingRepository.ts`**:
   - `bookingErrorToAppError(error: unknown): AppError`: Comprehensive error mapper translating database exceptions into domain `AppError` instances with `"Slot already taken"` mapping for double-booking attempts.
   - `venueBookingRepository.getSlots(venueId, date, timezone)`: Executes `supabase.rpc('get_venue_slots')` and maps snake_case rows to `VenueSlot[]`.
   - `venueBookingRepository.bookSlot(input)`: Validates input with `BookSlotInputSchema`, executes `supabase.rpc('book_venue_slot')`, and catches double-booking conflicts via `bookingErrorToAppError`.
   - `venueBookingRepository.cancelBooking(bookingId)`: Validates ID and executes `supabase.rpc('cancel_venue_booking')`.
   - `venueBookingRepository.listMyBookings()`: Retrieves authenticated user bookings via `supabase.from('venue_bookings').select('*, venues(name, sport_types)')` ordered by `start_time desc`.
   - `venueBookingRepository.getBookingForMatch(matchId)`: Retrieves confirmed linked booking for a match.

6. **`src/features/venues/presentation/useVenueBookings.ts`**:
   - `useVenueSlots(venueId, date, timezone)`: TanStack Query hook with query key `['venue-slots', venueId, date]`.
   - `useBookSlot()`: Mutation hook invalidating `['venue-slots', variables.venueId]`, `['my-bookings']`, and match queries (`['matches', variables.matchId]`, `['matches']`) when `matchId` is supplied.
   - `useCancelBooking()`: Mutation hook invalidating `['venue-slots']`, `['my-bookings']`, and `['matches']`.
   - `useMyBookings()`: Query hook with query key `['my-bookings']`.
   - `useMatchBooking(matchId)`: Query hook with query key `['match-booking', matchId]`.

## 2. Logic Chain
1. **Type Safety & Data Contracts (R1, R2)**:
   - Migration `20260904120000_venue_slot_booking_and_concurrency.sql` added 4 operating columns to `venues`, created `venue_bookings` with GiST exclusion constraints, and defined stored procedures `get_venue_slots`, `book_venue_slot`, and `cancel_venue_booking`.
   - Adding these exact structures to `src/shared/types/database.types.ts` ensures Supabase client calls are type-checked at compile time, eliminating any runtime field or argument mismatches.
2. **Conflict Translation (R2)**:
   - When concurrent users book overlapping time slots, PostgreSQL's GiST exclusion constraint raises error `23P01` (`exclusion_violation`), which PL/pgSQL surfaces as `SLOT_ALREADY_TAKEN`.
   - Updating `AppError.ts` and `bookingErrorToAppError` guarantees that any exclusion violation or `SLOT_ALREADY_TAKEN` token resolves to `AppError('conflict', 'Slot already taken')`, matching Requirement R2 verbatim.
3. **Domain Validation & Utilities (R1, R3)**:
   - `BookSlotInputSchema` enforces that timestamps are valid ISO strings, court numbers are positive integers, and notes do not exceed 280 characters.
   - `slotUtils.ts` provides pure helper functions for court labelling, date generation, slot formatting, and court grouping, decoupling formatting logic from UI components.
4. **Targeted React Query Invalidation (R3, R4)**:
   - When a slot is booked, `['venue-slots', variables.venueId]` and `['my-bookings']` are invalidated, refreshing the grid to display the slot as Occupied.
   - When a booking is cancelled, `['venue-slots']` is invalidated, instantly reverting the slot to Available across all active views.
   - Linking a booking to a match invalidates `['matches', matchId]`, allowing match screens to immediately show the confirmed court and time slot.

## 3. Caveats
- No caveats. All 6 exclusively assigned files are implemented, validated against strict TypeScript compiler rules (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`), and ready for UI consumption in Milestones 3 and 4.

## 4. Conclusion
Milestone 2 is complete and verified. All types, domain schemas, error mappers, repository methods, and TanStack Query hooks are operational and fully aligned with the database migration and project requirements.

## 5. Verification Method
1. **Static Typecheck**:
   Run `npx tsc --noEmit` from repository root:
   - All 6 files (`database.types.ts`, `AppError.ts`, `venueBookingSchema.ts`, `slotUtils.ts`, `venueBookingRepository.ts`, `useVenueBookings.ts`) compile with 0 errors.
2. **File Inspection**:
   - `src/shared/types/database.types.ts`: Verify `venues` operating columns, `venue_bookings` table, and 3 RPC signatures.
   - `src/core/errors/AppError.ts`: Verify `23P01` and `SLOT_ALREADY_TAKEN` map to `AppError('conflict', 'Slot already taken')`.
   - `src/features/venues/data/venueBookingRepository.ts`: Verify Supabase RPC calls and error handling.
   - `src/features/venues/presentation/useVenueBookings.ts`: Verify query keys and mutation invalidations.

