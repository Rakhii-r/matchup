-- Migration: 20260904120000_venue_slot_booking_and_concurrency.sql
-- Description: Implement venue slot booking, court configuration, exclusion constraints (btree_gist),
--              and stored procedures (book_venue_slot, cancel_venue_booking, get_venue_slots).

-- 1. Enable btree_gist extension for UUID and Integer support in GiST exclusion constraints
create extension if not exists btree_gist;

-- 2. Alter public.venues to support operating settings and court capacity
alter table public.venues
  add column if not exists operating_hours_start time not null default '06:00:00',
  add column if not exists operating_hours_end time not null default '23:00:00',
  add column if not exists slot_duration_minutes integer not null default 60,
  add column if not exists courts_count integer not null default 2;

-- Apply check constraints idempotently
alter table public.venues
  drop constraint if exists venues_slot_duration_check;
alter table public.venues
  add constraint venues_slot_duration_check
  check (slot_duration_minutes in (30, 45, 60, 90, 120));

alter table public.venues
  drop constraint if exists venues_courts_count_check;
alter table public.venues
  add constraint venues_courts_count_check
  check (courts_count >= 1 and courts_count <= 20);

alter table public.venues
  drop constraint if exists venues_valid_operating_hours;
alter table public.venues
  add constraint venues_valid_operating_hours
  check (operating_hours_end > operating_hours_start);

-- 3. Update nearby_venues RPC to return new venue operating fields
-- Note: Must drop existing function because return table column definition is modified.
drop function if exists public.nearby_venues(double precision, double precision, integer, text);

create or replace function public.nearby_venues(
  in_lat double precision,
  in_lng double precision,
  in_radius_m integer default 25000,
  in_sport text default null
)
returns table (
  id                    uuid,
  name                  text,
  address               text,
  lat                   double precision,
  lng                   double precision,
  sport_types           text[],
  phone                 text,
  confirm_note          text,
  image_url             text,
  rating                numeric,
  rating_count          integer,
  price_per_hour        integer,
  facilities            text[],
  distance_m            double precision,
  operating_hours_start time,
  operating_hours_end   time,
  slot_duration_minutes integer,
  courts_count          integer
)
language sql
stable
set search_path to 'public'
as $function$
  select v.id,
         v.name,
         v.address,
         v.lat,
         v.lng,
         v.sport_types,
         v.phone,
         v.confirm_note,
         v.image_url,
         v.rating,
         v.rating_count,
         v.price_per_hour,
         v.facilities,
         ST_Distance(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
         ) as distance_m,
         v.operating_hours_start,
         v.operating_hours_end,
         v.slot_duration_minutes,
         v.courts_count
    from public.venues v
   where v.status = 'approved'
     and (in_sport is null or in_sport = any (v.sport_types))
     and ST_DWithin(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
           in_radius_m
         )
   order by distance_m asc, v.rating desc nulls last, v.name asc;
$function$;

revoke execute on function public.nearby_venues(double precision, double precision, integer, text)
  from public, anon;
grant  execute on function public.nearby_venues(double precision, double precision, integer, text)
  to authenticated;

-- 4. Create public.venue_bookings table
create table if not exists public.venue_bookings (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues(id) on delete cascade,
  court_number    integer not null check (court_number >= 1),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  status          text not null default 'confirmed'
                    check (status in ('confirmed', 'cancelled')),
  match_id        uuid references public.matches(id) on delete set null,
  notes           text check (notes is null or char_length(notes) <= 280),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  constraint venue_bookings_valid_window check (end_time > start_time)
);

-- Trigger to maintain updated_at
drop trigger if exists set_venue_bookings_updated_at on public.venue_bookings;
create trigger set_venue_bookings_updated_at
  before update on public.venue_bookings
  for each row execute function public.set_updated_at();

-- Supporting indexes
create index if not exists venue_bookings_venue_active_idx
  on public.venue_bookings (venue_id, court_number, start_time)
  where status = 'confirmed';

create index if not exists venue_bookings_user_idx
  on public.venue_bookings (user_id, status);

create index if not exists venue_bookings_match_idx
  on public.venue_bookings (match_id)
  where match_id is not null;

-- 5. Partial GiST Exclusion Constraint for strict double-booking prevention
alter table public.venue_bookings
  drop constraint if exists venue_bookings_no_double_booking;

alter table public.venue_bookings
  add constraint venue_bookings_no_double_booking
  exclude using gist (
    venue_id with =,
    court_number with =,
    tstzrange(start_time, end_time, '[)') with &&
  ) where (status = 'confirmed');

-- 6. Stored Procedure: book_venue_slot
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

  -- 2. Validate Court Number
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
  if v_dur_min <= 0 or (v_dur_min % v_venue.slot_duration_minutes <> 0) then
    raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
  end if;

  -- Operating hours & slot grid alignment check in Asia/Kolkata
  v_local_start := (in_start_time at time zone v_tz)::time;
  v_local_end   := (in_end_time at time zone v_tz)::time;

  if (in_start_time at time zone v_tz)::date <> (in_end_time at time zone v_tz)::date
     or v_local_start < v_venue.operating_hours_start
     or v_local_end > v_venue.operating_hours_end then
    raise exception 'OUTSIDE_OPERATING_HOURS' using errcode = '23514';
  end if;

  v_offset_min := round(extract(epoch from (v_local_start - v_venue.operating_hours_start)) / 60)::integer;
  if extract(second from v_local_start) <> 0
     or extract(second from v_local_end) <> 0
     or v_offset_min < 0
     or (v_offset_min % v_venue.slot_duration_minutes <> 0) then
    raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
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

  -- 6. Atomically update Match if linked
  if in_match_id is not null then
    update public.matches
       set venue_id = v_venue.id,
           venue_text = v_venue.name || ' (Court ' || in_court_number || ')',
           scheduled_at = in_start_time,
           end_time = in_end_time
     where id = in_match_id;

    -- Best-effort captain chat announcement
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

-- 7. Stored Procedure: cancel_venue_booking
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

-- 8. Stored Procedure: get_venue_slots (Dynamic slot grid calculation)
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

  v_day_start := (in_date + v_venue.operating_hours_start) at time zone v_tz;
  v_day_end   := (in_date + v_venue.operating_hours_end) at time zone v_tz;
  v_step      := (v_venue.slot_duration_minutes || ' minutes')::interval;

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
    select generate_series(1, v_venue.courts_count) as c_num
  ),
  grid as (
    select
      c.c_num as court_number,
      'Court ' || c.c_num as court_label,
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
    coalesce(b.id is null and g.start_time >= (now() - interval '5 minutes'), false) as is_available,
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

-- 9. Row Level Security and Access Control
alter table public.venue_bookings enable row level security;

-- Read policy: Authenticated users can view bookings to inspect availability
drop policy if exists "venue_bookings_select" on public.venue_bookings;
create policy "venue_bookings_select" on public.venue_bookings
  for select to authenticated using (true);

-- Revoke direct mutations from public/anon/authenticated (mutations must go through RPCs)
revoke insert, update, delete on public.venue_bookings from anon, authenticated;

-- Function execute permissions
revoke execute on function public.book_venue_slot(uuid, integer, timestamptz, timestamptz, uuid, text)
  from public, anon;
grant  execute on function public.book_venue_slot(uuid, integer, timestamptz, timestamptz, uuid, text)
  to authenticated;

revoke execute on function public.cancel_venue_booking(uuid)
  from public, anon;
grant  execute on function public.cancel_venue_booking(uuid)
  to authenticated;

revoke execute on function public.get_venue_slots(uuid, date, text)
  from public, anon;
grant  execute on function public.get_venue_slots(uuid, date, text)
  to authenticated;
