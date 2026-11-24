-- Court bookings in whole hours only (owner's call, 23 Nov 2026).
--
-- Start times are on the hour (IST) and a booking lasts 1, 2, 3... hours.
-- Every venue's slot grid becomes 60 minutes, owners can no longer pick
-- another slot length, and opening/closing times must be on the hour so the
-- grid lines up. Existing half-hour bookings are left as they are.
--
-- The hour is checked in Asia/Kolkata: IST is UTC+5:30, so 11:00 IST is
-- 05:30 UTC and a UTC "on the hour" check would refuse every real slot.

update public.venues set slot_duration_minutes = 60 where slot_duration_minutes <> 60;
alter table public.venues alter column slot_duration_minutes set default 60;

create or replace function public.validate_venue_input(
  in_name text, in_address text, in_lat double precision, in_lng double precision,
  in_phone text, in_sports text[], in_courts integer,
  in_open time, in_close time, in_slot integer
)
returns void language plpgsql stable set search_path = public as $$
begin
  if char_length(btrim(coalesce(in_name, ''))) < 2 then
    raise exception 'NAME_TOO_SHORT' using errcode = '23514';
  end if;
  if char_length(btrim(in_name)) > 80 then
    raise exception 'NAME_TOO_LONG' using errcode = '23514';
  end if;
  if in_address is not null and char_length(btrim(in_address)) > 160 then
    raise exception 'ADDRESS_TOO_LONG' using errcode = '23514';
  end if;
  if in_lat is null or in_lng is null
     or (in_lat = 0 and in_lng = 0)
     or in_lat < -90 or in_lat > 90 or in_lng < -180 or in_lng > 180 then
    raise exception 'BAD_COORDS' using errcode = '23514';
  end if;
  if in_phone is not null
     and length(regexp_replace(in_phone, '\D', '', 'g')) not between 10 and 13 then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  if in_sports is null or cardinality(in_sports) = 0 or exists (
    select 1 from unnest(in_sports) s
     where not exists (select 1 from public.sports x where x.sport = s and x.is_active)
  ) then
    raise exception 'UNKNOWN_SPORT' using errcode = '23514';
  end if;
  if in_courts is null or in_courts < 1 or in_courts > 20 then
    raise exception 'BAD_COURTS' using errcode = '23514';
  end if;
  if in_open is null or in_close is null or in_close <= in_open
     or extract(minute from in_open) <> 0 or extract(second from in_open) <> 0
     or extract(minute from in_close) <> 0 or extract(second from in_close) <> 0 then
    raise exception 'BAD_HOURS' using errcode = '23514';
  end if;
  if in_slot <> 60 then
    raise exception 'BAD_SLOT' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.book_venue_slot(
  in_venue_id uuid, in_court_number integer,
  in_start_time timestamptz, in_end_time timestamptz,
  in_match_id uuid default null, in_notes text default null
)
returns public.venue_bookings
language plpgsql security definer set search_path = public as $$
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
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_venue from public.venues where id = in_venue_id;
  if not found or v_venue.status in ('hidden', 'rejected') then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if in_court_number < 1 or in_court_number > v_venue.courts_count then
    raise exception 'INVALID_COURT_NUMBER' using errcode = '23514';
  end if;

  if in_end_time <= in_start_time then
    raise exception 'INVALID_TIME_RANGE' using errcode = '23514';
  end if;
  if in_start_time <= now() then
    raise exception 'CANNOT_BOOK_PAST' using errcode = '23514';
  end if;

  -- Whole hours only: start on the hour in IST, length a multiple of 60 min.
  if extract(minute from (in_start_time at time zone v_tz)) <> 0
     or extract(second from (in_start_time at time zone v_tz)) <> 0 then
    raise exception 'UNALIGNED_SLOT_START' using errcode = '23514';
  end if;
  v_dur_min := round(extract(epoch from (in_end_time - in_start_time)) / 60)::integer;
  if v_dur_min <= 0 or (v_dur_min % 60 <> 0) then
    raise exception 'INVALID_SLOT_DURATION' using errcode = '23514';
  end if;

  v_local_start := (in_start_time at time zone v_tz)::time;
  v_local_end   := (in_end_time at time zone v_tz)::time;

  if v_venue.operating_hours_start <> '00:00:00' or v_venue.operating_hours_end <> '24:00:00' then
    if v_local_start < v_venue.operating_hours_start or v_local_end > v_venue.operating_hours_end then
      raise exception 'OUTSIDE_OPERATING_HOURS' using errcode = '23514';
    end if;
  end if;

  if in_notes is not null and char_length(in_notes) > 280 then
    raise exception 'NOTES_TOO_LONG' using errcode = '23514';
  end if;

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

  select id into v_other from public.venues where id = in_venue_id for update;

  begin
    insert into public.venue_bookings (
      venue_id, court_number, user_id, match_id, start_time, end_time, status, notes
    ) values (
      in_venue_id, in_court_number, v_uid, in_match_id, in_start_time, in_end_time,
      'confirmed', in_notes
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception 'SLOT_ALREADY_TAKEN' using errcode = '23P01';
  end;

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
