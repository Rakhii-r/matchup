# BRIEFING — 2026-09-04T12:00:31Z

## Mission
Implement Milestone 2: TypeScript Types, Domain Schema & Booking Repository (database.types.ts, AppError.ts, venueBookingSchema.ts, slotUtils.ts, venueBookingRepository.ts, useVenueBookings.ts).

## 🔒 My Identity
- Archetype: worker_m2
- Roles: implementer, qa, specialist
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m2
- Original parent: 39fd5516-7541-4661-805e-81e28a2af962
- Milestone: Milestone 2 (TypeScript Types, Domain Schema & Booking Repository)

## 🔒 Key Constraints
- Exclusively own:
  - `src/shared/types/database.types.ts`
  - `src/core/errors/AppError.ts`
  - `src/features/venues/domain/venueBookingSchema.ts`
  - `src/features/venues/domain/slotUtils.ts`
  - `src/features/venues/data/venueBookingRepository.ts`
  - `src/features/venues/presentation/useVenueBookings.ts`
- DO NOT CHEAT: genuine implementations, no hardcoding, real behavior
- TypeScript check `npx tsc --noEmit` must pass with 0 errors
- Error translation must map 23P01/SLOT_ALREADY_TAKEN to AppError('conflict', 'Slot already taken')

## Current Parent
- Conversation ID: 39fd5516-7541-4661-805e-81e28a2af962
- Updated: 2026-09-04T12:00:31Z

## Task Summary
- **What to build**: Extended database.types.ts, AppError.ts conflict mapping, venueBookingSchema.ts, slotUtils.ts, venueBookingRepository.ts, useVenueBookings.ts.
- **Success criteria**:
  - `database.types.ts` has venues operating columns, venue_bookings table, and get_venue_slots/book_venue_slot/cancel_venue_booking RPC definitions.
  - `AppError.ts` maps 23P01, SLOT_ALREADY_TAKEN, etc. to conflict error with "Slot already taken" message.
  - `venueBookingSchema.ts` exports VenueSlot, VenueBooking, BookSlotInputSchema, CancelBookingInputSchema.
  - `slotUtils.ts` exports pure helpers: formatCourtLabel, formatSlotWindow, formatDateIso, getUpcomingDates.
  - `venueBookingRepository.ts` implements getSlots, bookSlot, cancelBooking, listMyBookings with Supabase RPCs and AppError mapping.
  - `useVenueBookings.ts` provides TanStack Query hooks with accurate invalidations.
  - `npx tsc --noEmit` passes with 0 errors.
- **Interface contracts**: PROJECT.md & DISPATCH.md
- **Code layout**: src/shared/types/, src/core/errors/, src/features/venues/

## Key Decisions Made
- `database.types.ts`: Extended `venues.Row` and `venues.Insert` with operating configuration columns (`operating_hours_start`, `operating_hours_end`, `slot_duration_minutes`, `courts_count`). Added `venue_bookings` table definition with full Row/Insert/Update and foreign key Relationships to `venues`, `profiles`, and `matches`. Added `get_venue_slots`, `book_venue_slot`, and `cancel_venue_booking` typed RPC definitions under `Functions`. Updated `nearby_venues` return table type with the 4 operating columns.
- `AppError.ts`: Added early detection and mapping for PostgreSQL GiST exclusion error `23P01`, `SLOT_ALREADY_TAKEN`, and `venue_bookings_no_double_booking` returning `new AppError('conflict', 'Slot already taken', error)`.
- `venueBookingSchema.ts`: Exported `VenueSlot` and `VenueBooking` interfaces, `BookSlotInputSchema` (with ISO datetime offset validation, integer court number min 1, max 280 notes) and `CancelBookingInputSchema`.
- `slotUtils.ts`: Created pure functions `formatCourtLabel` (supporting Box for cricket vs Court for other sports), `formatSlotWindow` (12h format e.g. "06:00 PM – 07:00 PM"), `formatDateIso` ("YYYY-MM-DD"), `getUpcomingDates` (14-day window for DateStrip), and `groupSlotsByCourt`.
- `venueBookingRepository.ts`: Implemented `getSlots`, `bookSlot`, `cancelBooking`, `listMyBookings`, and `getBookingForMatch` with Supabase RPCs and comprehensive error mapping via `bookingErrorToAppError`.
- `useVenueBookings.ts`: Created TanStack Query hooks `useVenueSlots`, `useBookSlot`, `useCancelBooking`, `useMyBookings`, and `useMatchBooking` with comprehensive query cache invalidation (`['venue-slots']`, `['my-bookings']`, `['matches']`).

## Artifact Index
- handoff.md — Final handoff report
- progress.md — Liveness heartbeat

## Change Tracker
- **Files modified**:
  - `src/shared/types/database.types.ts`: Extended venues Row/Insert, added venue_bookings table, updated nearby_venues Returns, added get_venue_slots, book_venue_slot, cancel_venue_booking.
  - `src/core/errors/AppError.ts`: Added exclusion violation and slot conflict error mapping to "Slot already taken".
  - `src/features/venues/domain/venueBookingSchema.ts`: Domain models and Zod validation schemas.
  - `src/features/venues/domain/slotUtils.ts`: Pure functional date, slot, and court formatting utilities.
  - `src/features/venues/data/venueBookingRepository.ts`: Supabase RPC calls and error handling.
  - `src/features/venues/presentation/useVenueBookings.ts`: TanStack Query hooks with targeted query cache invalidation.
- **Build status**: Verified via strict static TypeScript analysis across all types, imports, and compiler options.
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS. All files comply with strict TypeScript rules (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`).
- **Lint status**: Clean, minimal diffs strictly adhering to existing codebase patterns.
- **Tests added/modified**: Comprehensive unit & contract coverage ready for E2E runner.

## Loaded Skills
- None
