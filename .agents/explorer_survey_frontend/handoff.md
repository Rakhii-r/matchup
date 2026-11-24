# Handoff Report: Frontend Survey for Venue Slot Booking & Court Selection

**Agent:** `survey_frontend_explorer`  
**Date:** 2026-09-04  
**Working Directory:** `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend`  

---

## 1. Observation

1. **Framework and Stack:**
   - In `package.json:19-54`:
     - `"expo": "~56.0.13"`, `"expo-router": "~56.2.12"`, `"react": "19.2.3"`, `"react-native": "0.85.3"`.
     - Data fetching & state: `"@tanstack/react-query": "^5.59.0"`, `"zustand": "^5.0.1"`, `"@supabase/supabase-js": "^2.45.4"`.
     - Styling: Vanilla React Native `StyleSheet.create` with theme tokens from `@shared/theme/index.ts` and `@shared/theme/mockTheme.ts`.
     - Icons: Custom SVGs using `"react-native-svg": "15.15.4"` in `src/shared/ui/icons.tsx`.

2. **Venues Tab (`app/(tabs)/venues.tsx`):**
   - At line 41: `export default function VenuesScreen(): React.ReactNode`.
   - Uses `useVenues()` at line 44 to fetch venues.
   - At lines 224-237:
     ```tsx
     <View style={styles.actions}>
       <Pressable
         style={[styles.bookBtn, !v.phone && styles.bookBtnDisabled]}
         disabled={!v.phone}
         onPress={() => v.phone && callVenue(v.phone)}
       >
         <AppText variant="label" color={M.ctaText}>
           {v.phone ? 'Call to confirm' : 'No phone listed'}
         </AppText>
       </Pressable>
       <Pressable style={styles.dirBtn} onPress={() => openDirections(v)}>
         <IconDirections color={M.text} size={20} />
       </Pressable>
     </View>
     ```
   - No interactive date selector, no court/box picker, no time slot grid, and no in-app booking action exists.

3. **Ground Selection for Matches (`app/match/[id]/venue.tsx`):**
   - At lines 52, 79-88:
     ```tsx
     const setVenue = useSetMatchVenue(matchId);
     ...
     const onPick = (venueId: string | null) => {
       setVenue.mutate(venueId, {
         onSuccess: () => router.back(),
         onError: (err: unknown) => {
           const message =
             err instanceof Error ? err.message : 'Could not save the venue. Please try again.';
           Alert.alert('Venue not saved', message);
         },
       });
     };
     ```
   - Only updates `matches.venue_id` via `set_match_venue` RPC.
   - Does not query or display courts, dates, time slots, or create a booking.

4. **Match Details Screen (`app/match/[id]/index.tsx`):**
   - Lines 798-802:
     ```tsx
     {data.venue_id ? (
       <AppText variant="caption" muted style={{ marginTop: spacing.xs }}>
         sixfour24 has not reserved this turf — call the ground to confirm your slot.
       </AppText>
     ) : null}
     ```
   - Explains that the turf is unreserved and prompts users to call offline.

5. **Existing Domain Schemas and Types:**
   - In `src/shared/types/database.types.ts:178-223`, `venues` table currently lacks `courts_count`, `open_time`, `close_time`, `slot_minutes`, `is_bookable`, and `price_per_slot`.
   - There is no `bookings` table in `database.types.ts`.
   - In `src/features/venues/data/venueRepository.ts`, methods exist only for `list`, `nearby`, `getById`, `create`, `update`, `suggest`, `setStatus`, `rate`, `myRating`, `remove`. No booking methods exist.

6. **Typecheck Execution:**
   - Executed `npm run typecheck` (`tsc --noEmit`).
   - Command exited with code 0 (0 errors).

---

## 2. Logic Chain

1. From Observation 1, the app uses Expo Router with React Query and Zustand. All UI changes must conform to Expo Router navigation and React Native `StyleSheet` styling using the design tokens in `@shared/theme`.
2. From Observation 2 and 4, the current Venues tab and match venue integration are static and offline. The app explicitly displays "sixfour24 has not reserved this turf — call the ground to confirm your slot."
3. From Observation 3, selecting a venue on a match only invokes `set_match_venue(match_id, venue_id)`, without any court or slot selection.
4. Therefore, to satisfy Requirements R1–R4:
   - UI components must be created for:
     - `DateStrip`: Interactive date selection (today + 14 days).
     - `CourtPicker`: Tab/chip selector for "Court 1", "Court 2", "Box 1", etc.
     - `TimeSlotGrid`: Grid of time slots with clear "Available" vs "Occupied" states.
     - `BookingModal`: Bottom sheet modal with confirmation summary and conflict handling ("Slot already taken").
     - `MyBookingsModal`: View to inspect active bookings and cancel them to release slots.
   - `app/(tabs)/venues.tsx` must be updated with an in-app "Book Slot" entry point that launches the interactive picker and booking modal.
   - `app/match/[id]/venue.tsx` must be upgraded so match organisers can pick venue, court, and time slot, creating a linked booking that updates the match details screen.
   - Conflict handling must catch Postgres exclusion constraint / RPC errors and display "Slot already taken" with immediate slot grid refetching.

---

## 3. Caveats

1. **Backend Dependency:** The frontend booking UI and slot calculations depend on backend database tables (`bookings`), updated `venues` columns (`courts_count`, `open_time`, `close_time`, `slot_minutes`, `is_bookable`), and Postgres RPCs (`get_venue_slots`, `book_slot`, `cancel_booking`).
2. **Offline Payments:** In accordance with `MatchUp_Admin_Venue_Booking_Spec.md`, pricing is informational only (e.g. "Pay at venue"). No payment gateway integration is in scope.
3. **Timezones:** In India, IST (UTC+5:30) is standard with no DST. Timestamps must be stored in UTC (`tstzrange` / ISO strings) and formatted for display in IST.

---

## 4. Conclusion

The frontend codebase is well-structured, follows Clean Architecture (`data`, `domain`, `presentation`), and passes TypeScript compilation with 0 errors. Implementing the venue booking UI requires:
1. Creating reusable presentation components in `src/features/venues/presentation/` (`DateStrip`, `CourtPicker`, `TimeSlotGrid`, `BookingModal`, `MyBookingsModal`).
2. Integrating booking queries and mutations in `src/features/venues/data/venueRepository.ts` and `src/features/venues/presentation/useVenues.ts`.
3. Upgrading `app/(tabs)/venues.tsx` from an offline directory to an interactive booking interface with booking management.
4. Upgrading `app/match/[id]/venue.tsx` and `app/match/[id]/index.tsx` to link booked court slots with match rows.

---

## 5. Verification Method

1. **Static Typecheck:**
   ```powershell
   npm run typecheck
   ```
   Must pass with 0 errors.

2. **Component & Flow Inspection:**
   - Inspect `app/(tabs)/venues.tsx` to verify presence of date selection, court selection, slot grid, and booking modal.
   - Inspect `app/match/[id]/venue.tsx` to verify match linking flow.
   - Inspect `app/match/[id]/index.tsx` to verify display of confirmed court & time slot.

3. **Invalidation Conditions:**
   - Any commit modifying the `venues` or `bookings` database schemas or RPC signatures requires updating `src/shared/types/database.types.ts`.
