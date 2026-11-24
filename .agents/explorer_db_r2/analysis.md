# Database & Stored Procedures Analysis Report
**Explorer 1 (DB & Stored Procedures)**
**Timestamp**: 2026-09-07T08:42:00Z
**Project**: MatchUp (sixfour24)
**Scope**: 30-Minute Granular Time Slots (Playo-Style), Multi-Slot Spans, Stored Procedures, GiST Exclusion Constraints, and Venue Metadata

---

## Executive Summary

The database architecture is fundamentally ready to support 30-minute granular time slots, multi-slot bookings (e.g. 2.5 hrs = 150 mins), and zero-overlocking consecutive slots.

1. **Exclusion Constraint**: The partial GiST exclusion constraint on `public.venue_bookings` using `tstzrange(start_time, end_time, '[)') with && where (status = 'confirmed')` naturally and natively supports arbitrary time intervals. Because half-open intervals `[start, end)` share boundaries without intersection (e.g. `[1:00 PM, 3:30 PM)` and `[3:30 PM, 4:00 PM)` do not overlap), booking a 2.5-hour slot starting at 1:00 PM will **strictly lock 1:00 PM to 3:30 PM** and leave **3:30 PM to 4:00 PM 100% available and selectable**.
2. **Schema Default**: `public.venues.slot_duration_minutes` is currently set to `default 60` with a check constraint `check (slot_duration_minutes in (30, 45, 60, 90, 120))`. To satisfy R1, the column default must be updated to `30`, and existing venue rows updated from 60 to 30.
3. **Stored Procedure `get_venue_slots`**: Currently falls back to 60 minutes if `slot_duration_minutes` is missing or 0 (`coalesce(nullif(v_venue.slot_duration_minutes, 0), 60)`). Updating this fallback to `30` ensures 48 30-minute blocks (00:00 to 24:00) are generated per court. Furthermore, `court_label` should dynamically format as `'Box N'` for box cricket vs `'Court N'` for badminton.
4. **Stored Procedure `book_venue_slot`**: Already validates durations in multiples of 30 (`v_dur_min % 30 = 0`), which immediately accommodates 30m, 60m, 90m, 120m, 150m, 180m, etc. A start-time alignment check on 30-minute boundaries should be added to prevent arbitrary minute fragmentation (e.g. booking at 1:17 PM). In addition, match linking must ensure `end_time` and formatted `venue_text` (`"Venue Name (Box 1)"`) are persisted on `public.matches`.
5. **Stored Procedure `cancel_venue_booking`**: Correctly updates `status = 'cancelled'`, which immediately releases the court slot due to the `where (status = 'confirmed')` partial exclusion index filter.
6. **Repository & Client Queries**: `venueBookingRepository.listMyBookings` currently queries `venues(name, address, sport_types)`. To support the R2 requirement for the interactive "Get Directions" button, `venues(name, address, lat, lng, sport_types)` must be selected so latitude and longitude are available to launch native map navigation.

---

## 1. Codebase Investigation Findings

### 1.1 Existing Migrations & Schema Evolution

| Migration File | Key Features & DB Objects | Status & Analysis |
|---|---|---|
| `20260905062131_venue_slot_booking_and_concurrency.sql` | • Added `operating_hours_start`, `operating_hours_end`, `slot_duration_minutes` (default 60), `courts_count` (default 2) to `public.venues`.<br>• Enabled `btree_gist` extension.<br>• Created `public.venue_bookings` table.<br>• Defined GiST exclusion constraint `venue_bookings_no_double_booking`.<br>• Defined initial RPCs: `book_venue_slot`, `cancel_venue_booking`, `get_venue_slots`. | Active foundation. Check constraint `venues_slot_duration_check` already permits 30: `check (slot_duration_minutes in (30, 45, 60, 90, 120))`. |
| `20260905144000_fix_slot_availability_and_duration_booking.sql` | • Updated `book_venue_slot` to validate `in_end_time > now()`.<br>• Added row lock on `public.venues` (`select id into v_other ... for update`).<br>• Updated `get_venue_slots` availability check to `g.end_time > now()`. | Refined concurrency locking and slot past expiration. |
| `20260907120000_venues_24h_and_booking_fixes.sql` | • Configured 24-hour default operating hours (`00:00:00` to `24:00:00`).<br>• Set all venue statuses to `'approved'`.<br>• Updated `book_venue_slot` duration check to `v_dur_min % 30 <> 0`.<br>• Updated `get_venue_slots` to generate full 24-hour day boundaries. | Current production state. However, line 17 kept default `slot_duration_minutes = 60`, and line 198 kept fallback step `60`. |

### 1.2 `public.venues` Schema & Seed Data

1. **Table Schema (`public.venues`)**:
   ```sql
   id                    uuid primary key default gen_random_uuid(),
   name                  text not null,
   address               text,
   lat                   double precision not null,
   lng                   double precision not null,
   sport_types           text[] not null,
   phone                 text,
   status                text not null default 'approved',
   operating_hours_start time not null default '00:00:00',
   operating_hours_end   time not null default '24:00:00',
   slot_duration_minutes integer not null default 60,   -- TARGET: Update default to 30
   courts_count          integer not null default 2,
   location              geography(Point, 4326) generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored
   ```
2. **Check Constraints**:
   - `venues_slot_duration_check`: `check (slot_duration_minutes in (30, 45, 60, 90, 120))`
   - `venues_courts_count_check`: `check (courts_count >= 1 and courts_count <= 20)`
   - `venues_valid_operating_hours`: `check (operating_hours_end > operating_hours_start)`
   *Finding*: The check constraint already permits `30`. No change to the check constraint expression is needed.
3. **Seed Data (`supabase/seed.sql`)**:
   Inserts 4 Pune venues without specifying `slot_duration_minutes`:
   - `'Smash Arena Badminton'`
   - `'BoxOut Cricket Turf'`
   - `'Game Point Sports Club'`
   - `'Rally Shuttle Court'`
   *Finding*: When the column default is changed to 30, all seeded venues will inherit 30-minute slots automatically.

---

## 2. Stored Procedures In-Depth Analysis

### 2.1 `get_venue_slots`

```sql
create or replace function public.get_venue_slots(
  in_venue_id   uuid,
  in_date       date,
  in_timezone   text default 'Asia/Kolkata'
)
returns table (
  court_number    integer,
  court_label     text,
  start_time      timestamptz,
  end_time        timestamptz,
  time_hhmm       text,
  end_time_hhmm   text,
  is_available    boolean,
  booking_id      uuid,
  is_my_booking   boolean
)
```

1. **Step Generation**:
   Currently in `20260907120000_venues_24h_and_booking_fixes.sql`:
   ```sql
   v_step := (coalesce(nullif(v_venue.slot_duration_minutes, 0), 60) || ' minutes')::interval;
   ```
   *Action*: Change fallback from `60` to `30`.
   With `v_step := interval '30 minutes'` across 24 operating hours (`00:00:00` to `24:00:00`):
   - Generates 48 intervals per court (e.g. `00:00–00:30`, `00:30–01:00`, ..., `23:30–24:00`).
   - For a 2-court venue, exactly 96 candidate slot records are generated per date.
2. **Timezone & Representation**:
   - `v_day_start := (in_date + time '00:00:00') at time zone v_tz;`
   - `v_day_end   := ((in_date + 1) + time '00:00:00') at time zone v_tz;`
   - `time_hhmm   := to_char(st.s_start at time zone v_tz, 'HH24:MI');`
   - `end_time_hhmm := to_char(st.s_end at time zone v_tz, 'HH24:MI');`
   *Finding*: The timezone handling accurately computes UTC timestamps and local wall-clock HH:MI strings in `Asia/Kolkata`.
3. **Court / Box Label Formatting**:
   Currently: `'Court ' || c.c_num as court_label`
   *Enhancement*:
   ```sql
   case
     when 'box_cricket' = any(v_venue.sport_types) and not ('badminton' = any(v_venue.sport_types))
       then 'Box ' || c.c_num
     else 'Court ' || c.c_num
   end as court_label
   ```
4. **Availability & Overlap Join**:
   ```sql
   left join public.venue_bookings b
     on b.venue_id = in_venue_id
    and b.court_number = g.court_number
    and b.status = 'confirmed'
    and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(g.start_time, g.end_time, '[)')
   ```
   *Finding*: The join uses `&&` between the booking's `tstzrange` and the slot's `tstzrange`. If a booking spans 1:00 PM to 3:30 PM, all 5 slots (1:00-1:30, 1:30-2:00, 2:00-2:30, 2:30-3:00, 3:00-3:30) match `b.id`, so `b.id is not null` (`is_available = false`). For the 3:30 PM to 4:00 PM slot, `[1:00 PM, 3:30 PM) && [3:30 PM, 4:00 PM)` evaluates to FALSE, so `b.id` is null, and `is_available` evaluates to `true`.

### 2.2 `book_venue_slot`

1. **Duration Validation**:
   ```sql
   v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer;
   if v_dur_min <= 0 or (v_dur_min % 30 <> 0) then
     raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
   end if;
   ```
   *Analysis*: Multi-hour spans such as:
   - 60 mins (1.0 hr): `60 % 30 == 0` (Valid)
   - 90 mins (1.5 hrs): `90 % 30 == 0` (Valid)
   - 120 mins (2.0 hrs): `120 % 30 == 0` (Valid)
   - 150 mins (2.5 hrs): `150 % 30 == 0` (Valid)
   - 180 mins (3.0 hrs): `180 % 30 == 0` (Valid)
   All are fully accepted by the database procedure.
2. **Start Time Slot Alignment**:
   To prevent off-grid bookings (e.g. 1:17 PM to 3:47 PM), the start time should be validated against the 30-minute boundary:
   ```sql
   v_offset_min := round(extract(epoch from (v_local_start - time '00:00:00')) / 60)::integer;
   if extract(second from v_local_start) <> 0
      or extract(second from v_local_end) <> 0
      or (v_offset_min % 30 <> 0) then
     raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
   end if;
   ```
3. **Atomicity & Match Updating**:
   When booking is linked to an existing match (`in_match_id is not null`), it must update:
   - `venue_id = in_venue_id`
   - `scheduled_at = in_start_time`
   - `end_time = in_end_time`
   - `venue_text = v_venue.name || ' (' || v_court_label || ')'`

### 2.3 `cancel_venue_booking`

1. **Mechanism of Slot Release**:
   - `update public.venue_bookings set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = in_booking_id;`
   - Because `venue_bookings_no_double_booking` constraint has the predicate `where (status = 'confirmed')`, the cancelled record is immediately ignored by PostgreSQL's GiST index.
   - Because `get_venue_slots` joins with `and b.status = 'confirmed'`, the cancelled booking no longer matches the slot grid.
   - Instant re-booking of that exact slot range is immediately possible.

---

## 3. Exclusion Constraint Deep Dive: `tstzrange` Half-Open Semantics

### 3.1 Mathematical Definition & Overlap Check

The constraint is declared as:
```sql
alter table public.venue_bookings
  add constraint venue_bookings_no_double_booking
  exclude using gist (
    venue_id with =,
    court_number with =,
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status = 'confirmed');
```

In PostgreSQL, `tstzrange(start_time, end_time, '[)')` creates a half-open interval:
$$I = [s, e) = \{ t \in \text{timestamptz} \mid s \le t < e \}$$

For two intervals $A = [s_A, e_A)$ and $B = [s_B, e_B)$:
$$A \text{ \&\& } B \iff s_A < e_B \land s_B < e_A$$

### 3.2 Evaluation of the 2.5-Hour Booking Case

- **Existing Booking A**: 1:00 PM to 3:30 PM (13:00 to 15:30)
  $$A = [13:00, 15:30)$$
- **Adjacent Candidate B**: 3:30 PM to 4:00 PM (15:30 to 16:00)
  $$B = [15:30, 16:00)$$
- Overlap Test:
  $$s_A < e_B \implies 13:00 < 16:00 \quad (\text{TRUE})$$
  $$s_B < e_A \implies 15:30 < 15:30 \quad (\textbf{FALSE})$$
- Result:
  $$A \text{ \&\& } B = \text{FALSE}$$

**Proof of Zero Overlocking**: Because $15:30 < 15:30$ is strictly false, the two intervals do not overlap. The exclusion constraint does NOT reject Candidate B, and `get_venue_slots` evaluates `b.id is null` for the 3:30 PM – 4:00 PM slot, leaving it Available.

Conversely, if a candidate overlaps even by 1 second (e.g. 3:00 PM to 3:30 PM):
$$s_A < e_C \implies 13:00 < 15:30 \quad (\text{TRUE})$$
$$s_C < e_A \implies 15:00 < 15:30 \quad (\text{TRUE})$$
Overlap is TRUE $\implies$ Rejected with `23P01 (SLOT_ALREADY_TAKEN)`.

---

## 4. Test Suite Inventory & Execution Verification

| Test Suite File | Framework | Tests | Status | Scope |
|---|---|---|---|---|
| `supabase/tests/venue_slot_booking_and_concurrency_test.sql` | Postgres SQL Transaction | 12 | Ready | Direct database test suite: covers auth, duplicate booking rejection, multi-court isolation, half-open back-to-back booking, dynamic slots, instant cancellation, match linking/unlinking, operating hour validation, and unaligned starts. |
| `tests/e2e/tier1_features/venueSlotCalculation.test.ts` | Node.js `node:test` | 19 | PASS (100%) | Dynamic slot matrix calculation for 30/45/60/90 min venues, court segmentation, status differentiation (`is_available`, `booking_id`, `is_my_booking`, past marking). |
| `tests/e2e/tier1_features/venueBookingRpc.test.ts` | Node.js `node:test` | 21 | PASS (100%) | `book_venue_slot` atomic creation, error handling (`28000`, `42501`, `P0002`, `23514`), `cancel_venue_booking`, match linking & detachment. |
| `tests/e2e/tier1_features/venueUiComponents.test.ts` | Node.js `node:test` | 8 | PASS (100%) | UI helper logic: `slotUtils.ts`, duration chips, slot formatting, `computeSlotRange`. |
| `tests/e2e/tier2_boundaries/boundaryAndCornerCases.test.ts` | Node.js `node:test` | 28 | PASS (100%) | Boundary conditions: earliest/latest slots, past grace threshold, 1 vs 4 vs 20 courts, input validation. |
| `tests/e2e/tier3_cross_features/concurrencyAndInteractions.test.ts` | Node.js `node:test` | 8 | PASS (100%) | Simultaneous booking race conditions, multi-court isolation, rapid 5-cycle book-cancel churn, 10-user saturation. |
| `tests/e2e/tier4_real_world/realisticVenueWorkload.test.ts` | Node.js `node:test` | 3 | PASS (100%) | 4-court tournament life cycle, prime-time saturation, capacity conservation invariant. |
| `tests/e2e/tier5_adversarial/challengerAdversarial.test.ts` | Node.js `node:test` | 36 | PASS (100%) | 50-user race condition, asymmetric sub-interval overlaps, 20-cycle churn resilience. |
| **Total Automated E2E Tests** | `tests/e2e/run_e2e_tests.ts` | **115** | **PASS (115/115)** | Execution verified via `npx tsx tests/e2e/run_e2e_tests.ts`. |

---

## 5. Integration Gaps & Required Code Modifications

### 5.1 Proposed Database Migration

A new migration `supabase/migrations/20260907140000_granular_30min_slots_and_box_formatting.sql` should be added with:

```sql
-- 1. Alter public.venues default slot duration to 30 and update existing venues
alter table public.venues
  alter column slot_duration_minutes set default 30;

update public.venues
   set slot_duration_minutes = 30
 where slot_duration_minutes <> 30;

-- 2. Update get_venue_slots with 30-min default step and Box/Court formatting
create or replace function public.get_venue_slots(
  in_venue_id   uuid,
  in_date       date,
  in_timezone   text default 'Asia/Kolkata'
)
returns table (
  court_number    integer,
  court_label     text,
  start_time      timestamptz,
  end_time        timestamptz,
  time_hhmm       text,
  end_time_hhmm   text,
  is_available    boolean,
  booking_id      uuid,
  is_my_booking   boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_venue     public.venues%rowtype;
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_step      interval;
  v_tz        text;
begin
  v_tz := coalesce(nullif(btrim(in_timezone), ''), 'Asia/Kolkata');

  select * into v_venue from public.venues where id = in_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 24-hour day boundaries in target timezone
  if v_venue.operating_hours_end = '24:00:00' or v_venue.operating_hours_end = '00:00:00' then
    v_day_start := (in_date + time '00:00:00') at time zone v_tz;
    v_day_end   := ((in_date + 1) + time '00:00:00') at time zone v_tz;
  else
    v_day_start := (in_date + v_venue.operating_hours_start) at time zone v_tz;
    v_day_end   := (in_date + v_venue.operating_hours_end) at time zone v_tz;
  end if;

  -- Default to 30 minutes if null or 0
  v_step := (coalesce(nullif(v_venue.slot_duration_minutes, 0), 30) || ' minutes')::interval;

  if v_day_start >= v_day_end or v_step <= interval '0 minutes' then
    return;
  end if;

  return query
  with slot_times as (
    select
      s as s_start,
      (s + v_step) as s_end
    from generate_series(v_day_start, v_day_end - v_step, v_step) as s
  ),
  courts as (
    select generate_series(1, greatest(1, v_venue.courts_count)) as c_num
  ),
  grid as (
    select
      c.c_num as court_number,
      case
        when 'box_cricket' = any(v_venue.sport_types) and not ('badminton' = any(v_venue.sport_types))
          then 'Box ' || c.c_num
        else 'Court ' || c.c_num
      end as court_label,
      st.s_start as start_time,
      st.s_end as end_time,
      to_char(st.s_start at time zone v_tz, 'HH24:MI') as time_hhmm,
      to_char(st.s_end at time zone v_tz, 'HH24:MI') as end_time_hhmm
    from courts c
    cross join slot_times st
  )
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
end;
$$;

-- 3. Update book_venue_slot to check 30-min start alignment and match metadata
create or replace function public.book_venue_slot(
  in_venue_id     uuid,
  in_court_number integer,
  in_start_time   timestamptz,
  in_end_time     timestamptz,
  in_match_id     uuid default null,
  in_notes        text default null
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_venue       public.venues%rowtype;
  v_match       public.matches%rowtype;
  v_booking     public.venue_bookings%rowtype;
  v_dur_min     integer;
  v_other       uuid;
  v_tz          text := 'Asia/Kolkata';
  v_local_start time;
  v_local_end   time;
  v_offset_min  integer;
  v_court_label text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- 1. Validate Venue
  select * into v_venue from public.venues where id = in_venue_id;
  if not found or v_venue.status in ('hidden', 'rejected') then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 2. Validate Court Number
  if in_court_number < 1 or in_court_number > v_venue.courts_count then
    raise exception 'INVALID_COURT_NUMBER' using errcode = '23514';
  end if;

  -- 3. Validate Time Window
  if in_end_time <= in_start_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = '23514';
  end if;
  if in_end_time <= now() then
    raise exception 'CANNOT_BOOK_PAST' using errcode = '23514';
  end if;

  -- Multiples of 30 minutes duration
  v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer;
  if v_dur_min <= 0 or (v_dur_min % 30 <> 0) then
    raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
  end if;

  -- 30-minute grid alignment check
  v_local_start := (in_start_time at time zone v_tz)::time;
  v_local_end   := (in_end_time at time zone v_tz)::time;
  v_offset_min  := round(extract(epoch from (v_local_start - time '00:00:00')) / 60)::integer;

  if extract(second from v_local_start) <> 0
     or extract(second from v_local_end) <> 0
     or (v_offset_min % 30 <> 0) then
    raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
  end if;

  -- Check operating hours if venue has restricted hours
  if v_venue.operating_hours_start <> '00:00:00' or v_venue.operating_hours_end <> '24:00:00' then
    if v_local_start < v_venue.operating_hours_start or v_local_end > v_venue.operating_hours_end then
      raise exception 'OUTSIDE_OPERATING_HOURS' using errcode = '23514';
    end if;
  end if;

  if in_notes is not null and char_length(in_notes) > 280 then
    raise exception 'NOTES_TOO_LONG' using errcode = '23514';
  end if;

  -- 4. Validate Match Linkage if provided
  if in_match_id is not null then
    select * into v_match from public.matches where id = in_match_id;
    if not found then
      raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_match.creator_id <> v_uid then
      raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
    end if;
    if v_match.status in ('in_progress', 'completed', 'cancelled') then
      raise exception 'MATCH_ALREADY_STARTED' using errcode = '42501';
    end if;
    if v_venue.sport_types is not null
       and array_length(v_venue.sport_types, 1) > 0
       and not (v_match.sport::text = any(v_venue.sport_types)) then
      raise exception 'VENUE_SPORT_MISMATCH' using errcode = '23514';
    end if;
  end if;

  -- 5. Lock venue record to serialize operations for this specific venue
  select id into v_other from public.venues where id = in_venue_id for update;

  -- 6. Insert confirmed booking
  begin
    insert into public.venue_bookings (
      venue_id, court_number, user_id, match_id,
      start_time, end_time, status, notes
    ) values (
      in_venue_id, in_court_number, v_uid, in_match_id,
      in_start_time, in_end_time, 'confirmed', in_notes
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
  end;

  -- 7. Update match record with venue, box label, and full time range
  if in_match_id is not null then
    v_court_label := case
      when 'box_cricket' = any(v_venue.sport_types) and not ('badminton' = any(v_venue.sport_types))
        then 'Box ' || in_court_number
      else 'Court ' || in_court_number
    end;

    update public.matches
       set venue_id = in_venue_id,
           venue_text = v_venue.name || ' (' || v_court_label || ')',
           scheduled_at = in_start_time,
           end_time = in_end_time
     where id = in_match_id;
  end if;

  return v_booking;
end;
$$;
```

### 5.2 Required TypeScript Data Layer Updates

In `src/features/venues/data/venueBookingRepository.ts`:
Line 162: Update `listMyBookings`:
```ts
// Before:
.select('*, venues(name, address, sport_types)')
// After:
.select('*, venues(name, address, lat, lng, sport_types)')
```
And in `map((row) => ...)`:
```ts
venueLat: venueObj?.lat,
venueLng: venueObj?.lng,
```

In `src/features/venues/domain/venueBookingSchema.ts`:
Add to `interface VenueBooking`:
```ts
venueLat?: number | null;
venueLng?: number | null;
```

---

## 6. Recommendations for Downstream Agents

1. **For Worker (Database & Migrations)**:
   - Create and apply `20260907140000_granular_30min_slots_and_box_formatting.sql`.
   - Update `VenueBookingRecord` and `createVenue` default in `tests/e2e/harness/venueBookingHarness.ts` to reflect `slotDurationMinutes: 30`.
   - Add unit tests in `tests/e2e/tier1_features/venueSlotCalculation.test.ts` verifying that 2.5-hour bookings (1:00 PM to 3:30 PM) mark exactly 5 slots and leave 3:30 PM to 4:00 PM available.
2. **For Frontend Explorer / Worker**:
   - Update `src/features/venues/data/venueBookingRepository.ts` to select `lat` and `lng`.
   - Implement the "Get Directions" button using `Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)` with fallback to native maps (`geo:` / Apple Maps).
   - In `app/profile/bookings.tsx`, enhance the booking card to display venue name, box/court label, address with pin icon, duration string `(2.5 hrs)`, and directions button.
