# Execution Plan: 30-Min Granular Slots & Rich My Court Bookings

## Objectives
1. Implement 30-minute granular time slots (Playo-style) so multi-hour bookings (e.g. 2.5 hrs) span exact 30-min intervals without over-locking subsequent slots.
2. Enrich My Court Bookings screen with venue/box details, address, formatted date/time duration, and interactive native map directions button.
3. Ensure 100% test pass rate, 0 TypeScript errors (`npx tsc --noEmit`), and clean Android release APK build.

## Milestones & Phased Execution

### Phase 0: Survey & Current Architecture Exploration
- Dispatch Explorers to map:
  - Database migrations & stored procedure `get_venue_slots` in `supabase/migrations/`
  - Types & domain models in `src/types/` / `src/features/venues/`
  - Time slot grid & duration selection components (e.g., `TimeSlotGrid.tsx`, `VenueDetailModal.tsx`, booking logic)
  - `app/profile/bookings.tsx` and `src/features/venues/presentation/MyBookingsModal.tsx`
  - Existing tests & APK build configuration

### Milestone 1: Database Schema & Stored Procedures
- Update database default `slot_duration_minutes` to `30` in `public.venues` and in `get_venue_slots`.
- Ensure slot calculation dynamically returns 30-min intervals per court.
- Verify double-booking prevention constraint and cancellation releases work cleanly with 30-min intervals.

### Milestone 2: TypeScript Types & Domain Models
- Update booking and venue types to support 30-min intervals, exact start_time/end_time spans, venue details (address, latitude, longitude, sport_types).
- Update API queries/joins to fetch venue address, coordinates, and sport types when fetching user bookings.

### Milestone 3: Frontend Time Slot Grid & Exact Duration Selection
- Generate 30-minute blocks (e.g. 1:00 PM – 1:30 PM, 1:30 PM – 2:00 PM, etc.).
- Multi-hour duration chips (`1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`).
- Exact spanning: 2.5 hrs from 1:00 PM selects strictly 1:00 PM to 3:30 PM (5 slots). 3:30 PM – 4:00 PM remains Available.

### Milestone 4: My Court Bookings Screen Enrichment & Native Map Directions
- Update `app/profile/bookings.tsx` and `src/features/venues/presentation/MyBookingsModal.tsx`:
  - Venue Name prominently displayed.
  - "Box N" (for Box Cricket / Turf) vs "Court N" (for Badminton / Tennis) formatting.
  - Venue Address with location pin.
  - Date and time formatted cleanly with duration indicator: `Mon, 7 Sept, 2026` · `1:00 PM – 3:30 PM (2.5 hrs)`.
  - "Get Directions" button using `Linking.openURL` with platform-specific native map scheme (`geo:`, `maps:`, `https://maps.google.com/?q=`).
  - Maintain cancellation flow and status badges.

### Milestone 5: Full Verification
- Unit & E2E tests for 30-minute slot ranges, multi-hour durations, map directions.
- TypeScript static analysis (`npx tsc --noEmit`).
- Release APK build verification.
- Independent Reviewers, Challengers, and Forensic Auditor verification.
