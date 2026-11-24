# Comprehensive Analysis: Rich Venue Details, Box Formatting & Map Directions (R2) + APK Verification

**Date**: 2026-09-07  
**Explorer**: Explorer 3 (Bookings & Maps Explorer)  
**Workspace**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`  
**Working Directory**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_bookings_r2`  
**Reference Request**: `ORIGINAL_REQUEST.md` (2026-09-07T08:35:52Z)

---

## 1. Executive Summary

This investigation covers **Requirement R2** ("Rich Venue Details, Box Formatting & Map Directions in My Court Bookings") and acceptance criteria regarding **TypeScript compilation and Release APK readiness**.

### Core Findings
1. **Venue Details & Address in `app/profile/bookings.tsx`**: Currently, `app/profile/bookings.tsx` suffers from an omission bug where `item.venueName` is never rendered—instead, `formatCourtLabel(item.courtNumber)` is displayed as the card title, and venue address is completely absent.
2. **Missing Geo Coordinates in Supabase Queries**: In `venueBookingRepository.ts`, `listMyBookings()` and `getBookingForMatch()` join `venues(name, address, sport_types)` but omit `lat` and `lng`. The `VenueBooking` domain interface in `venueBookingSchema.ts` also lacks `lat` and `lng` (or `latitude` / `longitude`). Without these fields, map directions cannot reliably target exact GPS coordinates.
3. **Court vs. Box Formatting**: In `slotUtils.ts`, `formatCourtLabel(courtNumber, sportTypes)` checks for `box_cricket` or `cricket`, but does not explicitly check for `turf` or `box`. Furthermore, `app/profile/bookings.tsx` calls `formatCourtLabel(item.courtNumber)` without passing `sportTypes`, causing Box Cricket bookings to erroneously render as "Court 1".
4. **Date, Time & Duration Formatting**: Neither screen currently formats duration alongside time slots (e.g. `1:00 PM – 3:30 PM (2.5 hrs)`). `app/profile/bookings.tsx` uses raw local time strings without duration, while `MyBookingsModal.tsx` formats slot start/end but does not append duration indicators.
5. **Interactive "Get Directions" Button**: Completely absent in both screens. An existing, unused `IconDirections` SVG glyph is already present in `src/shared/ui/icons.tsx`. An interactive map navigation handler utilizing `Linking.openURL` with platform-specific native URIs (Apple Maps on iOS, geo URI on Android) and universal Google Maps web fallback can be cleanly integrated.
6. **Cancellation Flow & Badges**: The instant cancellation flow using `useCancelBooking()` RPC and status badges (`CONFIRMED`, `COMPLETED`, `CANCELLED`) is operational and conforms to requirements.
7. **Build & Test Status**:
   - `npx tsc --noEmit` passes with **0 errors**.
   - `npx tsx --test tests/e2e/tier1_features/venueUiComponents.test.ts` passes **22/22 tests**.
   - Android release APK setup is preconfigured in `android/app/build.gradle` using `signingConfigs.debug`, with an existing 57.4 MB `app-release.apk` artifact present.

---

## 2. Current State Analysis of Bookings UI

The app provides two entry points for viewing court bookings:
1. **Screen**: `app/profile/bookings.tsx` (Route `/profile/bookings`, navigated from `app/(tabs)/profile.tsx`).
2. **Modal**: `src/features/venues/presentation/MyBookingsModal.tsx` (Launched from `app/(tabs)/venues.tsx` via header button and calendar icon).

### 2.1. Analysis of `app/profile/bookings.tsx`

```tsx
// Location: app/profile/bookings.tsx (Lines 77-149)
const renderBookingItem = ({ item }: { item: VenueBooking }) => {
  const isCancelled = item.status === 'cancelled';
  const isPast = new Date(item.endTime).getTime() < Date.now();
  const isBusy = cancellingId === item.id;

  const startDate = new Date(item.startTime);
  const dateFormatted = startDate.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeFormatted = `${startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} - ${new Date(item.endTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <View style={[styles.card, isCancelled && styles.cardCancelled]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" color={M.text} style={styles.venueName}>
            {formatCourtLabel(item.courtNumber)}  {/* BUG: Renders "Court 1" as venue name! */}
          </AppText>
          {item.matchId ? (
            <AppText variant="caption" color={M.green} style={{ fontWeight: '600', marginTop: 2 }}>
              Linked to Match Fixture
            </AppText>
          ) : null}
        </View>
        ... status badge ...
      </View>
      <View style={styles.metaRow}>
        <IconCalendar color={M.muted} size={15} />
        <AppText variant="caption" color={M.text} style={styles.metaText}>{dateFormatted}</AppText>
      </View>
      <View style={styles.metaRow}>
        <IconClock color={M.muted} size={15} />
        <AppText variant="caption" color={M.text} style={styles.metaText}>{timeFormatted}</AppText>
      </View>
      {/* Missing: Venue Address with IconPin */}
      {/* Missing: Get Directions button */}
      ...
    </View>
  );
};
```

#### Identified Deficiencies in `app/profile/bookings.tsx`:
- **Ground / Venue Name**: The card header renders `{formatCourtLabel(item.courtNumber)}` instead of `item.venueName`. The user never sees the name of the ground they booked (e.g. "Ace Sports Hub" or "GreenTurf Box Cricket").
- **Box / Court Formatting**: `formatCourtLabel(item.courtNumber)` is invoked without `item.sportTypes`, so it cannot determine whether it should say "Box 1" vs "Court 1".
- **Venue Address**: Completely missing from the card.
- **Duration**: `timeFormatted` shows `startDate - endDate` without duration indicator (e.g. `(2.5 hrs)`).
- **Directions Button**: There is no button to get directions.

---

### 2.2. Analysis of `src/features/venues/presentation/MyBookingsModal.tsx`

```tsx
// Location: src/features/venues/presentation/MyBookingsModal.tsx (Lines 272-355)
<View style={styles.cardHeader}>
  <View style={{ flex: 1, gap: 2 }}>
    <AppText variant="heading" color={M.text} style={styles.venueName} numberOfLines={1}>
      {booking.venueName ?? 'Venue Ground'}
    </AppText>
    {booking.venueAddress ? (
      <View style={styles.metaRow}>
        <IconPin color={M.muted} size={13} />
        <AppText variant="caption" color={M.muted} numberOfLines={1}>
          {booking.venueAddress}
        </AppText>
      </View>
    ) : null}
  </View>
  ... status badge ...
</View>

<View style={styles.slotInfoBox}>
  <View style={styles.slotDetailRow}>
    <View style={styles.detailItem}>
      <AppText variant="caption" color={M.muted} style={styles.detailLabel}>COURT / BOX</AppText>
      <AppText variant="label" color={M.text} style={styles.detailValue}>{courtLabel}</AppText>
    </View>
    <View style={styles.detailDivider} />
    <View style={styles.detailItem}>
      <AppText variant="caption" color={M.muted} style={styles.detailLabel}>DATE</AppText>
      <View style={styles.iconValRow}>
        <IconCalendar color={M.muted} size={13} />
        <AppText variant="label" color={M.text} style={styles.detailValue}>{displayDate}</AppText>
      </View>
    </View>
    <View style={styles.detailDivider} />
    <View style={styles.detailItem}>
      <AppText variant="caption" color={M.muted} style={styles.detailLabel}>TIME SLOT</AppText>
      <View style={styles.iconValRow}>
        <IconClock color={M.green} size={13} />
        <AppText variant="label" color={M.green} style={styles.timeValue}>{timeWindow}</AppText>
      </View>
    </View>
  </View>
</View>
```

#### Identified Deficiencies in `MyBookingsModal.tsx`:
- **Get Directions Button**: Does not exist anywhere on the booking card.
- **Time Slot & Duration**: `timeWindow` uses `formatSlotWindow(booking.startTime, booking.endTime, timezone)`, which renders e.g. `01:00 PM – 03:30 PM` without the duration suffix `(2.5 hrs)`.
- **Latitude & Longitude**: Not queried or available on `booking`, making GPS-based directions impossible without schema and query updates.

---

## 3. Data Layer & Supabase Query Analysis

### 3.1. Supabase Database Schema
In Supabase table `public.venues` (defined in `database.types.ts` lines 178-207 and migrations):
- `id`: `uuid`
- `name`: `text`
- `address`: `text | null`
- `lat`: `double precision`
- `lng`: `double precision`
- `sport_types`: `text[]`
- `phone`: `text | null`
- `operating_hours_start`: `time`
- `operating_hours_end`: `time`
- `slot_duration_minutes`: `integer`
- `courts_count`: `integer`

Table `public.venue_bookings`:
- `id`: `uuid`
- `venue_id`: `uuid` (Foreign key to `public.venues.id`)
- `court_number`: `integer`
- `user_id`: `uuid`
- `start_time`: `timestamptz`
- `end_time`: `timestamptz`
- `status`: `'confirmed' | 'cancelled'`
- `match_id`: `uuid | null`
- `notes`: `text | null`

### 3.2. Current Repository Queries (`venueBookingRepository.ts`)

```ts
// Location: src/features/venues/data/venueBookingRepository.ts (Lines 160-188)
async listMyBookings(): Promise<VenueBooking[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData.session?.user?.id;
  if (!currentUserId) return [];

  const { data, error } = await supabase
    .from('venue_bookings')
    .select('*, venues(name, address, sport_types)')  // <-- Missing lat, lng!
    .eq('user_id', currentUserId)
    .order('start_time', { ascending: false });

  if (error) throw bookingErrorToAppError(error);

  return (data ?? []).map((row) => {
    const venueObj = row.venues as { name?: string; address?: string | null; sport_types?: string[] } | null;
    return {
      id: row.id,
      venueId: row.venue_id,
      courtNumber: row.court_number,
      userId: row.user_id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      matchId: row.match_id,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at,
      venueName: venueObj?.name,
      venueAddress: venueObj?.address,
      sportTypes: venueObj?.sport_types,
      // lat and lng are omitted!
    };
  });
}
```

### 3.3. Required Domain Schema Expansion (`venueBookingSchema.ts`)

```ts
// Location: src/features/venues/domain/venueBookingSchema.ts (Lines 17-33)
export interface VenueBooking {
  id: string;
  venueId: string;
  courtNumber: number;
  userId: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  matchId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  venueName?: string;
  venueAddress?: string | null;
  sportTypes?: string[];
  // Add coordinates for navigation:
  lat?: number | null;
  lng?: number | null;
}
```

In `venueBookingRepository.ts`:
Change query to:
```ts
.select('*, venues(name, address, sport_types, lat, lng)')
```
And populate `lat: venueObj?.lat, lng: venueObj?.lng` in both `listMyBookings` and `getBookingForMatch`.

---

## 4. Court vs. Box Label Formatting

### 4.1. Analysis of `formatCourtLabel` in `slotUtils.ts`

```ts
// Location: src/features/venues/domain/slotUtils.ts (Lines 10-13)
export function formatCourtLabel(courtNumber: number, sportTypes?: string[]): string {
  const isBoxCricket = sportTypes?.some((s) => s === 'box_cricket' || s.toLowerCase().includes('cricket'));
  return `${isBoxCricket ? 'Box' : 'Court'} ${courtNumber}`;
}
```

### 4.2. Enhancements for Box Cricket / Turf vs Badminton / Tennis
To cleanly satisfy the requirement:
`"Box N" (for Box Cricket / Turf) vs "Court N" (for Badminton / Tennis)`:
```ts
export function formatCourtLabel(courtNumber: number, sportTypes?: string[]): string {
  const isBox = sportTypes?.some(
    (s) =>
      s === 'box_cricket' ||
      s.toLowerCase().includes('cricket') ||
      s.toLowerCase().includes('turf') ||
      s.toLowerCase().includes('box')
  );
  return `${isBox ? 'Box' : 'Court'} ${courtNumber}`;
}
```
And in both `app/profile/bookings.tsx` and `MyBookingsModal.tsx`:
Always pass `sportTypes`: `formatCourtLabel(booking.courtNumber, booking.sportTypes)`.

---

## 5. Date, Time & Duration Representation

### 5.1. Target Format
`Mon, 7 Sept, 2026` · `1:00 PM – 3:30 PM (2.5 hrs)`

### 5.2. Duration Calculator
Add to `slotUtils.ts`:

```ts
/**
 * Calculates human-readable duration label (e.g. "2.5 hrs", "1 hr", "30 mins").
 */
export function formatDurationLabel(startTimeIso: string, endTimeIso: string): string {
  try {
    const start = new Date(startTimeIso).getTime();
    const end = new Date(endTimeIso).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return '';
    const diffMinutes = Math.round((end - start) / (1000 * 60));
    const hours = diffMinutes / 60;
    if (diffMinutes < 60) return `${diffMinutes} mins`;
    if (hours === 1) return '1 hr';
    return `${hours} hrs`;
  } catch {
    return '';
  }
}

/**
 * Formats time window with duration indicator, e.g. "1:00 PM – 3:30 PM (2.5 hrs)".
 */
export function formatSlotWindowWithDuration(
  startTimeIso: string,
  endTimeIso: string,
  timezone: string = 'Asia/Kolkata',
): string {
  const window = formatSlotWindow(startTimeIso, endTimeIso, timezone);
  const duration = formatDurationLabel(startTimeIso, endTimeIso);
  if (!window) return '';
  return duration ? `${window} (${duration})` : window;
}

/**
 * Formats booking date cleanly (e.g. "Mon, 7 Sept, 2026").
 */
export function formatBookingDateClean(isoDateString: string, timezone: string = 'Asia/Kolkata'): string {
  try {
    const d = new Date(isoDateString);
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      }).format(d);
    }
  } catch {
    // fallback
  }
  return isoDateString.split('T')[0] ?? isoDateString;
}
```

---

## 6. Map Directions via React Native Linking

### 6.1. Platform Protocol Matrix

| Platform | Protocol URI Pattern | Fallback / Universal Web URL |
| :--- | :--- | :--- |
| **iOS** | `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}` (or `maps://...`) | `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` |
| **Android** | `geo:0,0?q=${lat},${lng}(${encodeURIComponent(label)})` | `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` |
| **Address Only** | `geo:0,0?q=${encodeURIComponent(address)}` (Android) / `http://maps.apple.com/?daddr=${encodeURIComponent(address)}` (iOS) | `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` |

### 6.2. Navigation Helper (`src/features/venues/domain/mapDirections.ts`)

```ts
import { Alert, Linking, Platform } from 'react-native';

export interface OpenMapDirectionsParams {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  name?: string | null;
}

export async function openMapDirections({
  lat,
  lng,
  address,
  name,
}: OpenMapDirectionsParams): Promise<void> {
  const hasCoords = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
  if (!hasCoords && !address) {
    Alert.alert('Location Unavailable', 'Venue coordinates and address are not available for directions.');
    return;
  }

  const label = name || address || 'Venue';
  const encodedLabel = encodeURIComponent(label);
  const destination = hasCoords ? `${lat},${lng}` : encodeURIComponent(address!);
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

  let nativeUrl = webUrl;
  if (Platform.OS === 'ios') {
    nativeUrl = hasCoords
      ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodedLabel}`
      : `http://maps.apple.com/?daddr=${encodeURIComponent(address!)}`;
  } else if (Platform.OS === 'android') {
    nativeUrl = hasCoords
      ? `geo:0,0?q=${lat},${lng}(${encodedLabel})`
      : `geo:0,0?q=${encodeURIComponent(address!)}`;
  }

  try {
    const canOpen = await Linking.canOpenURL(nativeUrl);
    if (canOpen) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch {
    // Intent check can throw without manifest queries on newer Android; proceed to fallback
  }

  try {
    await Linking.openURL(webUrl);
  } catch {
    Alert.alert('Directions Error', 'Could not open map directions application on this device.');
  }
}
```

### 6.3. Iconography & Button Styling
- `src/shared/ui/icons.tsx` already defines `IconDirections` at line 168:
  ```tsx
  export const IconDirections = make(({ color, strokeWidth: w }) => (
    <>
      <Path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" {...s(color, w)} />
      <Polyline points="11 9 14 12 11 15" {...s(color, w)} />
      <Path d="M14 12H9.5v2" {...s(color, w)} />
    </>
  ));
  ```
- Each card can display a clean, dedicated button:
  ```tsx
  <Pressable
    style={styles.directionsBtn}
    onPress={() => openMapDirections({
      lat: item.lat,
      lng: item.lng,
      address: item.venueAddress,
      name: item.venueName,
    })}
    accessibilityRole="button"
    accessibilityLabel="Get Directions"
  >
    <IconDirections color={M.green} size={15} />
    <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
      Get Directions
    </AppText>
  </Pressable>
  ```

---

## 7. Cancellation Flow & Status Badges

### 7.1. Instant Cancellation Flow
Both `app/profile/bookings.tsx` and `MyBookingsModal.tsx` implement:
1. `useCancelBooking()` from `@features/venues/presentation/useVenueBookings`.
2. Mutation calls `venueBookingRepository.cancelBooking(bookingId)`.
3. Invalidation triggers:
   - `['venue-slots']` -> Immediate slot reopening for other users.
   - `['my-bookings']` -> Immediate update of user's bookings list.
   - `['matches']` -> Invalidation of linked match fixture if applicable.
4. User confirmation alert:
   - Prompt: "Are you sure you want to cancel your booking for [Box/Court N] on [Date]? This will immediately free the slot for others."
   - Success alert: "Your court slot has been successfully cancelled and released."
   - Error alert: "Cancellation Failed: [error.message]".

### 7.2. Status Badges
- Active & Future: `CONFIRMED` (green pill badge).
- Elapsed: `COMPLETED` (cardHi/muted pill badge).
- Cancelled: `CANCELLED` (cardHi/red-tinted badge).
The flow is verified and robust.

---

## 8. Build & Test Environment Verification

### 8.1. TypeScript Compilation
- Executed `npm run typecheck` (`tsc --noEmit`).
- Result: **0 errors** (exit code 0).

### 8.2. Unit Tests
- Executed `npx tsx --test tests/e2e/tier1_features/venueUiComponents.test.ts`.
- Result: **22/22 tests passing** (0 failures, 0 skipped).
- Covers `getUpcomingDates`, `formatCourtLabel`, `getSlotStatus`, `computeSlotRange` (including 2.5-hour duration spanning 150 minutes), and double-booking conflict error translation.

### 8.3. Android Release APK Configuration
- Project has native Android workspace configured under `android/`.
- `android/app/build.gradle`:
  - `applicationId`: `com.asrdigi.matchup`
  - `compileSdk`: `rootProject.ext.compileSdkVersion` (35)
  - `release` build type uses `signingConfig signingConfigs.debug` pointing to `android/app/debug.keystore`.
  - An existing release APK is verified at `android/app/build/outputs/apk/release/app-release.apk` (57,458,319 bytes, generated 2026-09-07).
  - To build: `cd android && ./gradlew assembleRelease`.

---

## 9. Actionable Implementation Plan (for Implementer Agent)

| Step | Target File | Action |
| :--- | :--- | :--- |
| **Step 1** | `src/features/venues/domain/venueBookingSchema.ts` | Add `lat?: number \| null; lng?: number \| null;` to `VenueBooking` interface. |
| **Step 2** | `src/features/venues/data/venueBookingRepository.ts` | In `listMyBookings` and `getBookingForMatch`, update `.select('*, venues(name, address, sport_types, lat, lng)')` and map `lat: venueObj?.lat, lng: venueObj?.lng`. |
| **Step 3** | `src/features/venues/domain/slotUtils.ts` | 1. Enhance `formatCourtLabel` to check for `turf` and `box`.<br>2. Add `formatDurationLabel` and `formatSlotWindowWithDuration`.<br>3. Add `formatBookingDateClean`. |
| **Step 4** | `src/features/venues/domain/mapDirections.ts` | Create `openMapDirections({ lat, lng, address, name })` with iOS, Android, and web fallback via `Linking.openURL`. |
| **Step 5** | `app/profile/bookings.tsx` | 1. Display Venue Name prominently (`item.venueName ?? 'Venue Ground'`).<br>2. Display `formatCourtLabel(item.courtNumber, item.sportTypes)` as Court/Box badge/pill.<br>3. Display Address with `<IconPin />`.<br>4. Display Date and Time formatted with duration indicator (`formatSlotWindowWithDuration`).<br>5. Add interactive "Get Directions" button using `IconDirections` and `openMapDirections`.<br>6. Ensure cancellation alert uses `formatCourtLabel(item.courtNumber, item.sportTypes)`. |
| **Step 6** | `src/features/venues/presentation/MyBookingsModal.tsx` | 1. Add "Get Directions" button in card header/actions using `IconDirections` and `openMapDirections`.<br>2. Format Time Slot with duration indicator (`formatSlotWindowWithDuration`). |
| **Step 7** | `tests/e2e/tier1_features/venueUiComponents.test.ts` | Add unit test cases for: 1. `formatCourtLabel` with `turf` sport types -> "Box N". 2. `formatDurationLabel` with 30m, 60m, 90m, 150m (2.5 hrs). 3. `formatSlotWindowWithDuration`. |
| **Step 8** | Verification | Run `npm run typecheck`, run unit tests, and verify APK build. |

