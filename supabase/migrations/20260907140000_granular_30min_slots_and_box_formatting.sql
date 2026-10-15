-- Migration: 20260907140000_granular_30min_slots_and_box_formatting.sql
-- Description: 30-Minute Granular Time Slots (Playo-Style) & Dynamic Box/Court Formatting
--              Updates default slot duration to 30 minutes, updates existing venues,
--              enhances get_venue_slots with dynamic Box/Court labels and 30m fallback,
--              and enhances book_venue_slot with 30m alignment validation and match updating.

-- 1. Update venues table default and existing venues to 30-minute slot duration
alter table public.venues
  alter column slot_duration_minutes set default 30;

update public.venues
   set slot_duration_minutes = 30
 where slot_duration_minutes <> 30;

-- 2. Stored Procedure: book_venue_slot
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

  -- Validate start_time aligns to 30-minute boundary (e.g. :00 or :30)
  v_offset_min := round(extract(epoch from (in_start_time - date_trunc('hour', in_start_time))) / 60)::integer;
  if (v_offset_min % 30) <> 0 then
    raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
  end if;

  -- Allow duration in positive multiples of 30 minutes (e.g. 30m, 60m, 90m, 120m, 150m, 180m)
  v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer;
  if v_dur_min <= 0 or (v_dur_min % 30 <> 0) then
    raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
  end if;

  -- 24-hour round-the-clock checks
  v_local_start := (in_start_time at time zone v_tz)::time;
  v_local_end   := (in_end_time at time zone v_tz)::time;

  -- Check operating hours if venue has custom restricted hours
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

  -- 6. Insert confirmed booking (exclusion constraint catches overlapping confirmed ranges)
  begin
    insert into public.venue_bookings (
      venue_id,
      court_number,
      user_id,
      match_id,
      start_time,
      end_time,
      status,
      notes
    ) values (
      in_venue_id,
      in_court_number,
      v_uid,
      in_match_id,
      in_start_time,
      in_end_time,
      'confirmed',
      in_notes
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
  end;

  -- 7. Update match record if match_id was provided
  if in_match_id is not null then
    update public.matches
    set venue_id = in_venue_id,
        scheduled_at = in_start_time,
        end_time = in_end_time,
        venue_text = coalesce(v_venue.name, venue_text)
    where id = in_match_id;
  end if;

  return v_booking;
end;
$$;

-- 3. Stored Procedure: get_venue_slots (30-Minute Dynamic Slot Grid with Box Formatting)
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
  v_venue       public.venues%rowtype;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_step        interval;
  v_tz          text;
  v_label_prefix text := 'Court ';
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

  -- Default step size fallback to 30 minutes
  v_step := (coalesce(nullif(v_venue.slot_duration_minutes, 0), 30) || ' minutes')::interval;

  if v_day_start >= v_day_end or v_step <= interval '0 minutes' then
    return;
  end if;

  -- Determine Box vs Court prefix
  if exists (
    select 1
    from unnest(coalesce(v_venue.sport_types, array[]::text[])) as s
    where s = 'box_cricket' or s ilike '%cricket%' or s ilike '%turf%' or s ilike '%box%'
  ) then
    v_label_prefix := 'Box ';
  else
    v_label_prefix := 'Court ';
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
      v_label_prefix || c.c_num as court_label,
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

revoke execute on function public.book_venue_slot(uuid, integer, timestamptz, timestamptz, uuid, text) from public;
grant  execute on function public.book_venue_slot(uuid, integer, timestamptz, timestamptz, uuid, text) to authenticated;

revoke execute on function public.get_venue_slots(uuid, date, text) from public;
grant  execute on function public.get_venue_slots(uuid, date, text) to authenticated;
