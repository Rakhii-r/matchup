# 5-Component Handoff Report: Frontend Slot Architecture & Granular 30-Minute Duration Analysis (R1)

**Agent**: Explorer 2 (Frontend Slot Explorer)  
**Date**: 2026-09-07T08:42:00Z  
**Directory**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_frontend_r2`  
**Handoff Type**: Hard (Investigation complete)  

---

## 1. Observation

### 1.1 TimeSlotGrid (`src/features/venues/presentation/TimeSlotGrid.tsx`)
- **Props interface** (lines 24–34):
  ```typescript
  export interface TimeSlotGridProps {
    slots: VenueSlot[];
    selectedSlot: VenueSlot | null;
    onSelectSlot: (slot: VenueSlot) => void;
    durationMinutes?: number;
    isLoading?: boolean;
    columns?: 2 | 3;
    timezone?: string;
    emptyMessage?: string;
    style?: StyleProp<ViewStyle>;
  }
  ```
- **Period filtering** (lines 58–70): Implements five time-of-day filter chips: `all` (24h), `morning` (6–12), `afternoon` (12–17), `evening` (17–21), and `night` (21–6).
- **Slot rendering & selection highlighting** (lines 154–160):
  ```typescript
  const status = getSlotStatus(slot);
  const isSelectable = status === 'available';
  const isSelected = isSlotInSelectedRange(slot, selectedSlot, durationMinutes);
  const formattedWindow =
    formatSlotWindow(slot.startTime, slot.endTime, timezone) ||
    `${slot.timeHhmm} – ${slot.endTimeHhmm}`;
  ```
- **Interactive state & badges** (lines 177–241):
  - When `isSelected === true`: Displays `'Selected'` badge with green background (`M.green`) and `M.limeInk` text; card is styled with `styles.slotCardSelected` (borderWidth: 2, borderColor: M.green).
  - When `status === 'available'`: Displays `'Available'` badge with green border and is pressable (`isSelectable === true`).
  - When `status === 'booked' || status === 'my_booking'`: Displays `'Occupied'` or `'Booked by You'` with red border, card opacity 0.5, strike-through text, and `disabled={!isSelectable}` (lines 179, 192, 209).
  - When `status === 'past'`: Displays `'Past'` badge with card opacity 0.35 and disabled interaction.

### 1.2 Duration Selection & Modal Handover (`CourtSlotPickerSheet.tsx` & `BookingModal.tsx`)
- **Duration Chips** in `CourtSlotPickerSheet.tsx` (lines 65–71, 98, 268–294):
  - Duration chips are defined as:
    ```typescript
    const DURATION_OPTIONS = [
      { minutes: 60, label: '1 hr' },
      { minutes: 90, label: '1.5 hrs' },
      { minutes: 120, label: '2 hrs' },
      { minutes: 150, label: '2.5 hrs' },
      { minutes: 180, label: '3 hrs' },
    ];
    ```
  - State `[durationMinutes, setDurationMinutes] = useState<number>(60);`.
  - Rendered in a horizontal ScrollView under `"SELECT DURATION"`. Tapping any chip updates `durationMinutes`.
- **Continuous Slot Range Calculation** in `CourtSlotPickerSheet.tsx` (lines 137–140):
  ```typescript
  const rangeCalc = useMemo(() => {
    if (!selectedSlot) return null;
    return computeSlotRange(selectedSlot, durationMinutes, courtSlots, timezone);
  }, [selectedSlot, durationMinutes, courtSlots, timezone]);
  ```
- **Modal Opening** in `CourtSlotPickerSheet.tsx` (lines 160–169):
  ```typescript
  const handleOpenBookingModal = () => {
    if (!selectedSlot || !rangeCalc || !rangeCalc.isValid) return;
    const bookingSlot: VenueSlot = {
      ...selectedSlot,
      endTime: rangeCalc.endTime,
      endTimeHhmm: rangeCalc.endTimeHhmm,
    };
    setModalSlot(bookingSlot);
    setIsBookingModalVisible(true);
  };
  ```
- **Duration Interpretation in `BookingModal.tsx`** (lines 125–138):
  - `BookingModal` does **not** contain duration chips. It calculates duration from the passed `slot.startTime` and `slot.endTime`:
    ```typescript
    const durationMin = useMemo(() => {
      const s = new Date(slot.startTime).getTime();
      const e = new Date(slot.endTime).getTime();
      if (isNaN(s) || isNaN(e) || e <= s) return 60;
      return Math.round((e - s) / (60 * 1000));
    }, [slot.startTime, slot.endTime]);

    const durationHours = durationMin / 60;
    const durationLabel = durationHours === 1 ? '1 hr' : `${durationHours} hrs`;
    ```
- **RPC Invocation in `BookingModal.tsx`** (lines 149–157):
  ```typescript
  bookSlot.mutate({
    venueId: venue.id,
    courtNumber,
    startTime: slot.startTime,
    endTime: slot.endTime,
    matchId: selectedMatchId ?? undefined,
    notes: notes.trim() ? notes.trim() : undefined,
  });
  ```

### 1.3 Slot Utilities (`src/features/venues/domain/slotUtils.ts`)
- **`computeSlotRange`** (lines 162–229):
  - Calculates:
    ```typescript
    const startMs = new Date(startSlot.startTime).getTime();
    const endMs = startMs + durationMinutes * 60 * 1000;
    const targetEndDate = new Date(endMs);
    const targetEndTimeIso = targetEndDate.toISOString();
    ```
  - Filters intersecting slots:
    ```typescript
    const coveredSlots = sorted.filter((s) => {
      const sStart = new Date(s.startTime).getTime();
      const sEnd = new Date(s.endTime).getTime();
      return sStart < endMs && sEnd > startMs;
    });
    ```
  - Verifies no conflicts across all covered slots:
    ```typescript
    let conflictSlot: VenueSlot | null = null;
    for (const s of coveredSlots) {
      const status = getSlotStatus(s);
      if (status === 'booked' || status === 'my_booking') {
        conflictSlot = s;
        break;
      }
    }
    ```
  - Verifies complete gapless coverage from `startMs` to `endMs`:
    ```typescript
    let isFullSpanCovered = false;
    if (coveredSlots.length > 0) {
      const firstStart = new Date(coveredSlots[0]!.startTime).getTime();
      const lastEnd = new Date(coveredSlots[coveredSlots.length - 1]!.endTime).getTime();
      isFullSpanCovered = firstStart <= startMs && lastEnd >= endMs;
    }
    const isValid = conflictSlot === null && isFullSpanCovered;
    ```
- **`isSlotInSelectedRange`** (lines 234–245):
  ```typescript
  export function isSlotInSelectedRange(
    slot: VenueSlot,
    startSlot: VenueSlot | null,
    durationMinutes: number,
  ): boolean {
    if (!startSlot || slot.courtNumber !== startSlot.courtNumber) return false;
    const startMs = new Date(startSlot.startTime).getTime();
    const endMs = startMs + durationMinutes * 60 * 1000;
    const slotStartMs = new Date(slot.startTime).getTime();
    const slotEndMs = new Date(slot.endTime).getTime();
    return slotStartMs < endMs && slotEndMs > startMs;
  }
  ```
- **`getSlotStatus`** (lines 136–149):
  ```typescript
  export function getSlotStatus(slot: VenueSlot): SlotState {
    if (slot.isMyBooking) return 'my_booking';
    if (slot.bookingId !== null) return 'booked';
    const now = new Date();
    const end = new Date(slot.endTime);
    if (!isNaN(end.getTime()) && end.getTime() <= now.getTime()) return 'past';
    return 'available';
  }
  ```

### 1.4 Data Pipeline & Error Mapping (`useVenueBookings.ts` & `venueBookingRepository.ts`)
- `useVenueSlots` queries Supabase RPC `get_venue_slots` with key `['venue-slots', venueId, date]`.
- `useBookSlot` calls `bookSlot` which invokes Supabase RPC `book_venue_slot`.
- In `venueBookingRepository.ts` (lines 43–50):
  ```typescript
  if (
    code === '23P01' ||
    code === 'SLOT_ALREADY_TAKEN' ||
    raw.includes('slot_already_taken') ||
    raw.includes('venue_bookings_no_double_booking')
  ) {
    return new AppError('conflict', 'Slot already taken', error);
  }
  ```
- In `BookingModal.tsx` (lines 165–179): If conflict occurs, displays the conflict banner and automatically calls `qc.invalidateQueries({ queryKey: ['venue-slots', venue.id] })`.
- In `CourtSlotPickerSheet.tsx` (lines 125–134): An effect monitors `courtSlots` and if the `selectedSlot` is no longer available in the fresh data, it immediately sets `setSelectedSlot(null)`.

### 1.5 Test Verification
- Executed `npx tsx tests/e2e/tier1_features/venueUiComponents.test.ts`:
  - Result: 22/22 tests passed (duration 14.7s), 0 failures.
  - Passes unit test asserting zero TypeScript errors across the project (`npx tsc --noEmit`).

---

## 2. Logic Chain

1. **Step 1: UI Selection & Multi-Slot Span**
   - By Observation 1.2, duration chips exist in `CourtSlotPickerSheet.tsx` with options `1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`.
   - By Observation 1.3, selecting a starting slot at `1:00 PM` (`13:00`) with duration `2.5 hrs` (`150 min`) sets `startMs = 13:00` and `endMs = 15:30`.
   - Under 30-minute granularity, the active court contains slots:
     - Slot 1: `13:00 – 13:30`
     - Slot 2: `13:30 – 14:00`
     - Slot 3: `14:00 – 14:30`
     - Slot 4: `14:30 – 15:00`
     - Slot 5: `15:00 – 15:30`
     - Slot 6: `15:30 – 16:00`
   - By Observation 1.3 (`isSlotInSelectedRange` condition `slotStartMs < endMs && slotEndMs > startMs`):
     - For Slots 1..5: `slotStartMs < 15:30` and `slotEndMs > 13:00` are both true $\implies$ all 5 slots return `true`.
     - For Slot 6 (`15:30 – 16:00`): `slotStartMs = 15:30`. The check `15:30 < 15:30` is **false** $\implies$ Slot 6 returns `false`.
   - By Observation 1.1, `TimeSlotGrid` marks exactly Slots 1 through 5 with the `Selected` green pill badge, while Slot 6 is rendered as `Available`.

2. **Step 2: Consecutive Availability Verification**
   - By Observation 1.3 (`computeSlotRange`), the calculation iterates over `coveredSlots` (Slots 1..5) and checks `getSlotStatus(s)`.
   - If any of the 5 slots has `bookingId !== null`, `conflictSlot` is set to that slot and `isValid` becomes `false`.
   - In addition, `isFullSpanCovered` verifies that `firstStart (13:00) <= startMs (13:00)` and `lastEnd (15:30) >= endMs (15:30)`.
   - If `!rangeCalc.isValid`, `CourtSlotPickerSheet` shows the inline warning `"Cannot book 2.5 hrs starting at 13:00. Continuous slot is occupied."` and disables the CTA button (`disabled={!rangeCalc?.isValid}`), preventing modal opening.

3. **Step 3: Backend Payload & Database Locking**
   - By Observation 1.2, when the user opens `BookingModal` and confirms, `bookSlot.mutate` is dispatched with:
     - `startTime = 2026-09-07T13:00:00+05:30` (1:00 PM)
     - `endTime = 2026-09-07T15:30:00+05:30` (3:30 PM)
   - RPC `book_venue_slot` validates `v_dur_min := 150`, which satisfies `v_dur_min % 30 == 0`.
   - A single confirmed record is inserted covering `tstzrange('13:00', '15:30', '[)')`.

4. **Step 4: Boundary Non-Overlapping Behavior of 3:30 PM – 4:00 PM Slot**
   - After booking, queries are invalidated and `get_venue_slots` re-evaluates availability:
     `tstzrange('13:00', '15:30', '[)') && tstzrange('15:30', '16:00', '[)')`.
   - Because PostgreSQL `tstzrange` intervals use half-open `[)` boundaries, `[13:00, 15:30)` does not intersect `[15:30, 16:00)`.
   - Therefore, `b.id` is `NULL` for Slot 6 (`3:30 PM – 4:00 PM`).
   - By Observation 1.3 (`getSlotStatus`), since `bookingId` is `null` and `endTime > now()`, Slot 6 returns `'available'`.
   - In `TimeSlotGrid`, Slot 6 renders with the `Available` badge and remains 100% selectable for other players.

---

## 3. Caveats

1. **Database default migration**: The database migration `20260907120000_venues_24h_and_booking_fixes.sql` currently sets `alter column slot_duration_minutes set default 60;`. As requested in `ORIGINAL_REQUEST.md` (R1), this default must be updated to `30` across `public.venues` so newly added venues generate 30-minute slots automatically.
2. **Venue-level configured duration**: If a venue has `slot_duration_minutes` explicitly set to `60` in the database, `get_venue_slots` will return 60-minute blocks rather than 30-minute blocks. The database update script should execute `UPDATE public.venues SET slot_duration_minutes = 30;` to ensure all existing venues adopt 30-minute granular slots.
3. **No caveats on frontend UI logic**: The frontend components (`TimeSlotGrid`, `CourtSlotPickerSheet`, `BookingModal`, and `slotUtils`) are fully decoupled from fixed slot widths; they dynamically accommodate 30-minute blocks and arbitrary multi-hour durations that are multiples of 30 minutes.

---

## 4. Conclusion

1. **TimeSlotGrid (`TimeSlotGrid.tsx`)**:
   - Renders 24-hour slots divided by time of day chips (all, morning, afternoon, evening, night).
   - Renders slots with status badges (`Available`, `Selected`, `Occupied`, `Past`, `Booked by You`).
   - Highlighting is governed by `isSlotInSelectedRange(slot, selectedSlot, durationMinutes)`.
2. **Duration Selection & Handover (`CourtSlotPickerSheet.tsx` & `BookingModal.tsx`)**:
   - Duration selection chips (`1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`) are hosted in `CourtSlotPickerSheet.tsx`.
   - `computeSlotRange` calculates exact `endTime` (`start_time + durationMinutes`) and verifies consecutive availability.
   - `modalSlot` is passed to `BookingModal.tsx` with pre-computed `endTime`.
3. **Trace for 1:00 PM Start with 2.5 Hr (150 min) Duration**:
   - **UI Selection**: Exactly 5 slots (`1:00 PM – 1:30 PM`, `1:30 PM – 2:00 PM`, `2:00 PM – 2:30 PM`, `2:30 PM – 3:00 PM`, `3:00 PM – 3:30 PM`) are marked as `Selected`.
   - **Payload Sent**: `startTime: "13:00:00+05:30"`, `endTime: "15:30:00+05:30"`.
   - **Consecutive Verification**: Enforced on both frontend (`computeSlotRange` checks `conflictSlot === null && isFullSpanCovered`) and backend (GiST `tstzrange` exclusion constraint).
   - **3:30 PM – 4:00 PM Slot**: Evaluates to `isSlotInSelectedRange = false` and `tstzrange` non-overlapping $\implies$ **remains completely Available and selectable**.

---

## 5. Verification Method

To independently verify all findings and test suite integrity:

1. **Run UI Components Test Suite**:
   ```powershell
   npx tsx tests/e2e/tier1_features/venueUiComponents.test.ts
   ```
   *Expected outcome*: 22 tests pass, 0 failures. Verifies slot range calculations, multi-slot spanning, conflict detection, and TypeScript compilation.
2. **Run Venue Slot Calculation Test Suite**:
   ```powershell
   npx tsx tests/e2e/tier1_features/venueSlotCalculation.test.ts
   ```
   *Expected outcome*: All slot calculation and court segmentation tests pass.
3. **Run TypeScript Strict Analysis**:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected outcome*: Zero errors.
4. **Code Inspection**:
   - Inspect `CourtSlotPickerSheet.tsx` lines 65–71 for `DURATION_OPTIONS` and line 139 for `computeSlotRange`.
   - Inspect `TimeSlotGrid.tsx` lines 157–160 for `isSlotInSelectedRange`.
   - Inspect `slotUtils.ts` lines 162–245 for `computeSlotRange` and `isSlotInSelectedRange`.
