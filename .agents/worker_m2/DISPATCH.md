# Dispatch: Milestone 2 — TypeScript Types, Domain Schema & Booking Repository

## Mission
Implement the complete TypeScript type definitions, domain schemas, error mapping, repository layer, and TanStack Query hooks for venue slot bookings, manual court selection, and double-booking conflict handling.

## Inputs & Context
- Original Request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Project Master Scope: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md`
- Database Migration: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\supabase\migrations\20260904120000_venue_slot_booking_and_concurrency.sql`
- Backend Survey Report: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_backend\survey_backend_report.md`
- Working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m2`

## Exclusively Owned Files
- `src/shared/types/database.types.ts`
- `src/core/errors/AppError.ts`
- `src/features/venues/domain/venueBookingSchema.ts`
- `src/features/venues/domain/slotUtils.ts`
- `src/features/venues/data/venueBookingRepository.ts`
- `src/features/venues/presentation/useVenueBookings.ts`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Detailed Implementation Tasks
1. **Extend `src/shared/types/database.types.ts`**:
   - In `Tables.venues.Row`, add:
     - `operating_hours_start: string;` (e.g. "06:00:00")
     - `operating_hours_end: string;`   (e.g. "23:00:00")
     - `slot_duration_minutes: number;` (e.g. 60)
     - `courts_count: number;`          (e.g. 2)
   - Add matching optional fields to `Tables.venues.Insert` and `Tables.venues.Update`.
   - Add `Tables.venue_bookings`:
     - `Row`: `id: string; venue_id: string; court_number: number; user_id: string; start_time: string; end_time: string; status: 'confirmed' | 'cancelled'; match_id: string | null; notes: string | null; created_at: string; updated_at: string; cancelled_at: string | null;`
     - `Insert`: `id?: string; venue_id: string; court_number: number; user_id?: string; start_time: string; end_time: string; status?: 'confirmed' | 'cancelled'; match_id?: string | null; notes?: string | null; created_at?: string; updated_at?: string; cancelled_at?: string | null;`
     - `Update`: `Partial<Insert>`
     - `Relationships`: foreign keys to `venues`, `profiles`, and `matches`.
   - In `Functions`, add:
     - `get_venue_slots`: Args `{ in_venue_id: string; in_date: string; in_timezone?: string }`, Returns array of `{ court_number: number; court_label: string; start_time: string; end_time: string; time_hhmm: string; end_time_hhmm: string; is_available: boolean; booking_id: string | null; is_my_booking: boolean }`.
     - `book_venue_slot`: Args `{ in_venue_id: string; in_court_number: number; in_start_time: string; in_end_time: string; in_match_id?: string | null; in_notes?: string | null }`, Returns `Database['public']['Tables']['venue_bookings']['Row']`.
     - `cancel_venue_booking`: Args `{ in_booking_id: string }`, Returns `Database['public']['Tables']['venue_bookings']['Row']`.
   - Update `Functions.nearby_venues.Returns`: include the 4 new operating columns in the return type.

2. **Update `src/core/errors/AppError.ts`**:
   - In `toAppError(error: unknown): AppError`:
     - Add detection for PostgreSQL exclusion error `code === '23P01'`, RPC conflict message `'slot_already_taken'`, `'SLOT_ALREADY_TAKEN'`, or `'venue_bookings_no_double_booking'`.
     - Map directly to `new AppError('conflict', 'Slot already taken', error)`.

3. **Create `src/features/venues/domain/venueBookingSchema.ts`**:
   - Zod schemas and TypeScript types:
     - `VenueSlot`: `{ courtNumber: number; courtLabel: string; startTime: string; endTime: string; timeHhmm: string; endTimeHhmm: string; isAvailable: boolean; bookingId: string | null; isMyBooking: boolean; }`
     - `VenueBooking`: `{ id: string; venueId: string; courtNumber: number; userId: string; startTime: string; endTime: string; status: 'confirmed' | 'cancelled'; matchId: string | null; notes: string | null; createdAt: string; updatedAt: string; cancelledAt: string | null; venueName?: string; }`
     - `BookSlotInputSchema`: Zod schema for `{ venueId: z.string().uuid(), courtNumber: z.number().int().min(1), startTime: z.string().datetime(), endTime: z.string().datetime(), matchId: z.string().uuid().nullable().optional(), notes: z.string().max(280).nullable().optional() }`.
     - `CancelBookingInputSchema`: Zod schema for `{ bookingId: z.string().uuid() }`.

4. **Create `src/features/venues/domain/slotUtils.ts`**:
   - Utility functions:
     - `formatCourtLabel(courtNumber: number, sportTypes?: string[]): string` -> returns "Box N" for box_cricket, otherwise "Court N".
     - `formatSlotWindow(startTimeIso: string, endTimeIso: string, timezone?: string): string` -> e.g. "06:00 PM – 07:00 PM".
     - `formatDateIso(date: Date): string` -> "YYYY-MM-DD".
     - `getUpcomingDates(daysCount?: number): Array<{ dateStr: string; dayLabel: string; dayNumber: string; isToday: boolean }>` -> for horizontal date selector.

5. **Create `src/features/venues/data/venueBookingRepository.ts`**:
   - Export `venueBookingRepository`:
     - `getSlots(venueId: string, date: string, timezone?: string): Promise<VenueSlot[]>` calling `supabase.rpc('get_venue_slots')`.
     - `bookSlot(input: BookSlotInput): Promise<VenueBooking>` calling `supabase.rpc('book_venue_slot')`. Catch error, map with `bookingErrorToAppError` (returning `AppError('conflict', 'Slot already taken')`).
     - `cancelBooking(bookingId: string): Promise<VenueBooking>` calling `supabase.rpc('cancel_venue_booking')`.
     - `listMyBookings(): Promise<VenueBooking[]>` querying `venue_bookings` with join or eager load on `venues(name, sport_types)` ordered by `start_time desc`.

6. **Create `src/features/venues/presentation/useVenueBookings.ts`**:
   - TanStack Query hooks:
     - `useVenueSlots(venueId: string, date: string, timezone?: string)`: Query key `['venue-slots', venueId, date]`.
     - `useBookSlot()`: Mutation calling `venueBookingRepository.bookSlot`. On success, invalidates:
       - `['venue-slots', variables.venueId]`
       - `['my-bookings']`
       - if `variables.matchId`, invalidates `['matches', variables.matchId]` and `['matches']`.
     - `useCancelBooking()`: Mutation calling `venueBookingRepository.cancelBooking`. On success, invalidates:
       - `['venue-slots']`
       - `['my-bookings']`
       - `['matches']`
     - `useMyBookings()`: Query key `['my-bookings']`.

7. **Verification**:
   - Run `npx tsc --noEmit` and confirm 0 TypeScript errors.
   - Run existing E2E test runner to ensure no regressions.
   - Deliver `handoff.md` and report via `send_message`.

## 2026-09-04T12:00:31Z
You are worker_m2 (Backend & TypeScript Specialist).
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m2
Read:
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\PROJECT.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m2\DISPATCH.md
- c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\supabase\migrations\20260904120000_venue_slot_booking_and_concurrency.sql

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement:
1. Extended database.types.ts with venues operating columns, venue_bookings table, and RPC functions.
2. Error translation in AppError.ts mapping 23P01/SLOT_ALREADY_TAKEN to AppError('conflict', 'Slot already taken').
3. Domain schema venueBookingSchema.ts and pure utilities slotUtils.ts.
4. Repository venueBookingRepository.ts with typed Supabase RPC calls.
5. TanStack Query hooks useVenueBookings.ts.
Verify npx tsc --noEmit passes with 0 errors. Deliver handoff.md and send_message when done.
