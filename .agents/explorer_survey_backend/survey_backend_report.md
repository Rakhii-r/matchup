# MatchUp Backend Service & Slot Booking Architecture Survey

**Date**: 2026-09-04  
**Author**: survey_backend_explorer  
**Status**: COMPLETE  
**Target Codebase**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`  

---

## Executive Summary

This report delivers a complete architectural survey of MatchUp's backend services, database schema, Supabase integration, concurrency engine, dynamic slot computation, error handling, match linking, and TypeScript setup in support of the Venue Time Slot Booking requirements (**R1–R4**).

The MatchUp codebase is a React Native / Expo application built on top of Supabase (PostgreSQL with PostGIS, RLS, and PL/pgSQL security-definer RPCs). It strictly follows a Clean Feature Architecture (`src/features/<feature>/{data,domain,presentation}`). There is currently no `bookings` table or booking service in the codebase; venues are currently a curated directory with "Call to confirm" static metadata (`20260627063252_phase1_schema.sql`, `20260815070000_venue_media_and_facilities.sql`, `20260830120000_venue_status.sql`). 

All necessary architectural foundations (advisory locks, custom conflict tokens, TanStack Query cache invalidation, RLS, and RPC patterns) already exist and provide proven patterns to build upon.

---

## 1. Architecture & API Query Pattern

### 1.1 Client & Authentication Layer
- **Supabase Client**: `src/core/api/supabaseClient.ts`
  - Instantiates `createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, ...)` with session persistence via `expo-secure-store` (`src/core/storage/secureStore.ts`).
  - Automatically attaches the caller's JWT to all requests.
  - Pauses auto-refresh when the app enters the background (`AppState.addEventListener('change', ...)`).
- **Postgres RLS**: All client requests run with the caller's authenticated identity (`auth.uid()`). Raw client inserts are restricted by RLS; domain mutations go through `security definer` RPCs that enforce validation and authorization.

### 1.2 Feature Organization Standard
The project adheres to a uniform 3-layer modular structure under `src/features/<feature>/`:
```
src/features/<feature>/
├── data/
│   └── <feature>Repository.ts     # Supabase queries & RPC calls, error translation
├── domain/
│   └── <feature>Schema.ts         # Zod schemas, TypeScript types, pure utilities
└── presentation/
    ├── use<Feature>.ts            # TanStack Query (useQuery, useMutation, invalidation)
    └── UIComponents.tsx           # Screen/widget presentation
```
**Reference implementations**:
- `src/features/venues/data/venueRepository.ts` (lines 66–198)
- `src/features/venues/domain/venueSchema.ts` (lines 1–25)
- `src/features/venues/presentation/useVenues.ts` (lines 1–120)
- `src/features/matches/data/matchRepository.ts` (lines 80–105, 330–360)

### 1.3 State Management & Invalidation Pattern
- **TanStack Query** (`@tanstack/react-query` v5.59.0):
  - Query keys are structured hierarchically, e.g. `['venues']`, `['venues', 'nearby', lat, lng]`, `['venue-slots', venueId, date]`, `['bookings', 'mine']`.
  - Mutations take a `useQueryClient()` instance and call `qc.invalidateQueries({ queryKey: [...] })` inside `onSuccess`.
- **Client Stores** (`zustand` v5.0.1):
  - Lightweight stores for transient session state (e.g. `src/core/auth/authStore.ts`, `src/features/matches/presentation/useCreateMatchWizard.ts`).

### 1.4 Error Mapping Pipeline
- **Core Error System**: `src/core/errors/AppError.ts`
  - Defines `AppErrorCode = 'network' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'rate_limited' | 'unknown'`.
  - `toAppError(error: unknown): AppError`: Inspects Supabase/PostgREST error codes (e.g. HTTP 409, `23505` unique violation, `42501` RLS denial, `23514` check constraint violation).
  - Repositories implement custom domain error mappers (e.g. `venueErrorToAppError` in `matchRepository.ts:98`, `SUGGEST_ERRORS` in `venueRepository.ts:44–64`).
  - **Crucial Finding**: Postgres exclusion constraint violations emit SQLSTATE `23P01` (`exclusion_violation`). This code is not yet handled in `toAppError.ts`. Mapping `23P01` and the RPC token `'SLOT_ALREADY_TAKEN'` directly to `AppError('conflict', 'Slot already taken')` will satisfy Requirement R2 verbatim.

---

## 2. Venue & Booking Schema Analysis

### 2.1 Current `venues` Table Schema
Defined in `supabase/migrations/20260627063252_phase1_schema.sql` (lines 54–68) and altered by `20260815070000_venue_media_and_facilities.sql` and `20260830120000_venue_status.sql`:
```sql
create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  location      geography(Point, 4326) generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  sport_types   text[] not null default '{}',
  phone         text,
  confirm_note  text not null default 'Call to confirm availability',
  image_url     text,
  rating        numeric(2,1),
  rating_count  integer not null default 0,
  price_per_hour integer,
  facilities    text[] not null default '{}',
  status        text not null default 'approved', -- 'approved' | 'pending' | 'hidden'
  suggested_by  uuid references public.profiles(id),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
```

### 2.2 Required Schema Extensions for `venues` (Requirement R1)
To support dynamic slot generation and court/box management, the `venues` table requires operating configuration columns:
```sql
alter table public.venues
  add column if not exists courts_count integer not null default 1 check (courts_count >= 1 and courts_count <= 20),
  add column if not exists open_time time not null default '06:00:00',
  add column if not exists close_time time not null default '23:00:00',
  add column if not exists slot_minutes integer not null default 60 check (slot_minutes in (30, 45, 60, 90, 120)),
  add column if not exists open_days integer[] not null default '{1,2,3,4,5,6,7}',
  add column if not exists is_bookable boolean not null default true;
```

### 2.3 Proposed `bookings` Table Schema (Requirements R1, R2, R4)
```sql
create extension if not exists btree_gist;

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues(id) on delete cascade,
  court_no       integer not null check (court_no >= 1),
  start_time     timestamptz not null,
  end_time       timestamptz not null,
  time_range     tstzrange generated always as (tstzrange(start_time, end_time, '[)')) stored,
  kind           text not null default 'booking' check (kind in ('booking', 'admin_block')),
  status         text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  match_id       uuid references public.matches(id) on delete set null,
  booked_by      uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.profiles(id),
  cancel_reason  text,
  constraint bookings_end_after_start check (end_time > start_time)
);

-- Indices for performance
create index bookings_venue_lookup_idx on public.bookings (venue_id, court_no, status);
create index bookings_match_idx on public.bookings (match_id) where match_id is not null;
create index bookings_user_idx on public.bookings (booked_by, created_at desc);

-- Database-Level Concurrency Constraint (Postgres Exclusion)
alter table public.bookings add constraint no_double_booking
  exclude using gist (
    venue_id with =,
    court_no with =,
    time_range with &&
  ) where (status = 'confirmed');
```

---

## 3. Dynamic Time Slot Calculation Architecture

### 3.1 Mathematical & Temporal Specification
Given:
- `venue`: `open_time` (e.g. `06:00`), `close_time` (e.g. `23:00`), `slot_minutes` (e.g. `60`), `courts_count` (e.g. `2` boxes), `is_bookable` (boolean)
- `selectedDate`: `YYYY-MM-DD` in India Standard Time (IST, UTC+05:30)
- `existingBookings`: Set of confirmed bookings $B = \{b \mid b.\text{venue\_id} = v \land b.\text{status} = \text{'confirmed'} \land b.\text{time\_range} \ \&\& \ [\text{day\_start}, \text{day\_end})\}$

### 3.2 Algorithm Flow
```
For each court_no in 1 .. venue.courts_count:
  current_start = IST(selectedDate, venue.open_time)
  day_close     = IST(selectedDate, venue.close_time)
  
  While (current_start + slot_minutes <= day_close):
    slot_end = current_start + slot_minutes
    slot_range = [current_start, slot_end)
    
    conflict = exists b in B where b.court_no == court_no and (b.time_range && slot_range)
    is_past  = slot_start < now()
    
    status = if conflict then 'booked'
             else if is_past then 'past'
             else 'available'
             
    yield Slot(court_no, court_label, current_start, slot_end, status, booking_id)
    current_start = slot_end
```

### 3.3 Database RPC Implementation (`get_venue_slots`)
A high-performance SQL function avoiding N+1 queries:
```sql
create or replace function public.get_venue_slots(
  in_venue_id uuid,
  in_date date
)
returns table (
  court_no       integer,
  court_name     text,
  start_time     timestamptz,
  end_time       timestamptz,
  start_label    text,
  end_label      text,
  status         text, -- 'available' | 'booked' | 'past'
  booking_id     uuid,
  is_my_booking  boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_venue public.venues%rowtype;
  v_uid   uuid := auth.uid();
  v_tz    text := 'Asia/Kolkata';
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_step      interval;
begin
  select * into v_venue from public.venues where id = in_venue_id and status = 'approved';
  if not found then
    return;
  end if;

  if not coalesce(v_venue.is_bookable, true) then
    return;
  end if;

  v_day_start := (in_date::text || ' ' || v_venue.open_time::text)::timestamp at time zone v_tz;
  v_day_end   := (in_date::text || ' ' || v_venue.close_time::text)::timestamp at time zone v_tz;
  v_step      := (coalesce(v_venue.slot_minutes, 60) || ' minutes')::interval;

  return query
  with court_series as (
    select generate_series(1, coalesce(v_venue.courts_count, 1)) as c_no
  ),
  slot_series as (
    select s as s_start, s + v_step as s_end
      from generate_series(v_day_start, v_day_end - v_step, v_step) as s
  ),
  candidate_grid as (
    select
      c.c_no,
      case
        when 'box_cricket' = any(v_venue.sport_types) then 'Box ' || c.c_no
        else 'Court ' || c.c_no
      end as c_name,
      sg.s_start,
      sg.s_end
    from court_series c
    cross join slot_series sg
  )
  select
    cg.c_no,
    cg.c_name,
    cg.s_start,
    cg.s_end,
    to_char(cg.s_start at time zone v_tz, 'HH12:MI AM') as start_label,
    to_char(cg.s_end   at time zone v_tz, 'HH12:MI AM') as end_label,
    case
      when b.id is not null then 'booked'
      when cg.s_start <= now() then 'past'
      else 'available'
    end as status,
    b.id as booking_id,
    (b.booked_by = v_uid) as is_my_booking
  from candidate_grid cg
  left join public.bookings b
    on b.venue_id = in_venue_id
   and b.court_no = cg.c_no
   and b.status = 'confirmed'
   and b.time_range && tstzrange(cg.s_start, cg.s_end, '[)')
  order by cg.c_no asc, cg.s_start asc;
end;
$$;
```

### 3.4 Client-Side Pure TypeScript Calculator (`slotUtils.ts`)
To support unit testing, instant UI recalculation, and offline previewing:
```ts
export interface CandidateSlot {
  courtNo: number;
  courtName: string;
  startTime: string; // ISO UTC
  endTime: string;   // ISO UTC
  startLabel: string;
  endLabel: string;
  status: 'available' | 'booked' | 'past';
  bookingId?: string | null;
  isMyBooking?: boolean;
}

export function computeSlotsForDay(
  venue: { courts_count: number; open_time: string; close_time: string; slot_minutes: number; sport_types: string[] },
  dateStr: string, // YYYY-MM-DD
  existingBookings: Array<{ id: string; court_no: number; start_time: string; end_time: string; booked_by: string }>,
  currentUserId?: string | null,
  now: Date = new Date(),
): CandidateSlot[] {
  // Pure functional computation mirroring get_venue_slots
}
```

---

## 4. Double-Booking Prevention & Concurrency Protection

### 4.1 Two-Tier Protection Mechanism (Defence in Depth)
1. **Tier 1 — Postgres Exclusion Constraint (`btree_gist`)**:
   - `alter table bookings add constraint no_double_booking exclude using gist (venue_id with =, court_no with =, time_range with &&) where (status = 'confirmed');`
   - Even if two requests execute at the exact same microsecond, Postgres serializes the index check; exactly one succeeds and the other receives SQLSTATE `23P01` (`exclusion_violation`).
2. **Tier 2 — Transactional Advisory Locking in `book_court_slot` RPC**:
   - In `book_court_slot`, before checking availability or inserting:
     ```sql
     perform pg_advisory_xact_lock(hashtext('booking:' || in_venue_id::text || ':' || in_court_no::text));
     ```
   - Serializes concurrent attempts on the *same court* for the duration of the transaction.
   - Raises clean exception:
     ```sql
     if exists (
       select 1 from public.bookings
        where venue_id = in_venue_id
          and court_no = in_court_no
          and status = 'confirmed'
          and time_range && tstzrange(in_start_time, in_end_time, '[)')
     ) then
       raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23505';
     end if;
     ```

### 4.2 Error Catching & Surfacing ("Slot already taken")
- **Repository Catch Handler**:
  ```ts
  const CONFLICT_TOKENS = ['SLOT_ALREADY_TAKEN', 'no_double_booking', '23P01'];

  export function bookingErrorToAppError(error: unknown): AppError {
    const raw = (error as { message?: string; code?: string } | null)?.message ?? '';
    const code = (error as { code?: string } | null)?.code ?? '';
    if (code === '23P01' || CONFLICT_TOKENS.some((t) => raw.includes(t) || code === t)) {
      return new AppError('conflict', 'Slot already taken', error);
    }
    return toAppError(error);
  }
  ```
- **UI Behaviour**:
  - When the mutation catches `AppError('conflict', 'Slot already taken')`:
    1. Alert or banner displays: `"Slot already taken"`.
    2. Automatically calls `queryClient.invalidateQueries({ queryKey: ['venue-slots', venueId] })`.
    3. The slot visually flips to Booked/Occupied (disabled).

---

## 5. Cancellation Flow & Match Linking

### 5.1 Booking Cancellation Flow
- **RPC `cancel_booking(in_booking_id uuid, in_reason text default null)`**:
  - Security check: caller must be `booked_by` or `is_admin()`.
  - Sets `status = 'cancelled'`, `cancelled_at = now()`, `cancelled_by = auth.uid()`.
  - **Instant Slot Release**: Because the exclusion constraint has `where (status = 'confirmed')`, changing `status` to `'cancelled'` immediately removes that row from the active exclusion set.
  - Subsequent booking attempts for that exact court and time window succeed immediately without delay or locks.
- **Cache Invalidation on Cancel**:
  - `['bookings', 'mine']`
  - `['venue-slots', venueId]`
  - `['matches', matchId]`

### 5.2 Match Linking Flow
- **Linking Grounds to Matches**:
  - `bookings.match_id` references `matches.id`.
  - When booking from Ground Selection screen (`app/match/[id]/venue.tsx`):
    1. User picks date, court, and time slot.
    2. Calls `book_court_slot(venue_id, court_no, start_time, end_time, match_id)`.
    3. RPC links the booking to the match and updates `matches.venue_id`, `matches.venue_text`, `matches.scheduled_at = start_time`, `matches.end_time = end_time`.
    4. Match detail screen (`app/match/[id]/index.tsx`) now displays the court/box name, exact time window, and `SlotBadge` countdown strip.
- **Standalone Booking from Venues Tab** (`app/(tabs)/venues.tsx`):
  - User can browse venues, select a venue, pick date, court, and time slot.
  - `match_id` is passed as `null`.
  - Stored in user's bookings list with ability to cancel or link to a match later.

---

## 6. TypeScript Setup & Type Safety Verification

### 6.1 Configuration Verification
- `tsconfig.json`:
  - Extends `expo/tsconfig.base`.
  - Compiler options: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`, `"forceConsistentCasingInFileNames": true`.
  - Path mapping: `@/*` (`src/*`), `@features/*`, `@core/*`, `@shared/*`.
- `package.json`:
  - Script `"typecheck": "tsc --noEmit"` uses TypeScript `~6.0.3`.
  - Script `"db:types": "supabase gen types typescript --local > src/shared/types/database.types.ts"`.

### 6.2 Strict Typing Guidelines for New Modules
1. **`noUncheckedIndexedAccess` Compliance**:
   All array lookups (e.g. `slots[0]`, `parts[1]`) must handle possible `undefined` via nullish coalescing `??` or optional chaining `?.`.
2. **Database Types Extension**:
   `src/shared/types/database.types.ts` must include:
   - `Tables.bookings.Row / Insert / Update`
   - `Tables.venues.Row` extended with `courts_count`, `open_time`, `close_time`, `slot_minutes`, `is_bookable`, `open_days`.
   - `Functions.get_venue_slots`, `Functions.book_court_slot`, `Functions.cancel_booking`.
3. **Zod Validation Schemas**:
   - `BookingSchema`: validates `venueId` (uuid), `courtNo` (min 1), `startTime` (ISO), `endTime` (ISO), `matchId` (optional uuid).
   - `VenueSchema`: extended to validate operating settings.

---

## 7. Actionable Implementation Roadmap

| Phase | Deliverable | Target Files | Key Verification |
|---|---|---|---|
| **P1** | Database Migration | `supabase/migrations/20260904120000_venue_slot_booking.sql` | SQL test: Exclusion rejects overlapping booking; cancellation frees slot; RPC returns slot grid. |
| **P2** | Database Types Update | `src/shared/types/database.types.ts` | Typecheck passes for new table and RPC types. |
| **P3** | Booking Feature Domain & Repository | `src/features/bookings/data/bookingRepository.ts`, `domain/bookingSchema.ts`, `presentation/useBookings.ts` | Unit tests for slot computation & conflict mapping (`'Slot already taken'`). |
| **P4** | Venue Tab Slot Picker UI | `app/(tabs)/venues.tsx`, `src/features/bookings/presentation/CourtSlotPicker.tsx` | Interactive date selector, court selector, slot grid showing Available vs Occupied. |
| **P5** | Ground Selection & Match Linking UI | `app/match/[id]/venue.tsx` | Organiser books court slot; match updates `venue_id`, `venue_text`, `scheduled_at`, `end_time`. |
| **P6** | User Bookings & Cancellation UI | `src/features/bookings/presentation/MyBookingsModal.tsx` or screen | User views bookings and cancels; slot immediately returns to Available on grid. |

---

## 8. Summary Table of Files Investigated

| File Path | Purpose | Key Observation |
|---|---|---|
| `supabase/migrations/20260627063252_phase1_schema.sql` | Base schema | Created initial static `venues` and `matches` tables. |
| `supabase/migrations/20260815070000_venue_media_and_facilities.sql` | Venue enrichment | Added `image_url`, `rating`, `price_per_hour`, `facilities`. |
| `supabase/migrations/20260825120000_slot_multi_match.sql` | Slot rematch logic | Established pattern for booked slot boundaries (`end_time`). |
| `supabase/migrations/20260827110000_set_match_venue.sql` | Match venue linking | Defined `set_match_venue(match_id, venue_id)` RPC. |
| `supabase/migrations/20260830120000_venue_status.sql` | Venue status | Added `status ('approved','pending','hidden')` and `nearby_venues` RPC. |
| `src/core/api/supabaseClient.ts` | Supabase Client | Single client, token refresh tied to app state, auto-JWT for RLS. |
| `src/core/errors/AppError.ts` | Error mapping | Central error model; needs mapping for SQLSTATE `23P01`. |
| `src/shared/utils/scheduleConflict.ts` | Conflict formatting | Helper for parsing custom RPC conflict tokens. |
| `src/features/venues/data/venueRepository.ts` | Venue data access | Clean repository pattern with RPC wrappers and error handlers. |
| `src/features/venues/domain/venueSchema.ts` | Venue domain types | Zod validation for venue form; needs operating settings. |
| `src/features/venues/presentation/useVenues.ts` | Venue hooks | TanStack Query hooks with query invalidation patterns. |
| `app/(tabs)/venues.tsx` | Venues tab screen | Static list; lacks date selector, court picker, and slot grid. |
| `app/match/[id]/venue.tsx` | Ground selection screen | Single-tap venue linker; needs court picker and slot booking integration. |
| `app/admin/venues.tsx` | Admin venue CRUD | Form fields need `courts_count`, `open_time`, `close_time`, `slot_minutes`. |
