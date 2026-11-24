# Frontend Slot Architecture & Granular 30-Minute Duration Analysis (R1)

**Date**: 2026-09-07T08:41:00Z  
**Author**: Explorer 2 (Frontend Slot Explorer)  
**Target Milestone**: R1: 30-Minute Granular Time Slots (Playo Style) & Exact Duration Spanning  
**Workspace**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`  

---

## 1. Executive Summary

This investigation explores the frontend slot architecture for the MatchUp venue booking system to support **30-minute granular time slots (Playo style)** and **multi-hour continuous duration spanning (e.g. 2.5 hrs / 150 mins)**. 

### Key Findings
1. **Separation of Concerns**: 
   - `CourtSlotPickerSheet.tsx` acts as the coordinator holding the state for `selectedDate`, `selectedCourt`, `durationMinutes` (default 60 min), and `selectedSlot`. It renders `DateStrip`, `CourtPicker`, duration chips (`1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs`), and `TimeSlotGrid`.
   - `TimeSlotGrid.tsx` is a presentation component displaying candidate slots per court. It highlights which slots are selected in real time by calling `isSlotInSelectedRange(slot, selectedSlot, durationMinutes)`.
   - `BookingModal.tsx` is the final confirmation bottom sheet. It receives a synthesized `slot` object whose `endTime` is already calculated to cover the full requested duration span (`start_time + durationMinutes`).
2. **Exact Mathematical Spanning**:
   - In `slotUtils.ts`, `computeSlotRange` uses half-open interval intersection `sStart < endMs && sEnd > startMs` and verifies that all consecutive slots in `[startMs, startMs + durationMinutes)` are present, gapless, and free of any confirmed bookings.
   - For a `1:00 PM` start with `2.5 hrs` (150 minutes): exactly **5 consecutive 30-minute slots** (`1:00 PM – 1:30 PM`, `1:30 PM – 2:00 PM`, `2:00 PM – 2:30 PM`, `2:30 PM – 3:00 PM`, `3:00 PM – 3:30 PM`) are highlighted as **Selected**.
   - The boundary slot at `3:30 PM – 4:00 PM` evaluates to `slotStartMs < endMs` (`15:30 < 15:30`) which is **false**, so it is **not selected** and **remains strictly Available** in both the frontend and PostgreSQL database (`tstzrange` non-overlapping).
3. **Robust Concurrency Handling**:
   - If any intermediate slot within the 5-slot range is occupied, `computeSlotRange` sets `isValid: false`, causing `CourtSlotPickerSheet` to display an inline conflict alert and disable the "Book Slot" button.
   - If a race condition occurs at the database level, the partial GiST exclusion constraint raises `23P01` / `SLOT_ALREADY_TAKEN`, which `BookingModal` traps to display a dedicated "Slot Already Taken" recovery banner and automatically refetch `['venue-slots', venue.id]`.

---

## 2. Component Analysis: `TimeSlotGrid.tsx`

### 2.1 Props Interface
Located at `src/features/venues/presentation/TimeSlotGrid.tsx`:
```typescript
export interface TimeSlotGridProps {
  slots: VenueSlot[];
  selectedSlot: VenueSlot | null;
  onSelectSlot: (slot: VenueSlot) => void;
  durationMinutes?: number; // Defaults to 60
  isLoading?: boolean;
  columns?: 2 | 3; // Defaults to 2 (48.5% width)
  timezone?: string; // Defaults to 'Asia/Kolkata'
  emptyMessage?: string;
  style?: StyleProp<ViewStyle>;
}
```

### 2.2 Time of Day Period Filter (Playo Style)
`TimeSlotGrid` implements a 5-filter segmented chip row at lines 58–70 and 115–144:
- `all`: All 24 hours.
- `morning`: `hour >= 6 && hour < 12` (06:00 to 12:00).
- `afternoon`: `hour >= 12 && hour < 17` (12:00 to 17:00).
- `evening`: `hour >= 17 && hour < 21` (17:00 to 21:00).
- `night`: `hour >= 21 || hour < 6` (21:00 to 06:00 round-the-clock).

### 2.3 Slot Status Derivation & Selection Highlight
For each candidate slot in the active court:
```typescript
const status = getSlotStatus(slot);
const isSelectable = status === 'available';
const isSelected = isSlotInSelectedRange(slot, selectedSlot, durationMinutes);
const formattedWindow =
  formatSlotWindow(slot.startTime, slot.endTime, timezone) ||
  `${slot.timeHhmm} – ${slot.endTimeHhmm}`;
```

The badge text and styling dynamically adapt:
- **Selected** (when `isSelected` is true): Badge text `"Selected"`, solid green background (`M.green`), dark ink text (`M.limeInk`), card border 2px green (`M.cardHi`).
- **Available**: Badge text `"Available"`, transparent background with green border, white/primary text. Selectable via press.
- **Occupied / Booked**: Badge text `"Occupied"`, red border (`M.danger`), card opacity 0.5, strike-through text, disabled from interaction (`disabled={!isSelectable}`).
- **Booked by You**: Badge text `"Booked by You"`, red border, disabled.
- **Past**: Badge text `"Past"`, card opacity 0.35, disabled.

---

## 3. Duration Selection & Confirmation Modal Flow

### 3.1 Architecture: `CourtSlotPickerSheet` vs `BookingModal`
The duration selection does **not** reside inside `BookingModal.tsx`. Rather, it is hoisted to `CourtSlotPickerSheet.tsx` (the compound sheet):

```
┌────────────────────────────────────────────────────────────┐
│ CourtSlotPickerSheet                                       │
│                                                            │
│  1. DateStrip: Horizontal date picker (14 upcoming days)  │
│  2. CourtPicker: Court 1, Court 2, Box 1, etc.             │
│  3. Duration Selector Chips:                               │
│     [1 hr]  [1.5 hrs]  [2 hrs]  [2.5 hrs]  [3 hrs]         │
│  4. TimeSlotGrid:                                          │
│     Visualizes 30-min slots with multi-slot selection       │
│  5. Footer:                                                │
│     Court name, time window, price total, [Book Slot CTA]   │
└──────────────────────────┬─────────────────────────────────┘
                           │ (user taps "Book Slot")
                           ▼
┌────────────────────────────────────────────────────────────┐
│ BookingModal                                               │
│                                                            │
│  - Receives pre-computed modalSlot with expanded endTime   │
│  - Displays exact time window: 1:00 PM – 3:30 PM (2.5 hrs) │
│  - Displays venue address, court/box label, price indicator│
│  - Optional Match Linking picker                           │
│  - Optional Notes input                                    │
│  - [Confirm Booking CTA] -> bookSlot.mutate(...)           │
│  - Concurrency conflict handling ("Slot already taken")    │
└────────────────────────────────────────────────────────────┘
```

### 3.2 Duration Options
Defined in `CourtSlotPickerSheet.tsx` (lines 65–71):
```typescript
const DURATION_OPTIONS = [
  { minutes: 60, label: '1 hr' },
  { minutes: 90, label: '1.5 hrs' },
  { minutes: 120, label: '2 hrs' },
  { minutes: 150, label: '2.5 hrs' },
  { minutes: 180, label: '3 hrs' },
];
```
State: `const [durationMinutes, setDurationMinutes] = useState<number>(60);`  
Tapping any chip immediately triggers re-computation of `rangeCalc` and re-renders the selected highlight across the grid.

### 3.3 Modal Handover Logic
In `CourtSlotPickerSheet.tsx` (lines 160–169):
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
When `BookingModal` renders, its internal duration calculation derives:
```typescript
const durationMin = useMemo(() => {
  const s = new Date(slot.startTime).getTime();
  const e = new Date(slot.endTime).getTime();
  if (isNaN(s) || isNaN(e) || e <= s) return 60;
  return Math.round((e - s) / (60 * 1000));
}, [slot.startTime, slot.endTime]);

const durationHours = durationMin / 60; // 150 / 60 = 2.5
const durationLabel = durationHours === 1 ? '1 hr' : `${durationHours} hrs`; // "2.5 hrs"
```

---

## 4. Slot Math & Domain Utilities (`slotUtils.ts`)

`src/features/venues/domain/slotUtils.ts` provides all core mathematical and formatting utilities:

| Function | Signature | Purpose & Behavior |
|---|---|---|
| `computeSlotRange` | `(startSlot: VenueSlot, durationMinutes: number, allCourtSlots: VenueSlot[], timezone?: string): SlotRangeCalculation` | Calculates the multi-slot window: computes `endMs = startMs + durationMinutes * 60 * 1000`, finds all overlapping slots in `[startMs, endMs)`, verifies zero conflicts (`conflictSlot === null`), and asserts gapless continuous coverage (`firstStart <= startMs && lastEnd >= endMs`). |
| `isSlotInSelectedRange` | `(slot: VenueSlot, startSlot: VenueSlot \| null, durationMinutes: number): boolean` | Checks if a given slot falls within `[startMs, startMs + durationMinutes)` on the same court. Evaluates `slotStartMs < endMs && slotEndMs > startMs`. |
| `getSlotStatus` | `(slot: VenueSlot): SlotState` | Returns `'my_booking'`, `'booked'`, `'past'`, or `'available'`. Crucially, only marks a slot `'booked'` if `slot.bookingId !== null`. |
| `formatCourtLabel` | `(courtNumber: number, sportTypes?: string[]): string` | Returns `"Box ${courtNumber}"` for cricket/turf, `"Court ${courtNumber}"` for badminton/tennis/other. |
| `formatSlotWindow` | `(startTimeIso: string, endTimeIso: string, timezone?: string): string` | Formats ISO strings into `"01:00 PM – 03:30 PM"`. |
| `formatDateIso` | `(date: Date, timezone?: string): string` | Produces timezone-safe `"YYYY-MM-DD"`. |
| `getUpcomingDates` | `(daysCount = 14): UpcomingDateItem[]` | Generates 14 continuous upcoming days starting from Today. |
| `groupSlotsByCourt` | `(slots: VenueSlot[]): Record<number, VenueSlot[]>` | Partitions candidate slot list by court number. |

---

## 5. Data Access & Mutation Pipeline

### 5.1 Querying Slots (`useVenueBookings.ts` & `venueBookingRepository.ts`)
- `useVenueSlots(venueId, date, timezone)` wraps TanStack React Query with key `['venue-slots', venueId, date]`.
- Calls `venueBookingRepository.getSlots(venueId, date, timezone)`.
- Invokes Supabase RPC `public.get_venue_slots`:
  ```sql
  select
    g.court_number,
    g.court_label,
    g.start_time,
    g.end_time,
    g.time_hhmm,
    g.end_time_hhmm,
    coalesce(b.id is null and g.end_time > now(), false) as is_available,
    b.id as booking_id,
    coalesce(b.user_id = (select auth.uid()), false) as is_my_booking
  from grid g
  left join public.venue_bookings b
    on b.venue_id = in_venue_id
   and b.court_number = g.court_number
   and b.status = 'confirmed'
   and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(g.start_time, g.end_time, '[)')
  order by g.court_number asc, g.start_time asc;
  ```

### 5.2 Booking a Slot
- `useBookSlot()` provides mutation for `venueBookingRepository.bookSlot(input)`.
- Validates via Zod `BookSlotInputSchema`.
- Calls Supabase RPC `public.book_venue_slot`:
  - Enforces `v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer`.
  - Ensures `v_dur_min > 0 and v_dur_min % 30 = 0`.
  - Inserts into `public.venue_bookings` with partial GiST exclusion constraint:
    `EXCLUDE USING gist (venue_id WITH =, court_number WITH =, tstzrange(start_time, end_time, '[)') WITH &&) WHERE (status = 'confirmed')`.
  - On exclusion violation: catches exception and re-throws `SLOT_ALREADY_TAKEN` with code `23P01`.
  - `bookingErrorToAppError` maps `23P01` or `SLOT_ALREADY_TAKEN` to `new AppError('conflict', 'Slot already taken')`.

---

## 6. End-to-End Walkthrough: 1:00 PM Slot with 2.5 Hr (150 min) Duration

Below is the step-by-step trace when a user selects a 30-minute slot starting at **1:00 PM** and selects **2.5 hrs** duration:

```
Timeline (Asia/Kolkata):
13:00      13:30      14:00      14:30      15:00      15:30      16:00
  |--Slot 1--|--Slot 2--|--Slot 3--|--Slot 4--|--Slot 5--|--Slot 6--|
  |================= BOOKING RANGE =================|  Available
  |<------------------- 150 mins ------------------>|
```

### Step 1: User Action in UI
- The user taps the `1:00 PM – 1:30 PM` slot (`start_time = 2026-09-07T13:00:00+05:30`, `end_time = 2026-09-07T13:30:00+05:30`).
- The user selects the `2.5 hrs` chip (`durationMinutes = 150`).

### Step 2: Continuous Slot Window Evaluation (`computeSlotRange`)
- `startMs` = 13:00 (timestamp).
- `endMs` = `startMs + 150 * 60 * 1000` = 15:30 (3:30 PM).
- `coveredSlots` = all court slots intersecting `[13:00, 15:30)`:
  1. `13:00 – 13:30` (Slot 1)
  2. `13:30 – 14:00` (Slot 2)
  3. `14:00 – 14:30` (Slot 3)
  4. `14:30 – 15:00` (Slot 4)
  5. `15:00 – 15:30` (Slot 5)
- Does Slot 6 (`15:30 – 16:00`) get covered?
  Condition: `sStart < endMs && sEnd > startMs`.
  For Slot 6: `sStart = 15:30`. `15:30 < 15:30` evaluates to **FALSE**.
  Slot 6 is **not** covered.
- Continuity check:
  `firstStart (13:00) <= startMs (13:00)` AND `lastEnd (15:30) >= endMs (15:30)` -> **TRUE**.
- Conflict check:
  Iterates through Slots 1..5. If none have `bookingId !== null`, `conflictSlot = null`.
- Output: `isValid = true`, `endTime = '2026-09-07T15:30:00+05:30'`, `endTimeHhmm = '15:30'`.

### Step 3: Selection Highlight in `TimeSlotGrid`
For every rendered slot on the active court, `isSlotInSelectedRange(slot, selectedSlot, 150)` is executed:
- Slots 1 through 5 evaluate to `true` -> rendered with `Selected` green pill badge and highlighted border.
- Slot 6 (`3:30 PM – 4:00 PM`) evaluates to `false` -> rendered with standard `Available` badge.
- **Exactly 5 slots** are visually selected in the UI.

### Step 4: Submission to Backend
- User taps "Book Slot · ₹X".
- `CourtSlotPickerSheet` opens `BookingModal` with `modalSlot.startTime = '2026-09-07T13:00:00+05:30'` and `modalSlot.endTime = '2026-09-07T15:30:00+05:30'`.
- User taps "Confirm Booking".
- Payload sent to Supabase RPC `book_venue_slot`:
  ```json
  {
    "in_venue_id": "<venue-uuid>",
    "in_court_number": 1,
    "in_start_time": "2026-09-07T13:00:00+05:30",
    "in_end_time": "2026-09-07T15:30:00+05:30",
    "in_match_id": null,
    "in_notes": null
  }
  ```
- Backend validates:
  - `v_dur_min` = 150 minutes.
  - `150 % 30 == 0` -> Valid!
  - Inserts 1 record into `venue_bookings`: `start_time = 13:00`, `end_time = 15:30`.

### Step 5: Post-Booking Availability of 3:30 PM – 4:00 PM Slot
- React Query invalidates `['venue-slots', venueId]`.
- Supabase re-executes `get_venue_slots`:
  ```sql
  tstzrange('2026-09-07 13:00:00+05:30', '2026-09-07 15:30:00+05:30', '[)')
  &&
  tstzrange('2026-09-07 15:30:00+05:30', '2026-09-07 16:00:00+05:30', '[)')
  ```
- In PostgreSQL half-open range algebra: `[13:00, 15:30)` and `[15:30, 16:00)` do **not** intersect (intersection is empty set $\emptyset$).
- Result for `3:30 PM – 4:00 PM`:
  - `booking_id`: `NULL`
  - `is_available`: `TRUE`
- In the frontend UI:
  - `getSlotStatus` returns `'available'`.
  - The `3:30 PM – 4:00 PM` slot **remains completely Available and selectable** for other players.

---

## 7. Verification Matrix & Evidence

| Verification Item | Specification / Requirement | Observed Code / Implementation | Status |
|---|---|---|---|
| **Duration Chips** | `1 hr`, `1.5 hrs`, `2 hrs`, `2.5 hrs`, `3 hrs` | `CourtSlotPickerSheet.tsx:65-71` (`DURATION_OPTIONS`) | VERIFIED |
| **30-Min Granular Spanning** | 2.5 hrs (150 mins) spans exactly 5 30-min slots | `computeSlotRange` in `slotUtils.ts:162-229` | VERIFIED |
| **Boundary Non-Overlapping** | 3:30 PM – 4:00 PM not selected & remains Available | Half-open boundary `slotStartMs < endMs` (`15:30 < 15:30` is false); Postgres `[)` non-overlap | VERIFIED |
| **Consecutive Verification** | All covered slots must be unbooked without gaps | `conflictSlot === null && isFullSpanCovered` in `slotUtils.ts:220` | VERIFIED |
| **Double-Booking Recovery** | Atomic exclusion + "Slot already taken" error mapping | `23P01` mapped in `venueBookingRepository.ts:43-50` and caught in `BookingModal.tsx:165-179` | VERIFIED |
| **Automatic Deselection on Conflict** | Selected slot cleared if refetched slot becomes occupied | `useEffect` in `CourtSlotPickerSheet.tsx:125-134` | VERIFIED |

---

## 8. Summary for Implementers

1. **Frontend readiness**: The frontend logic in `CourtSlotPickerSheet.tsx`, `TimeSlotGrid.tsx`, `BookingModal.tsx`, and `slotUtils.ts` is fully prepared to handle 30-minute slots and multi-hour continuous durations without any architectural bottlenecks.
2. **Database configuration**: Ensure that database migration sets `default 30` for `slot_duration_minutes` in `public.venues` and that venues have `slot_duration_minutes = 30` configured so that `get_venue_slots` generates 48 30-minute intervals per 24-hour day per court.
3. **TypeScript & Tests**: All unit tests in `tests/e2e/tier1_features/venueUiComponents.test.ts` validate continuous slot ranges, conflict detection, and slot status contracts.
