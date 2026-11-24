## 2026-09-07T08:45:55Z

You are Worker 1 for the MatchUp project.
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_r2_1
Project workspace root: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Authoritative user request: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md

You MUST read ORIGINAL_REQUEST.md first before starting work. Study the latest request dated 2026-09-07T08:35:52Z regarding 30-Minute Granular Time Slots (R1) and Rich Venue Details, Box Formatting & Map Directions in My Court Bookings (R2).

DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

You have EXCLUSIVE write ownership of the following target files:
- supabase/migrations/20260907140000_granular_30min_slots_and_box_formatting.sql
- src/features/venues/domain/venueBookingSchema.ts
- src/features/venues/data/venueBookingRepository.ts
- src/features/venues/domain/slotUtils.ts
- src/features/venues/domain/mapDirections.ts
- app/profile/bookings.tsx
- src/features/venues/presentation/MyBookingsModal.tsx
- tests/e2e/tier1_features/venueUiComponents.test.ts

Study the detailed findings from the Survey Explorers:
- DB Explorer: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_db_r2\handoff.md
- Frontend Slot Explorer: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_frontend_r2\handoff.md
- Bookings & Maps Explorer: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_bookings_r2\handoff.md

Your implementation tasks:
1. Migration `supabase/migrations/20260907140000_granular_30min_slots_and_box_formatting.sql`:
   - Set default `slot_duration_minutes = 30` on `public.venues`.
   - Update existing rows in `public.venues` to `slot_duration_minutes = 30`.
   - Update `get_venue_slots`:
     - Default step size fallback to 30 minutes.
     - Dynamic court label: 'Box ' || c.c_num for 'box_cricket' or 'turf', else 'Court ' || c.c_num.
   - Update `book_venue_slot`:
     - Validate start_time aligns to 30-min boundary (`round(extract(epoch from (in_start_time - date_trunc('hour', in_start_time))) / 60)::integer % 30 = 0`).
     - Validate duration is positive multiple of 30 (`v_dur_min % 30 = 0`).
     - Update match end_time and venue_text if linked.
2. Domain Schema `src/features/venues/domain/venueBookingSchema.ts`:
   - Add `venueLat?: number | null; venueLng?: number | null;` to `VenueBooking` interface.
3. Repository `src/features/venues/data/venueBookingRepository.ts`:
   - In `listMyBookings` and `getBookingForMatch`, update `.select('*, venues(name, address, sport_types, lat, lng)')` and map `venueLat: rawVenue?.lat ?? null, venueLng: rawVenue?.lng ?? null`.
4. Domain Utilities `src/features/venues/domain/slotUtils.ts`:
   - Enhance `formatCourtLabel` to support 'box_cricket', 'cricket', 'turf', 'box'.
   - Add `formatDurationLabel(startTime, endTime)` returning e.g. "1 hr", "2.5 hrs".
   - Add `formatSlotWindowWithDuration(startTime, endTime, timezone)` returning e.g. "1:00 PM – 3:30 PM (2.5 hrs)".
   - Add `formatBookingDateClean(startTime, timezone)` returning e.g. "Mon, 7 Sept, 2026".
5. Map Directions `src/features/venues/domain/mapDirections.ts`:
   - Implement `openMapDirections({ lat, lng, address, name })` using `Linking.openURL` with Apple Maps for iOS, `geo:` URI for Android, and universal Google Maps web fallback (`https://www.google.com/maps/dir/?api=1&destination=...`).
6. Profile Bookings UI `app/profile/bookings.tsx`:
   - Display prominent Venue Name (`item.venueName ?? 'Venue Booking'`).
   - Display Court / Box badge (`formatCourtLabel(item.courtNumber, item.sportTypes)`).
   - Display Address with `<IconPin color={M.muted} size={14} />`.
   - Display Date & Time with duration indicator (`formatBookingDateClean` and `formatSlotWindowWithDuration`).
   - Add "Get Directions" button using `<IconDirections size={16} color={M.limeInk} />` invoking `openMapDirections`.
   - Preserve instant cancellation flow and status badges.
7. My Bookings Modal UI `src/features/venues/presentation/MyBookingsModal.tsx`:
   - Format time slot with duration indicator.
   - Add "Get Directions" button invoking `openMapDirections`.
8. Testing & Verification:
   - Add comprehensive unit tests in `tests/e2e/tier1_features/venueUiComponents.test.ts` for duration formatting, box formatting, and map directions.
   - Run `npm run typecheck` (`tsc --noEmit`).
   - Run `npx tsx tests/e2e/tier1_features/venueUiComponents.test.ts` and ensure 100% pass.
   - Write a self-contained handoff report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_r2_1\handoff.md`.
   - Send completion message to parent.
