# Scope: 30-Minute Granular Time Slots & Rich My Court Bookings

## Architecture
MatchUp mobile app (Expo / React Native) with Supabase PostgreSQL backend.
- **Database / RPCs**: `public.venues` (default `slot_duration_minutes = 30`), `public.venue_bookings` with GiST exclusion constraint `tstzrange(start_time, end_time, '[)') with &&` for strict double-booking rejection.
- **Domain & Data Layer**: `slotUtils.ts`, `venueBookingSchema.ts`, `venueBookingRepository.ts` querying `lat`, `lng`, `sport_types`, `address`, `name` from `venues`.
- **UI Presentation**: `TimeSlotGrid.tsx`, `CourtSlotPickerSheet.tsx`, `BookingModal.tsx` for 30-min slots and exact multi-hour duration spanning (`1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`).
- **Profile & Bookings Presentation**: `app/profile/bookings.tsx` and `src/features/venues/presentation/MyBookingsModal.tsx` enriched with Venue Name, Box/Court badge, address with location pin, date/time with duration, and interactive "Get Directions" button.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| F1 | 30-Minute Schema & Migration | Update `slot_duration_minutes` default to 30 in `public.venues` and backfill existing rows | M1 | explorer_db_r2 |
| F2 | 30-Min Dynamic Slot RPC (`get_venue_slots`) | Update step fallback to 30 mins and dynamic "Box N" vs "Court N" label based on sport_types | M1 | explorer_db_r2 |
| F3 | Atomic Slot Booking RPC (`book_venue_slot`) | Validate 30-min start alignment and end duration multiple of 30, updating match info | M1 | explorer_db_r2 |
| F4 | Booking Cancellation RPC (`cancel_venue_booking`) | Update `status = 'cancelled'`, instantly releasing slot from GiST exclusion index | M1 | explorer_db_r2 |
| F5 | Venue Coordinates in Booking Domain & Schema | Add `lat?: number | null`, `lng?: number | null` to `VenueBooking` in `venueBookingSchema.ts` | M2 | explorer_bookings_r2 |
| F6 | Venue Join Query Enhancement | Update `listMyBookings` and `getBookingForMatch` in `venueBookingRepository.ts` to select `lat, lng` | M2 | explorer_bookings_r2 |
| F7 | Box/Court & Duration Formatting Utilities | Enhance `formatCourtLabel` (support turf/box) and add `formatDurationLabel`, `formatSlotWindowWithDuration`, `formatBookingDateClean` in `slotUtils.ts` | M2 | explorer_bookings_r2 |
| F8 | Cross-Platform Native Map Directions Utility | Implement `openMapDirections({ lat, lng, address, name })` in `src/features/venues/domain/mapDirections.ts` using `Linking.openURL` with Apple Maps, Android geo URI, and universal web fallback | M3 | explorer_bookings_r2 |
| F9 | Frontend 30-Min Grid & Continuous Spanning | Verify and update `TimeSlotGrid.tsx` & `CourtSlotPickerSheet.tsx` for 30-min slots, exact 2.5 hr spanning (5 slots), and non-locking boundary slots | M3 | explorer_frontend_r2 |
| F10 | Rich My Court Bookings Screen Enrichment | Update `app/profile/bookings.tsx` and `MyBookingsModal.tsx` to prominently show Venue Name, Box/Court badge, Address with pin, Date & Time with duration, and "Get Directions" button | M4 | explorer_bookings_r2 |
| F11 | Full Verification, Typecheck & Release APK | 100% test pass rate on unit & E2E suites, zero TypeScript errors (`npx tsc --noEmit`), and clean release APK build | M5 | all |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Database Migration & Stored Procedures | Create migration `20260907140000_granular_30min_slots_and_box_formatting.sql` updating default slot duration to 30 mins, `get_venue_slots`, and `book_venue_slot` | none | DONE |
| M2 | TypeScript Domain, Repository & Formatting Utilities | Update `venueBookingSchema.ts`, `venueBookingRepository.ts`, and `slotUtils.ts` for geo coordinates, sport types, and duration formatting | M1 | DONE |
| M3 | Native Map Directions Utility & Frontend Slot Grid | Create `mapDirections.ts` and verify/adjust `TimeSlotGrid.tsx` & `CourtSlotPickerSheet.tsx` for 30-min continuous spanning | M2 | DONE |
| M4 | My Court Bookings UI Screen Enrichment | Redesign `app/profile/bookings.tsx` and enrich `MyBookingsModal.tsx` with venue name, box/court formatting, address, duration, and "Get Directions" CTA | M3 | DONE |
| M5 | Comprehensive Verification, Typecheck & APK Build | Run full test suites, TypeScript strict check (`npx tsc --noEmit`), release APK build, Reviewer, Challenger, and Forensic Auditor verification | M4 | DONE |

## Interface Contracts

### Database RPC Contracts
```sql
-- get_venue_slots: generates 30-min slots by default (or venue.slot_duration_minutes)
function public.get_venue_slots(
  in_venue_id   uuid,
  in_date       date,
  in_timezone   text default 'Asia/Kolkata'
) returns table (
  court_number    integer,
  court_label     text, -- "Box N" for box_cricket/turf, "Court N" for badminton/tennis
  start_time      timestamptz,
  end_time        timestamptz,
  time_hhmm       text,
  end_time_hhmm   text,
  is_available    boolean,
  booking_id      uuid,
  is_my_booking   boolean
);
```

### TypeScript Domain Contracts
```typescript
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
  venueName?: string;
  venueAddress?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
  sportTypes?: string[];
}

export function formatCourtLabel(courtNumber: number, sportTypes?: string[]): string;
export function formatDurationLabel(startTime: string | Date, endTime: string | Date): string;
export function formatSlotWindowWithDuration(startTime: string, endTime: string, timezone?: string): string;
export function openMapDirections(options: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  name?: string;
}): Promise<void>;
```

## Code Layout
- `supabase/migrations/20260907140000_granular_30min_slots_and_box_formatting.sql`: Stored procedures & default 30-min slot migration
- `src/features/venues/domain/venueBookingSchema.ts`: Domain models and schemas
- `src/features/venues/domain/slotUtils.ts`: Pure functional duration and box/court utilities
- `src/features/venues/domain/mapDirections.ts`: Cross-platform native map linking utility
- `src/features/venues/data/venueBookingRepository.ts`: Supabase RPC and queries with coordinates
- `src/features/venues/presentation/TimeSlotGrid.tsx`: Dynamic 30-min slot availability grid
- `src/features/venues/presentation/CourtSlotPickerSheet.tsx`: Duration chips & slot range calculation
- `src/features/venues/presentation/BookingModal.tsx`: Booking confirmation bottom sheet
- `src/features/venues/presentation/MyBookingsModal.tsx`: User booking modal with directions & duration
- `app/profile/bookings.tsx`: User profile bookings screen with prominent venue name, address & directions
