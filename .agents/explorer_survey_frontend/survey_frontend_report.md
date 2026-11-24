# Frontend Architecture & Survey Report: Venue Time Slot Booking, Court/Box Selection & Match Linking

**Author:** `survey_frontend_explorer`  
**Date:** 2026-09-04  
**Project:** MatchUp (sixfour24)  
**Target Codebase:** `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`  

---

## Executive Summary

This report delivers an in-depth investigation of the frontend architecture, screens, components, user flows, and state management in MatchUp to support the implementation of **Venue Time Slot Booking**, **Manual Court/Box Selection**, **Dynamic Slot Availability**, **Strict Double-Booking UI Handling**, and **Match Linking & Cancellation**.

Currently, the Venues tab (`app/(tabs)/venues.tsx`) operates purely as a static, offline directory where users can only view venue details, tap a phone number link to "Call to confirm", or open Google Maps directions. On the match side (`app/match/[id]/venue.tsx`), match creators can only tag a venue name to a match row via the `set_match_venue` RPC—no courts, dates, time slots, or bookings are selectable. To fulfill requirements R1–R4, an interactive booking system must be built comprising interactive date selection, court/box chips, a time slot availability grid (Available vs Occupied), booking confirmation and conflict modal/toasts, user booking management with cancellation, and match-booking linking.

---

## 1. Frontend Framework & Technology Stack

| Layer | Technology | Version / Specification | Location / Usage |
|---|---|---|---|
| **Mobile Runtime** | React Native | `0.85.3` | Core mobile runtime |
| **Framework** | Expo SDK | `~56.0.13` (Prebuild/Dev client enabled) | Managed Expo environment (`app.json`, `app.config.ts`) |
| **UI Library** | React | `19.2.3` | React functional components & hooks |
| **Navigation** | `expo-router` | `~56.2.12` | File-based navigation in `app/` directory |
| **State Management** | Zustand | `^5.0.1` | Client stores: `useAuthStore`, `useCreateMatchWizard` |
| **Data Fetching / Cache** | TanStack React Query | `^5.59.0` | Server state queries & mutations with query invalidation |
| **Animation** | React Native Reanimated & Moti | `4.3.1` / `^0.30.0` | Smooth scale pressables, skeletons, animated chips |
| **Icons** | Custom SVG (`react-native-svg`) | `15.15.4` | `src/shared/ui/icons.tsx` (`IconPin`, `IconCalendar`, `IconClock`, etc.) |
| **Validation** | Zod | `^3.23.8` | Form schema validation (`venueSchema.ts`, `matchSchema.ts`) |
| **Theme System** | Custom Design Tokens | Single source of truth | `src/shared/theme/index.ts` & `src/shared/theme/mockTheme.ts` |
| **Type Checking** | TypeScript | `~6.0.3` | Strict type checking (`npm run typecheck` / `tsc --noEmit`) |

### Design System & Theme Conventions
- **Colors:** Defined in `src/shared/theme/index.ts` and `src/shared/theme/mockTheme.ts`.
  - Brand Primary / Accent: Chartreuse `#98BB01` (`M.green` / `lightColors.primary`).
  - Dark Theme Backgrounds: `M.bg` (`#0B0B0C`), Card: `M.card` (`#141416`), Card High: `M.cardHi` (`#1C1C1F`).
  - Text & Accents: `M.text` (`#FFFFFF`), `M.muted` (`#8E8E93`), `M.faint` (`#48484A`), `M.danger` (`#FF453A`), `M.border` (`#262629`).
- **Spacing & Radius:** Standardized in `R` (radius: `sm=8`, `md=12`, `lg=20`, `pill=999`) and `S` (spacing: `xs=4`, `sm=8`, `md=16`, `lg=24`, `xl=32`).
- **Accessibility & Touch Targets:** Minimum 44-48pt touch targets (`TOUCH = 44`).

---

## 2. Existing Screen Audit & User Flow Analysis

### 2.1 Venues Tab (`app/(tabs)/venues.tsx`)
- **Current State:**
  - Route: First-class tab on bottom bar (`TabsLayout` in `app/(tabs)/_layout.tsx:57-62`).
  - Component: `VenuesScreen()` (`app/(tabs)/venues.tsx:41-245`).
  - Fetches venues via `useVenues()` (`src/features/venues/presentation/useVenues.ts:13-15`).
  - Offers text search (name, address, sport) and sport filtering (`SPORT_FILTERS`: All, Cricket, Badminton).
  - Renders venue cards (`lines 186-240`):
    - Background image with gradient overlay (`venueImage(v)`).
    - Venue name, address with `IconPin`, sport badges.
    - Confirmation notice: `v.confirm_note ?? 'Call to confirm availability'`.
    - Action buttons (`lines 224-237`):
      - `bookBtn`: Triggers `callVenue(v.phone)` (`tel:${phone}`) with label `'Call to confirm'`.
      - `dirBtn`: Triggers `openDirections(v)` (Google Maps web link).
- **Gap Analysis:**
  - **No Date Selection:** Users cannot select a target date.
  - **No Court/Box Selection:** No UI to select or view Court 1, Court 2, etc.
  - **No Time Slot Grid:** No calendar or slot grid showing hourly availability.
  - **No In-App Booking:** Users cannot book slots or see pricing/confirmation sheets.
  - **No Booking Management:** No place to view active confirmed bookings or cancel them.

### 2.2 Ground Selection for Matches (`app/match/[id]/venue.tsx`)
- **Current State:**
  - Route: `/match/[id]/venue` (opened when match creator taps "Select ground" or "Change ground" in match details).
  - Component: `MatchVenueScreen()` (`app/match/[id]/venue.tsx:43-226`).
  - Restricted to match creator: `data.creator_id === myUserId` (`lines 61, 113-122`).
  - Queries nearby venues scoped to match coordinates and sport via `useNearbyVenues()` (`lines 65-77`).
  - Renders flat list of nearby venues with distance, rating, and hourly price.
  - Tapping a venue (`onPick`, `lines 79-88`):
    - Invokes `setVenue.mutate(venueId)` which calls Supabase RPC `set_match_venue(in_match_id, in_venue_id)`.
    - Only updates `matches.venue_id` and `matches.venue_text`.
    - Navigates back (`router.back()`).
- **Gap Analysis:**
  - **No Court / Box Picker:** Does not ask which court or box the match is booked on.
  - **No Time Slot Selection:** Does not query or lock a specific time slot on that venue.
  - **No Double-Booking Check:** Does not verify whether another match or user has booked the court at that match time.
  - **No Booking Record:** No row in a `bookings` table is created or linked.

### 2.3 Match Detail Screen (`app/match/[id]/index.tsx`)
- **Current State:**
  - Contains "📍 Venue & Ground" card (`lines 776-813`).
  - If no venue is tagged: displays "Action Required" badge and "Select ground" CTA (`lines 779-785, 806`).
  - If venue is tagged: displays venue name with disclaimer:
    `"sixfour24 has not reserved this turf — call the ground to confirm your slot."` (`lines 798-802`).
  - Organiser can tap "Change ground" to re-open `/match/[id]/venue`.
- **Gap Analysis:**
  - Needs to display confirmed Court / Box name (e.g. "Court 2") and confirmed booked time slot (e.g. "18:00 – 19:00 IST").
  - Needs to provide "View Booking" or "Cancel Booking" action for the organiser.

### 2.4 Match Creation Wizard (`app/match/create/`)
- Step 1 (`app/match/create/index.tsx`): Select Sport (`box_cricket` / `badminton`) & Match Type (`team_vs_team` / `post_match`).
- Step 2 (`app/match/create/area.tsx`): Select Area locality and search radius (1, 3, 5, 10, 25, 50 km).
- Step 3 (`app/match/create/details.tsx`):
  - Date offset selector (0 to 13 days from today via modal sheet, `lines 818-838`).
  - Play Window chips: Morning (6-10 AM), Afternoon (12-4 PM), Evening (5-9 PM), Night (9-11 PM) (`lines 604-633`).
  - Venue selection is explicitly deferred in the creation wizard to avoid forcing payments/bookings before opponents are found.

### 2.5 Admin Venue Management (`app/admin/venues.tsx`)
- Admin CRUD screen for venues.
- Form currently collects: `name`, `address`, `lat`, `lng`, `phone`, `sport_types`.
- Missing fields required by R1: `courts_count` (integer, default 1), `open_time` (e.g. 06:00), `close_time` (e.g. 23:00), `slot_minutes` (e.g. 60), `is_bookable` (boolean), `price_per_slot` (numeric).

---

## 3. UI Component Specifications Required (R1–R4)

To satisfy the user requirements, the following UI components must be designed and integrated into the frontend:

### 3.1 Interactive Date Selector (`DateStrip` / `DateSelector`)
- **Purpose:** Allow users to pick which date to view court availability for (today + next 7 to 14 days).
- **Design Pattern:**
  - Horizontal scrolling date strip with pill/card items.
  - Each item displays: Day of week (e.g. "Today", "Sat", "Sun"), Day number ("05", "06"), and Month.
  - Active state: Highlighted with `M.green` background, high contrast text.
  - Inactive state: `M.card` background, `M.muted` text.
  - Accessibility: `accessibilityRole="button"`, `accessibilityState={{ selected: isSelected }}`.

### 3.2 Court / Box Picker (`CourtPicker`)
- **Purpose:** When a venue has `courts_count > 1` (e.g. Box 1, Box 2 or Court 1, Court 2), allows users to toggle between courts to inspect availability for each specific court.
- **Design Pattern:**
  - Segmented chip row / tab bar placed above the time slot grid.
  - Label format: Dependent on sport: "Court 1", "Court 2" for badminton; "Box 1", "Box 2" for cricket.
  - State: Selecting a court immediately filters the slot grid to display that court's booked vs available slots.
  - Single-court optimization: If `courts_count === 1`, display an informational pill or collapse to single view.

### 3.3 Dynamic Time Slot Grid (`TimeSlotGrid`)
- **Purpose:** Display bookable time slots dynamically calculated from the venue's operating hours (`open_time` to `close_time`) and slot duration (`slot_minutes`).
- **Slot Display:**
  - 2 or 3 columns grid of time slot tiles.
  - Display format: "06:00 – 07:00", "07:00 – 08:00", etc. (or 12h format e.g. "6:00 PM – 7:00 PM").
- **Status Differentiation:**
  - **Available (Selectable):**
    - Border: `M.border` (idle), `M.green` (selected).
    - Background: `M.card` (idle), `M.cardHi` (hover/pressed), `M.green` with dark text (selected).
    - Shows slot price (e.g. "₹800") or "Available" badge.
    - Pressable interaction triggers selection.
  - **Booked / Occupied (Disabled):**
    - Background: `M.card` with opacity `0.4` or dimmed background.
    - Border: `M.border` with low contrast.
    - Label: "Occupied" / "Booked" pill in muted or faint tone.
    - `disabled={true}`, pointer events disabled. Cannot be tapped.
  - **Past Slots (for Today):**
    - Slots whose start time has already elapsed today are styled as disabled ("Passed").

### 3.4 Booking Confirmation Action & Modal (`BookingModal`)
- **Purpose:** Review details and confirm the booking.
- **Components:**
  - Bottom sheet or slide-up modal showing:
    - Venue name & address
    - Selected Date (formatted e.g. "Saturday, 5 September 2026")
    - Selected Court / Box (e.g. "Box 1")
    - Selected Time Slot (e.g. "07:00 PM – 08:00 PM")
    - Price info: Display ₹ amount (e.g. "₹1,200 per slot · Pay at venue")
    - Match Linking Selector (optional dropdown if user has active matches)
  - CTA Button: "Confirm Booking" (`Button` with `loading` spinner).
- **Double-Booking & Conflict Handling (R2):**
  - If the booking mutation encounters an error:
    - Conflict token check: If error message contains `SLOT_ALREADY_TAKEN`, `DOUBLE_BOOKING`, exclusion constraint violation (`23P01`), or schedule conflict:
      - Display prominent error toast / banner: **"Slot already taken"** ("Another player just booked this court and slot. Please pick another slot.").
      - Automatically trigger query refetch/invalidation for the slot grid so the freshly occupied slot immediately appears disabled.

### 3.5 Booking Management UI (`MyBookings` / Cancellation Flow)
- **Purpose:** Allow users to view their active confirmed bookings and cancel them to instantly free slots (R4).
- **Access Points:**
  - Header button / tab action on Venues tab: "My Bookings" with active badge count.
  - Quick access on Profile or Activity tab.
- **Booking Card Elements:**
  - Venue Name & Sport icon
  - Court / Box Number
  - Date & Time Slot Window
  - Status Badge: `Confirmed` (Green), `Cancelled` (Muted)
  - Linked Match reference (if linked) with quick navigation link
  - "Cancel Booking" button:
    - Pressing prompts an Alert: "Cancel Booking? Are you sure you want to cancel your slot at {venue_name}?"
    - On confirmation: calls `useCancelBooking` mutation.
    - On success: updates booking status to `cancelled`, shows success feedback, and invalidates slot queries so the slot is immediately released for others.

### 3.6 Match Linking UI (Linking Slot to Match)
- **Flow A: From Existing Match Screen (`app/match/[id]/venue.tsx`)**
  - When opened from a match, the screen header indicates: "Select & Book Ground for Match".
  - Date defaults to the match's `scheduled_at` date.
  - Organiser picks venue -> picks court -> picks matching time slot.
  - CTA: "Book & Link Ground".
  - Mutation calls booking RPC with `match_id: matchId`.
  - On success, updates `matches.venue_id` and navigates back to `/match/[id]`, which now renders the confirmed booking card.
- **Flow B: Direct from Venues Tab (`app/(tabs)/venues.tsx`)**
  - User can tap "Book Court" directly on any venue card.
  - Modal provides an optional checkbox / dropdown: "Link to an upcoming game" listing matches where `creator_id === user.id` and `status in ('open', 'locked')`.

---

## 4. Codebase Architecture & File Touchpoints

### 4.1 Existing Files to Extend

| File Path | Current Role | Necessary Modifications |
|---|---|---|
| `src/shared/types/database.types.ts` | Supabase TypeScript types | Add `bookings` table definition, updated `venues` columns (`courts_count`, `open_time`, `close_time`, `slot_minutes`, `is_bookable`, `price_per_slot`), and RPC definitions (`get_venue_slots`, `book_slot`, `cancel_booking`). |
| `src/features/venues/domain/venueSchema.ts` | Venue domain schemas | Add Zod schemas and types for `VenueSlot`, `CourtOption`, `Booking`, `CreateBookingInput`, `CancelBookingInput`. |
| `src/features/venues/data/venueRepository.ts` | Venue Supabase client calls | Add repository methods: `getSlots(venueId, date)`, `bookSlot(input)`, `cancelBooking(bookingId)`, `listMyBookings()`. |
| `src/features/venues/presentation/useVenues.ts` | TanStack Query hooks | Add `useVenueSlots(venueId, date)`, `useBookSlot()`, `useCancelBooking()`, `useMyBookings()`. |
| `app/(tabs)/venues.tsx` | Venues directory tab | Add "Book Slot" entry point on venue cards, date strip, court picker, slot grid, and booking modal / "My Bookings" sheet. |
| `app/match/[id]/venue.tsx` | Match ground picker | Upgrade from flat venue selector to full ground selection flow (Venue -> Court -> Time Slot -> Link & Book). |
| `app/match/[id]/index.tsx` | Match details screen | Update "📍 Venue & Ground" card to display confirmed booked court and time slot, and show "Cancel Booking" / "Change Ground" options. |
| `app/admin/venues.tsx` | Admin venue CRUD | Add operating hours inputs (`open_time`, `close_time`), slot duration (`slot_minutes`), number of courts (`courts_count`), and `is_bookable` switch. |
| `src/shared/utils/scheduleConflict.ts` | Conflict string formatting | Ensure conflict parser handles double-booking exclusion errors and slot conflict tokens. |

### 4.2 New Feature Components to Add

To keep code clean and modular (clean architecture), place reusable UI widgets in `src/features/venues/presentation/`:
1. `DateStrip.tsx`: Horizontal interactive date selector (today + 14 days).
2. `CourtPicker.tsx`: Segmented chips for Court 1, Court 2, etc.
3. `TimeSlotGrid.tsx`: Grid rendering computed time slots with Available vs Occupied styling.
4. `BookingModal.tsx`: Bottom sheet confirmation dialog with error handling ("Slot already taken").
5. `MyBookingsModal.tsx`: Modal / view for inspecting active bookings and cancelling them.

---

## 5. Verification & Test Plan

### 5.1 Verification Checklist
- [x] Baseline TypeScript Compilation: Tested via `npm run typecheck` (`tsc --noEmit`), passed with **0 errors**.
- [ ] R1 Verification: Venues support operating hours (e.g. 06:00 to 23:00), `slot_minutes` (e.g. 60), and `courts_count` (e.g. 1..4).
- [ ] R2 Verification: Attempting to book a slot that has been booked concurrently returns clean error toast "Slot already taken" and refreshes the slot grid.
- [ ] R3 Verification:
  - Interactive date selector allows selecting any day in the next 14 days.
  - Court/box picker allows switching between Court 1, Court 2, etc.
  - Slot grid clearly displays time ranges.
  - Booked slots are visibly distinct and disabled. Available slots are selectable.
- [ ] R4 Verification:
  - User can book slot directly from Venues tab.
  - User can link ground slot to an existing match from `/match/[id]/venue`.
  - User can view their bookings and cancel a booking; cancelled slot immediately becomes available in the grid.
- [ ] Regression Verification: Run `npm run typecheck` to confirm 0 compilation errors across the workspace.

---

## 6. Recommendations for Implementation Phase

1. **Backend Integration First:** Ensure database migrations and RPCs (`get_venue_slots`, `book_slot`, `cancel_booking`) and exclusion constraints are ready before wiring the UI mutations.
2. **Dynamic Slot Computing via RPC:** Rely on a backend RPC (`get_venue_slots(venue_id, date)`) rather than client-side date math. The backend knows the operating hours, court count, existing confirmed bookings, and admin blocks, returning a normalized list of slots with occupancy per court.
3. **Optimistic & Cache Invalidation Strategy:**
   - Invalidate `['venues', 'slots', venueId, date]` on successful booking or cancellation.
   - Invalidate `['matches', matchId]` when a booking is linked to a match.
   - Invalidate `['venues', 'my-bookings']` when a booking is created or cancelled.
4. **Resilient Conflict UI:**
   - Catch Postgres exclusion constraint code `23P01` / `SLOT_ALREADY_TAKEN` in the mutation error handler.
   - Show user-friendly toast/alert: *"Slot already taken. Another player just booked this court and slot. Please pick another slot."*
   - Refetch slots immediately so the newly occupied slot is grayed out.
