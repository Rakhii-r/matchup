# Handoff Report: Rich Venue Details, Box Formatting & Map Directions (R2) + APK Verification

**Agent**: Explorer 3 (Bookings & Maps Explorer)  
**Date**: 2026-09-07  
**Working Directory**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_bookings_r2`  
**Target Milestone**: R2 Rich Venue Details, Box Formatting & Map Directions in My Court Bookings, plus APK verification  
**Reference Request**: `ORIGINAL_REQUEST.md` (2026-09-07T08:35:52Z)

---

## 1. Observation

1. **`app/profile/bookings.tsx` Missing Venue Name & Address**:
   - In `app/profile/bookings.tsx` (lines 81–83), the header of each booking card displays:
     ```tsx
     <AppText variant="label" color={M.text} style={styles.venueName}>
       {formatCourtLabel(item.courtNumber)}
     </AppText>
     ```
     `item.venueName` is never rendered anywhere on the card. `styles.venueName` displays "Court 1" or "Court 2" instead of the actual venue name (e.g. "Ace Sports Hub").
   - Venue address is completely absent from `app/profile/bookings.tsx`.
   - `formatCourtLabel` is called as `formatCourtLabel(item.courtNumber)` at line 39 and line 82 without passing `item.sportTypes`.
   - Date and time (lines 68–75) are formatted without any duration indicator (`startDate.toLocaleTimeString(...) - endDate.toLocaleTimeString(...)`).
   - There is no "Get Directions" button anywhere in `app/profile/bookings.tsx`.

2. **`src/features/venues/presentation/MyBookingsModal.tsx` Missing Directions & Duration**:
   - In `MyBookingsModal.tsx` (lines 275–285), `booking.venueName` and `booking.venueAddress` are rendered with `<IconPin color={M.muted} size={13} />`.
   - In lines 342–353, the time slot is rendered using `formatSlotWindow(booking.startTime, booking.endTime, timezone) || ...`, which displays e.g. `01:00 PM – 03:30 PM`, but lacks duration (e.g. `(2.5 hrs)`).
   - There is no "Get Directions" button anywhere in `MyBookingsModal.tsx`.

3. **Supabase Query Missing `lat` and `lng`**:
   - In `src/features/venues/data/venueBookingRepository.ts` (lines 160–165 and 194–199):
     ```ts
     .from('venue_bookings')
     .select('*, venues(name, address, sport_types)')
     .eq('user_id', currentUserId)
     .order('start_time', { ascending: false });
     ```
     The query joins `name`, `address`, and `sport_types`, but omits `lat` and `lng`.
   - In `src/features/venues/domain/venueBookingSchema.ts` (lines 17–33), the `VenueBooking` interface defines `venueName?: string`, `venueAddress?: string | null`, and `sportTypes?: string[]`, but has no `lat` or `lng` fields.
   - In `src/shared/types/database.types.ts` (lines 178–207), table `public.venues` columns include `lat: number; lng: number; address: string | null; name: string; sport_types: Sport[];`.

4. **Existing Icon & Linking Infrastructure**:
   - In `src/shared/ui/icons.tsx` (lines 168–174), `IconDirections` is already defined as a turn-sign diamond SVG glyph, but is currently unused across the entire codebase.
   - React Native's `Linking` and `Platform` APIs (`import { Linking, Platform } from 'react-native'`) are available for opening native map URIs.
   - Package `"expo-linking": "^56.0.14"` is installed in `package.json`.

5. **Build and Test Verification**:
   - Executed command: `npm run typecheck` (`tsc --noEmit`).
     Result: Exited code 0 with 0 errors.
   - Executed command: `npx tsx --test tests/e2e/tier1_features/venueUiComponents.test.ts`.
     Result: 22/22 unit tests passed in 8.989s.
   - Inspected `android/app/build.gradle`: lines 112–115 specify `signingConfig signingConfigs.debug` for the `release` build type.
   - Verified pre-existing release APK: `android/app/build/outputs/apk/release/app-release.apk` (57,458,319 bytes, created 2026-09-07 11:55:24).

---

## 2. Logic Chain

1. **Premise 1 (Data Layer)**: The user request mandates launching device map directions using the venue's latitude, longitude, and address (Observation 1 & 3). Because `venueBookingRepository.ts` only selects `name, address, sport_types` from `venues`, the booking objects in memory lack latitude and longitude. Therefore, `venueBookingSchema.ts` must add `lat?: number | null; lng?: number | null;` to `VenueBooking`, and `venueBookingRepository.ts` must update its join query to `.select('*, venues(name, address, sport_types, lat, lng)')`.
2. **Premise 2 (Court vs. Box Formatting)**: The user request requires "Box N" for Box Cricket / Turf and "Court N" for Badminton / Tennis. Observation 1 shows `formatCourtLabel` in `slotUtils.ts` currently checks only `box_cricket` or `cricket`, and `app/profile/bookings.tsx` fails to pass `item.sportTypes`. Therefore, `formatCourtLabel` should be updated to check for `box_cricket`, `cricket`, `turf`, and `box`, and all calls in `app/profile/bookings.tsx` must pass `item.sportTypes`.
3. **Premise 3 (Prominent Venue Details in Profile Bookings)**: Observation 1 demonstrates that `app/profile/bookings.tsx` renders the court label where the venue name belongs, and completely leaves out the address. Therefore, `app/profile/bookings.tsx` must be restructured to show:
   - Ground/Venue Name (`item.venueName ?? 'Venue Ground'`) prominently as the title.
   - Box/Court label (`formatCourtLabel(item.courtNumber, item.sportTypes)`) as a distinct badge or sub-row.
   - Address row with `<IconPin color={M.muted} size={13} />`.
4. **Premise 4 (Date, Time & Duration)**: The request specifies `Mon, 7 Sept, 2026 · 1:00 PM – 3:30 PM (2.5 hrs)`. Observation 1 & 2 show neither UI component calculates or appends duration. Adding utility functions `formatDurationLabel(start, end)` and `formatSlotWindowWithDuration(start, end, tz)` in `slotUtils.ts` allows both `app/profile/bookings.tsx` and `MyBookingsModal.tsx` to display duration cleanly.
5. **Premise 5 (Interactive Map Directions)**: Observation 4 confirms `IconDirections` exists in `src/shared/ui/icons.tsx`. By implementing an `openMapDirections` utility using `Linking.openURL`, we can dispatch:
   - iOS: `http://maps.apple.com/?daddr=${lat},${lng}&q=${name}`
   - Android: `geo:0,0?q=${lat},${lng}(${name})`
   - Universal Web Fallback: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
   A "Get Directions" button can then be placed on each booking card in both `app/profile/bookings.tsx` and `MyBookingsModal.tsx`.
6. **Premise 6 (Build & APK Verification)**: Observation 5 confirms `tsc --noEmit` passes with 0 errors, unit tests pass 100%, and the Android release APK configuration is functional and self-contained with debug keystore signing.

---

## 3. Caveats

1. **Android 11+ Package Visibility for `canOpenURL`**: On modern Android versions, `Linking.canOpenURL('geo:...')` may return `false` unless custom queries are registered in `AndroidManifest.xml`. To avoid silently failing, the implementation must use a `try / catch` pattern that immediately falls back to opening the universal Google Maps web URL (`https://www.google.com/maps/dir/?api=1&destination=...`), which Android will intercept with the native Google Maps app without requiring manifest package declarations.
2. **Nullable Coordinates in Legacy/Seed Venues**: In `database.types.ts`, `address` can be null. While `lat` and `lng` are non-null in standard venues, test or incomplete venues might have `0, 0` or missing coords. `openMapDirections` must gracefully fall back to geocoding the address string if coordinates are absent or invalid.
3. **No Code Written by Explorer**: As an Explorer, this analysis is strictly read-only; no application source code files have been modified.

---

## 4. Conclusion

1. **Scope of Changes Identified**:
   - `src/features/venues/domain/venueBookingSchema.ts`: Add `lat?: number | null; lng?: number | null;` to `VenueBooking`.
   - `src/features/venues/data/venueBookingRepository.ts`: Update `.select('*, venues(name, address, sport_types, lat, lng)')` in `listMyBookings` and `getBookingForMatch`, and map `lat` and `lng`.
   - `src/features/venues/domain/slotUtils.ts`: Enhance `formatCourtLabel` to support `turf` / `box`; add `formatDurationLabel`, `formatSlotWindowWithDuration`, and `formatBookingDateClean`.
   - `src/features/venues/domain/mapDirections.ts`: Create `openMapDirections` utility with cross-platform native map URI generation and universal web fallback.
   - `app/profile/bookings.tsx`: Redesign booking card to prominently display Venue Name, Box/Court badge, Venue Address with `IconPin`, Date & Time with duration indicator, and "Get Directions" button.
   - `src/features/venues/presentation/MyBookingsModal.tsx`: Add "Get Directions" button and format slot window with duration.
   - `tests/e2e/tier1_features/venueUiComponents.test.ts`: Add unit test assertions for duration labels and turf box formatting.
2. **Compilation and APK Feasibility**: TypeScript types are fully consistent, and the Android build pipeline in `android/app/build.gradle` is ready for release APK compilation.

---

## 5. Verification Method

### 5.1. Independent Verification Commands
Run these commands from the project root (`c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`):

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: Exit code 0 with no diagnostic errors.

2. **Venue UI Component Unit Tests**:
   ```bash
   npx tsx --test tests/e2e/tier1_features/venueUiComponents.test.ts
   ```
   *Expected result*: All test suites pass (22+ tests).

3. **Android Release APK Build**:
   ```bash
   cd android && ./gradlew.bat assembleRelease
   ```
   *Expected result*: `BUILD SUCCESSFUL`, generating `android/app/build/outputs/apk/release/app-release.apk`.

### 5.2. Files to Inspect
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_bookings_r2\analysis.md`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\app\profile\bookings.tsx`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\presentation\MyBookingsModal.tsx`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\domain\slotUtils.ts`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\data\venueBookingRepository.ts`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\src\features\venues\domain\venueBookingSchema.ts`

### 5.3. Invalidation Conditions
- If Supabase `public.venues` does not expose `lat` and `lng` to the authenticated role (invalidated; check RLS policies in `20260723124606_venues_admin_only.sql` and `20260905062131_venue_slot_booking_and_concurrency.sql`).
- If `Linking.openURL` fails without falling back to Google Maps web navigation URL.
