# Database & Concurrency Architecture Survey Report
**Module:** Venue Time Slot Booking, Manual Court Selection & Concurrency Protection  
**Date:** 2026-09-04  
**Author:** survey_db_explorer  
**Target Project:** MatchUp (sixfour24) Mobile App & Supabase PostgreSQL Backend  

---

## 1. Executive Summary

This report documents the architectural investigation and blueprint for implementing venue time slot booking, manual court/box selection, and database-level double-booking prevention in the MatchUp application.

### Key Findings
1. **Existing Venue Architecture:** The `public.venues` table contains basic directory metadata (`name`, `address`, `lat`, `lng`, `sport_types`, `phone`, `confirm_note`, `image_url`, `rating`, `rating_count`, `price_per_hour`, `facilities`, `status`, `suggested_by`). It **does not** currently store operating hours, slot durations, or court counts.
2. **Existing Booking State:** There is currently **no** `venue_bookings` or `bookings` table in the database. Venue selection today in `app/match/[id]/venue.tsx` only calls `set_match_venue(in_match_id, in_venue_id)` to tag a venue UUID onto a match row without reserving a slot or picking a court. The Venues tab (`app/(tabs)/venues.tsx`) only provides a "Call to confirm" button linking to a phone dialer.
3. **Database Concurrency Guarantee:** The PostgreSQL `btree_gist` extension coupled with a `tstzrange` GiST exclusion constraint (`EXCLUDE USING gist`) provides an engine-level guarantee against double bookings. Two overlapping bookings on the same venue and court cannot be committed under any concurrency condition.
4. **Cancellation Immediate Slot Releasing:** Using a partial exclusion constraint with `WHERE (status = 'confirmed')`, any update to `status = 'cancelled'` removes the row from the partial GiST index instantaneously, freeing the slot for concurrent or future bookings without locking contention.
5. **Atomic Write Pipeline:** Wrapping slot bookings in a `SECURITY DEFINER` RPC function (`book_venue_slot`) intercepts PostgreSQL exclusion violations (`23P01`), translates them into clear user-facing errors (`SLOT_ALREADY_TAKEN`), and atomically links bookings to matches in a single transaction.

---

## 2. Existing Database Schema & Migration Analysis

### Current Schema State
- **Base Venue Table:** `supabase/migrations/20260627063252_phase1_schema.sql` (line 54) created `public.venues`.
- **Enrichments:** 
  - `20260815070000_venue_media_and_facilities.sql`: Added `image_url`, `rating`, `rating_count`, `price_per_hour`, `facilities`.
  - `20260827110000_set_match_venue.sql`: Organiser RPC attaching `venue_id` and `venue_text` to `matches`.
  - `20260827120000_nearby_venues.sql`: Geospatial query returning venues within search radius.
  - `20260830120000_venue_status.sql`: Added `status` (`'approved' | 'pending' | 'hidden'`).
  - `20260830130000_venue_notifies_captain_chat.sql`: Organiser venue tagging sends informational chat to opposing captain noting: *"sixfour24 has not reserved this turf, so call the ground to confirm the slot."*
  - `20260831174949_venue_ratings.sql`: Added `venue_ratings` table and `rate_venue` RPC.
- **Extensions Active:** `postgis`, `pgcrypto`, `pg_net`, `pg_cron`. (Note: `btree_gist` is **not** yet installed).
- **Existing `matches` Table:** Has `venue_id uuid references venues(id)`, `venue_text text`, `scheduled_at timestamptz`, `end_time timestamptz`.

---

## 3. Schema Extensions Required

### 3.1 Extensions on `public.venues`
Each venue must support configurable operating hours, slot duration, and number of courts/boxes:

| Column | Type | Default | Constraint | Purpose |
|---|---|---|---|---|
| `operating_hours_start` | `time` | `'06:00:00'` | `not null` | Opening time of the venue |
| `operating_hours_end` | `time` | `'23:00:00'` | `not null` | Closing time of the venue |
| `slot_duration_minutes` | `integer` | `60` | `check (slot_duration_minutes in (30, 45, 60, 90, 120))` | Duration of each booking slot |
| `courts_count` | `integer` | `2` | `check (courts_count >= 1 and courts_count <= 20)` | Total courts/boxes available |

**Constraint:**
```sql
alter table public.venues
  add constraint venues_valid_operating_hours
  check (operating_hours_end > operating_hours_start);
```

### 3.2 Update to `nearby_venues` RPC
The `nearby_venues` RPC must expose these new columns so clients can inspect operating hours, slot duration, and court count when browsing venues:
```sql
returns table (
  id uuid, name text, address text, lat double precision, lng double precision,
  sport_types text[], phone text, confirm_note text, image_url text,
  rating numeric, rating_count integer, price_per_hour integer,
  facilities text[], distance_m double precision,
  operating_hours_start time, operating_hours_end time,
  slot_duration_minutes integer, courts_count integer
)
```

---

## 4. New Table: `public.venue_bookings`

### 4.1 Table Definition
```sql
create table if not exists public.venue_bookings (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues (id) on delete cascade,
  court_number    integer not null check (court_number >= 1),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  status          text not null default 'confirmed'
                    check (status in ('confirmed', 'cancelled')),
  match_id        uuid references public.matches (id) on delete set null,
  notes           text check (notes is null or char_length(notes) <= 280),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  constraint venue_bookings_valid_window check (end_time > start_time)
);
```

### 4.2 Supporting Indexes
```sql
create index if not exists venue_bookings_venue_active_idx
  on public.venue_bookings (venue_id, court_number, start_time)
  where status = 'confirmed';

create index if not exists venue_bookings_user_idx
  on public.venue_bookings (user_id, status);

create index if not exists venue_bookings_match_idx
  on public.venue_bookings (match_id)
  where match_id is not null;
```

---

## 5. Concurrency Protection & Double-Booking Prevention

### 5.1 Analysis of Prevention Options

#### Option 1: Row Locking (`SELECT ... FOR UPDATE`)
- **Limitation:** In relational databases, you cannot lock a row that does not exist. An unbooked slot has no row in `venue_bookings`.
- **Drawback:** Locking at the parent venue level (`SELECT * FROM venues WHERE id = venue_id FOR UPDATE`) serializes all bookings across all courts, dates, and times for that venue, degrading throughput.

#### Option 2: PostgreSQL Exclusion Constraint (`EXCLUDE USING gist`) — Recommended
- **Mechanism:** Leverages PostgreSQL's generalized search tree (GiST) indexing with `tstzrange` and the `btree_gist` extension.
- **Half-Open Range `[)`:** `tstzrange(start_time, end_time, '[)')` includes `start_time` and excludes `end_time`. Back-to-back bookings (e.g. 06:00–07:00 and 07:00–08:00) share an endpoint but **do not** overlap (`&&` returns `false`).
- **Partial Index `WHERE (status = 'confirmed')`:** Cancelled bookings are ignored by the index, freeing the slot instantly.
- **Engine-Level Atomicity:** Handled directly in PostgreSQL storage engine locks. Two concurrent transactions trying to insert overlapping intervals for the same `(venue_id, court_number)` will result in one committing and the other failing with error code `23P01` (`exclusion_violation`).

### 5.2 SQL Implementation
```sql
-- Step 1: Enable btree_gist extension (for = operator on uuid & int in GiST)
create extension if not exists btree_gist;

-- Step 2: Add partial exclusion constraint
alter table public.venue_bookings
  drop constraint if exists venue_bookings_no_double_booking;

alter table public.venue_bookings
  add constraint venue_bookings_no_double_booking
  exclude using gist (
    venue_id with =,
    court_number with =,
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status = 'confirmed');
```

---

## 6. Stored Procedures (RPCs)

### 6.1 `public.book_venue_slot`
Performs atomic validation, slot reservation, double-booking interception, and optional match linking:

```sql
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
  v_uid     uuid := (select auth.uid());
  v_venue   public.venues%rowtype;
  v_match   public.matches%rowtype;
  v_booking public.venue_bookings%rowtype;
  v_dur_min integer;
  v_other   uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- 1. Validate Venue
  select * into v_venue from public.venues where id = in_venue_id;
  if not found or v_venue.status <> 'approved' then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 2. Validate Court
  if in_court_number < 1 or in_court_number > v_venue.courts_count then
    raise exception 'INVALID_COURT_NUMBER' using errcode = '23514';
  end if;

  -- 3. Validate Time Window
  if in_end_time <= in_start_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = '23514';
  end if;
  if in_start_time < (now() - interval '5 minutes') then
    raise exception 'CANNOT_BOOK_PAST' using errcode = '23514';
  end if;

  v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer;
  if v_dur_min % v_venue.slot_duration_minutes <> 0 then
    raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
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
    if v_match.status not in ('open', 'locked') then
      raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
    end if;
    if not (v_match.sport = any (v_venue.sport_types)) then
      raise exception 'VENUE_SPORT_MISMATCH' using errcode = '23514';
    end if;
  end if;

  -- 5. Insert Booking (Catches GiST exclusion violation)
  begin
    insert into public.venue_bookings (
      venue_id, court_number, user_id, start_time, end_time,
      status, match_id, notes
    ) values (
      in_venue_id, in_court_number, v_uid, in_start_time, in_end_time,
      'confirmed', in_match_id, in_notes
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
  end;

  -- 6. Link to Match if provided
  if in_match_id is not null then
    update public.matches
       set venue_id = v_venue.id,
           venue_text = v_venue.name || ' (Court ' || in_court_number || ')',
           scheduled_at = in_start_time,
           end_time = in_end_time
     where id = in_match_id;

    -- Optional captain chat announcement
    begin
      v_other := public._resolve_chat_counterpart(in_match_id, null, null, null);
      if v_other is not null and v_other <> v_uid then
        insert into public.captain_chat_messages
          (match_id, sender_id, recipient_id, content)
        values (
          in_match_id, v_uid, v_other,
          'Court booked: ' || v_venue.name || ' Court ' || in_court_number || ' confirmed for '
            || to_char(in_start_time at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM')
        );
      end if;
    exception when others then
      null;
    end;
  end if;

  return v_booking;
end;
$$;
```

### 6.2 `public.cancel_venue_booking`
```sql
create or replace function public.cancel_venue_booking(
  in_booking_id uuid
)
returns public.venue_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_booking public.venue_bookings%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_booking from public.venue_bookings where id = in_booking_id;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_booking.user_id <> v_uid and not public.is_admin() then
    raise exception 'NOT_THE_BOOKER' using errcode = '42501';
  end if;

  if v_booking.status = 'cancelled' then
    return v_booking;
  end if;

  update public.venue_bookings
     set status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   where id = in_booking_id
  returning * into v_booking;

  -- If tied to a match, clear match venue reference
  if v_booking.match_id is not null then
    update public.matches
       set venue_id = null,
           venue_text = null
     where id = v_booking.match_id
       and venue_id = v_booking.venue_id;
  end if;

  return v_booking;
end;
$$;
```

### 6.3 `public.get_venue_slots` (Dynamic Availability Calculation)
Computes the dynamic slot availability matrix for any selected date across all courts:

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
begin
  select * into v_venue from public.venues where id = in_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_day_start := (in_date + v_venue.operating_hours_start) at time zone in_timezone;
  v_day_end   := (in_date + v_venue.operating_hours_end) at time zone in_timezone;
  v_step      := (v_venue.slot_duration_minutes || ' minutes')::interval;

  return query
  with slot_times as (
    select
      s as s_start,
      (s + v_step) as s_end
    from generate_series(v_day_start, v_day_end - v_step, v_step) as s
  ),
  courts as (
    select generate_series(1, v_venue.courts_count) as c_num
  ),
  grid as (
    select
      c.c_num as court_number,
      'Court ' || c.c_num as court_label,
      st.s_start as start_time,
      st.s_end as end_time,
      to_char(st.s_start at time zone in_timezone, 'HH24:MI') as time_hhmm,
      to_char(st.s_end at time zone in_timezone, 'HH24:MI') as end_time_hhmm
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
    (b.id is null and g.start_time >= (now() - interval '5 minutes')) as is_available,
    b.id as booking_id,
    (b.user_id = auth.uid()) as is_my_booking
  from grid g
  left join public.venue_bookings b
    on b.venue_id = in_venue_id
   and b.court_number = g.court_number
   and b.status = 'confirmed'
   and tstzrange(b.start_time, b.end_time, '[)') && tstzrange(g.start_time, g.end_time, '[)')
  order by g.court_number asc, g.start_time asc;
end;
$$;
```

---

## 7. Security & Row Level Security (RLS) Policies

```sql
alter table public.venue_bookings enable row level security;

-- 1. Read: Authenticated users can view bookings to inspect availability
drop policy if exists "venue_bookings_select" on public.venue_bookings;
create policy "venue_bookings_select" on public.venue_bookings
  for select to authenticated using (true);

-- 2. Restrict Direct Writes: Direct mutations from anon/authenticated are disabled.
-- All mutations must go through book_venue_slot and cancel_venue_booking.
revoke insert, update, delete on public.venue_bookings from anon, authenticated;

-- 3. Grant RPC execution to authenticated users
grant execute on function public.book_venue_slot(uuid, integer, timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.cancel_venue_booking(uuid) to authenticated;
grant execute on function public.get_venue_slots(uuid, date, text) to authenticated;
```

---

## 8. Client & TypeScript Type Definitions

### 8.1 Updates to `src/shared/types/database.types.ts`

```typescript
// 1. Extend venues table Row/Insert/Update:
venues: {
  Row: {
    id: string;
    name: string;
    address: string | null;
    lat: number;
    lng: number;
    sport_types: Sport[];
    phone: string | null;
    confirm_note: string;
    created_by: string | null;
    created_at: string;
    image_url: string | null;
    rating: number | null;
    rating_count: number;
    price_per_hour: number | null;
    facilities: string[];
    status: 'approved' | 'pending' | 'hidden';
    suggested_by: string | null;
    operating_hours_start: string; // e.g. "06:00:00"
    operating_hours_end: string;   // e.g. "23:00:00"
    slot_duration_minutes: number; // e.g. 60
    courts_count: number;          // e.g. 2
  };
  Insert: {
    // ... existing fields
    operating_hours_start?: string;
    operating_hours_end?: string;
    slot_duration_minutes?: number;
    courts_count?: number;
  };
  Update: Partial<Database['public']['Tables']['venues']['Insert']>;
};

// 2. Add venue_bookings table:
venue_bookings: {
  Row: {
    id: string;
    venue_id: string;
    court_number: number;
    user_id: string;
    start_time: string;
    end_time: string;
    status: 'confirmed' | 'cancelled';
    match_id: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    cancelled_at: string | null;
  };
  Insert: {
    venue_id: string;
    court_number: number;
    user_id: string;
    start_time: string;
    end_time: string;
    status?: 'confirmed' | 'cancelled';
    match_id?: string | null;
    notes?: string | null;
  };
  Update: {
    status?: 'confirmed' | 'cancelled';
    notes?: string | null;
    cancelled_at?: string | null;
  };
  Relationships: [];
};

// 3. Add Functions:
book_venue_slot: {
  Args: {
    in_venue_id: string;
    in_court_number: number;
    in_start_time: string;
    in_end_time: string;
    in_match_id?: string | null;
    in_notes?: string | null;
  };
  Returns: Database['public']['Tables']['venue_bookings']['Row'];
};

cancel_venue_booking: {
  Args: {
    in_booking_id: string;
  };
  Returns: Database['public']['Tables']['venue_bookings']['Row'];
};

get_venue_slots: {
  Args: {
    in_venue_id: string;
    in_date: string;
    in_timezone?: string;
  };
  Returns: {
    court_number: number;
    court_label: string;
    start_time: string;
    end_time: string;
    time_hhmm: string;
    end_time_hhmm: string;
    is_available: boolean;
    booking_id: string | null;
    is_my_booking: boolean;
  }[];
};
```

### 8.2 Error Mapping in `src/core/errors/AppError.ts`
Map the Postgres exclusion violation code (`23P01`) and the RPC exception token (`SLOT_ALREADY_TAKEN`) to a clear conflict message:
```typescript
else if (
  e.code === '23P01' ||
  raw.includes('slot_already_taken') ||
  raw.includes('venue_bookings_no_double_booking')
) {
  code = 'conflict';
  return new AppError('conflict', 'Slot already taken. Please choose another court or time.', error);
}
```

---

## 9. Migration File Specification

A new migration file should be created in `supabase/migrations/`:
`supabase/migrations/20260904120000_venue_slot_booking_and_concurrency.sql`

It should contain in sequence:
1. `CREATE EXTENSION IF NOT EXISTS btree_gist;`
2. `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS operating_hours_start time NOT NULL DEFAULT '06:00:00';`
3. `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS operating_hours_end time NOT NULL DEFAULT '23:00:00';`
4. `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS slot_duration_minutes integer NOT NULL DEFAULT 60;`
5. `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS courts_count integer NOT NULL DEFAULT 2;`
6. `CREATE TABLE IF NOT EXISTS public.venue_bookings ...`
7. Exclusion constraint `venue_bookings_no_double_booking` on `public.venue_bookings`.
8. Updating `nearby_venues` RPC to return the new columns.
9. Function `book_venue_slot`.
10. Function `cancel_venue_booking`.
11. Function `get_venue_slots`.
12. RLS policies and grants.

---

## 10. Conclusion & Recommended Next Steps

1. **Database Migration:** Apply the migration script `20260904120000_venue_slot_booking_and_concurrency.sql`.
2. **TypeScript Domain & Repository:** Create `src/features/venues/data/venueBookingRepository.ts` and `src/features/venues/domain/venueBookingSchema.ts`.
3. **React Query Hooks:** Create `src/features/venues/presentation/useVenueBookings.ts` wrapping `get_venue_slots`, `book_venue_slot`, and `cancel_venue_booking`.
4. **UI Screen Integration:**
   - In `app/(tabs)/venues.tsx`: Add interactive Court/Slot selection modal or bottom sheet.
   - In `app/match/[id]/venue.tsx`: Enhance the venue detail card to allow selecting court and slot and confirming the booking directly for the match.
   - Add a "My Bookings" tab/modal where users can view active bookings and cancel them with one tap.
