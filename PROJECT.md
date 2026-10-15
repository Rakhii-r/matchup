# Project: Venue Time Slot Booking, Manual Court Selection & Concurrency Protection

## Architecture
MatchUp is an Expo/React Native mobile application connecting to a Supabase PostgreSQL backend.
- **Backend / Database**: PostgreSQL with `btree_gist`, PostGIS, Row Level Security, and `SECURITY DEFINER` PL/pgSQL stored procedures. Concurrency protection uses a partial GiST exclusion constraint (`tstzrange`) on `public.venue_bookings`, rejecting overlapping bookings with error code `23P01`.
- **Service / Data Layer**: Clean Architecture under `src/features/venues/` (`data/`, `domain/`, `presentation/`). TanStack React Query for query caching and invalidation. Error translation maps `23P01` and `SLOT_ALREADY_TAKEN` to `AppError('conflict', 'Slot already taken')`.
- **Presentation / UI Layer**: React Native with Expo Router. Interactive components (`DateStrip`, `CourtPicker`, `TimeSlotGrid`, `BookingModal`, `MyBookingsModal`) styled with MatchUp's design system tokens (`@shared/theme`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| F1 | Venue Operating Settings Schema | Operating hours (`operating_hours_start`, `operating_hours_end`), slot duration (`slot_duration_minutes`), and courts count (`courts_count`) columns in `public.venues` | M1 | survey_db, survey_backend |
| F2 | Venue Bookings Table & Storage | `public.venue_bookings` table storing `venue_id`, `court_number`, `user_id`, `start_time`, `end_time`, `status`, `match_id`, `notes` | M1 | survey_db, survey_backend |
| F3 | Database Exclusion Constraint (Double-Booking Prevention) | Partial GiST exclusion constraint on `(venue_id, court_number, tstzrange(start_time, end_time, '[)')) where (status = 'confirmed')` preventing overlapping bookings | M1 | survey_db, survey_backend |
| F4 | Atomic Slot Booking RPC (`book_venue_slot`) | PL/pgSQL RPC catching exclusion violation (`23P01`), returning `SLOT_ALREADY_TAKEN`, and atomically updating linked match | M1 | survey_db, survey_backend |
| F5 | Booking Cancellation RPC (`cancel_venue_booking`) | PL/pgSQL RPC updating `status = 'cancelled'`, instantly releasing slot from exclusion index and unlinking match | M1 | survey_db, survey_backend |
| F6 | Dynamic Slot Calculation RPC (`get_venue_slots`) | PL/pgSQL RPC generating candidate slot grid from venue operating hours across courts, left-joining active bookings to return status (`available`, `booked`, `past`) | M1 | survey_db, survey_backend |
| F7 | Database Types & Error Mapping | Extend `database.types.ts` with venues, venue_bookings, RPCs; update `AppError.ts` to map `23P01` / `SLOT_ALREADY_TAKEN` to conflict error with "Slot already taken" message | M2 | survey_db, survey_backend |
| F8 | Venue Booking Domain & Repository | `venueBookingSchema.ts`, `slotUtils.ts`, and `venueBookingRepository.ts` executing Supabase queries & RPCs with type safety | M2 | survey_backend |
| F9 | Booking Hooks & State Management | `useVenueBookings.ts` TanStack Query hooks (`useVenueSlots`, `useBookSlot`, `useCancelBooking`, `useMyBookings`) with automatic cache invalidation | M2 | survey_backend |
| F10 | Interactive Date Selector (`DateStrip`) | Horizontal date selector chip row displaying current and future dates (14-day window) | M3 | survey_frontend |
| F11 | Court / Box Picker (`CourtPicker`) | Segmented chips allowing users to toggle between Court 1, Court 2, Box 1, Box 2, etc. | M3 | survey_frontend |
| F12 | Dynamic Time Slot Grid (`TimeSlotGrid`) | Interactive grid displaying computed slots, differentiating Available (selectable) vs Booked / Occupied (disabled) | M3 | survey_frontend |
| F13 | Booking Confirmation & Conflict Modal (`BookingModal`) | Bottom sheet modal displaying slot summary, price, match linking option, CTA, and handling conflict error with "Slot already taken" toast and auto-refresh | M3 | survey_frontend |
| F14 | Venues Tab Integration | Add "Book Slot" entry point on venue cards in `app/(tabs)/venues.tsx`, opening the slot booking flow | M4 | survey_frontend |
| F15 | Ground Selection & Match Linking Flow | Update `app/match/[id]/venue.tsx` to let organisers pick court & slot and link booking to match | M4 | survey_frontend |
| F16 | Match Details Booking Card | Update `app/match/[id]/index.tsx` to display confirmed court number and time slot in Venue card | M4 | survey_frontend |
| F17 | User Booking Management & Cancellation (`MyBookingsModal`) | UI to view user's confirmed bookings and cancel them, immediately freeing slots | M4 | survey_frontend |
| F18 | Admin Venue Operating Config | Allow admins to edit operating hours, slot duration, and court count in `app/admin/venues.tsx` | M4 | survey_frontend |
| F19 | E2E Integration & Concurrency Test Suite | Comprehensive 4-tier test suite verifying exclusion constraint, dynamic calculation, cancellation release, and conflict messages | E2E Track | survey_all |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| E2E | E2E Testing Track | Design test runner, test harness, and 4-tier test suite covering F1–F19. Publish `TEST_READY.md`. | none | IN_PROGRESS |
| M1 | Database Schema, Exclusion Constraints & Booking RPCs | SQL migration for `venues` extensions, `venue_bookings` table, GiST exclusion constraint, `book_venue_slot`, `cancel_venue_booking`, `get_venue_slots` RPCs, and RLS policies | none | DONE |
| M2 | TypeScript Types, Domain Schema & Booking Repository | `database.types.ts`, `venueBookingSchema.ts`, `slotUtils.ts`, `venueBookingRepository.ts`, `AppError.ts` conflict mapping, and `useVenueBookings.ts` query hooks | M1 | DONE |
| M3 | UI Selection Components & Booking Modal | `DateStrip.tsx`, `CourtPicker.tsx`, `TimeSlotGrid.tsx`, `BookingModal.tsx` with Available vs Occupied styling and conflict handling | M2 | DONE |
| M4 | Screen Integration, Match Linking & Booking Management | Venues tab booking trigger, Match ground selection flow (`app/match/[id]/venue.tsx`), match detail display, `MyBookingsModal.tsx`, admin operating settings | M3 | IN_PROGRESS |
| M5 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Verify all Tier 1–4 tests pass, run Challenger adversarial tests (Tier 5), verify `npx tsc --noEmit` 0 errors | M4, E2E | PLANNED |

## Interface Contracts

### Database RPC Contracts
```sql
-- 1. get_venue_slots
function public.get_venue_slots(
  in_venue_id   uuid,
  in_date       date,
  in_timezone   text default 'Asia/Kolkata'
) returns table (
  court_number    integer,
  court_label     text,
  start_time      timestamptz,
  end_time        timestamptz,
  time_hhmm       text,
  end_time_hhmm   text,
  is_available    boolean,
  booking_id      uuid,
  is_my_booking   boolean
);

-- 2. book_venue_slot
function public.book_venue_slot(
  in_venue_id     uuid,
  in_court_number integer,
  in_start_time   timestamptz,
  in_end_time     timestamptz,
  in_match_id     uuid default null,
  in_notes        text default null
) returns public.venue_bookings;

-- 3. cancel_venue_booking
function public.cancel_venue_booking(
  in_booking_id   uuid
) returns public.venue_bookings;
```

### TypeScript Domain Contracts
```typescript
export interface VenueSlot {
  courtNumber: number;
  courtLabel: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  timeHhmm: string;  // e.g. "06:00"
  endTimeHhmm: string; // e.g. "07:00"
  isAvailable: boolean;
  bookingId: string | null;
  isMyBooking: boolean;
}

export interface VenueBooking {
  id: string;
  venueId: string;
  courtNumber: number;
  userId: string;
  startTime: string;
  endTime: string;
  status: 'confirmed' | 'cancelled';
  matchId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface BookSlotParams {
  venueId: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  matchId?: string | null;
  notes?: string | null;
}
```

## Code Layout
- `supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`: Complete SQL migration
- `src/shared/types/database.types.ts`: Extended Supabase database types
- `src/core/errors/AppError.ts`: SQLSTATE `23P01` and `SLOT_ALREADY_TAKEN` error mapping
- `src/features/venues/domain/venueBookingSchema.ts`: Zod schemas & types for bookings
- `src/features/venues/domain/slotUtils.ts`: Pure functional slot calculation and date utilities
- `src/features/venues/data/venueBookingRepository.ts`: Supabase RPC calls and error handling
- `src/features/venues/presentation/useVenueBookings.ts`: TanStack Query hooks
- `src/features/venues/presentation/DateStrip.tsx`: Horizontal date picker component
- `src/features/venues/presentation/CourtPicker.tsx`: Court / box chip selector
- `src/features/venues/presentation/TimeSlotGrid.tsx`: Dynamic slot availability grid
- `src/features/venues/presentation/BookingModal.tsx`: Booking confirmation bottom sheet
- `src/features/venues/presentation/MyBookingsModal.tsx`: User booking management and cancellation
- `app/(tabs)/venues.tsx`: Venues directory tab with booking flow
- `app/match/[id]/venue.tsx`: Ground selection screen with court and slot booking
- `app/match/[id]/index.tsx`: Match details screen displaying booked ground slot
- `app/admin/venues.tsx`: Admin venue configuration screen
- `tests/e2e/`: E2E test suite (test runner, test harness, Tiers 1–5 test files)
