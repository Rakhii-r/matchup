-- Captains can add the ground they actually play at.
--
-- WHY: after 20260830120000 exactly ONE venue is approved, so the picker is
-- nearly empty and always will be until real grounds get in. These are private
-- turfs: they are not in Google Places or OSM in usable form, and Google's terms
-- forbid storing Places content in this table anyway. The people who know where
-- the turfs are, are the captains playing on them.
--
-- Coordinates come from the DEVICE, not a geocoder: the captain adds the ground
-- while standing at it, so the pin is exact and the app needs no map API, no
-- key and no third-party terms. That is why in_lat/in_lng are required here
-- rather than an address being resolved server-side.
--
-- Suggestions land as status='pending' and are invisible to every picker
-- (nearby_venues filters on 'approved'). An admin approves them in
-- app/admin/venues.tsx. At the volume this will see, eyeballing each one costs
-- seconds and guarantees no junk reaches a picker.

alter table public.venues
  add column if not exists suggested_by uuid references public.profiles(id) on delete set null;

create or replace function public.suggest_venue(
  in_name    text,
  in_address text,
  in_lat     double precision,
  in_lng     double precision,
  in_sport   text
)
returns public.venues
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_address text;
  v_pending int;
  v_row     public.venues%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  v_name    := btrim(coalesce(in_name, ''));
  v_address := nullif(btrim(coalesce(in_address, '')), '');

  if char_length(v_name) < 2 then
    raise exception 'NAME_TOO_SHORT' using errcode = '23514';
  end if;
  -- venues_name_len caps at 80, venues_address_len at 160. Checked here so the
  -- user gets a named error instead of a raw constraint violation.
  if char_length(v_name) > 80 then
    raise exception 'NAME_TOO_LONG' using errcode = '23514';
  end if;
  if v_address is not null and char_length(v_address) > 160 then
    raise exception 'ADDRESS_TOO_LONG' using errcode = '23514';
  end if;

  if in_lat is null or in_lng is null then
    raise exception 'LOCATION_REQUIRED' using errcode = '23514';
  end if;
  -- 0,0 is how `varak box` got into this table and why it never appeared in a
  -- distance query. It is the single most likely bad value, so name it.
  if (in_lat = 0 and in_lng = 0)
     or in_lat < -90 or in_lat > 90 or in_lng < -180 or in_lng > 180 then
    raise exception 'BAD_COORDS' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.sports s where s.sport = in_sport and s.is_active
  ) then
    raise exception 'UNKNOWN_SPORT' using errcode = '23514';
  end if;

  -- Same ground, already known. Name match within 2km catches the realistic
  -- duplicate without blocking two genuinely different turfs on one road.
  if exists (
    select 1
      from public.venues v
     where lower(btrim(v.name)) = lower(v_name)
       and ST_DWithin(
             v.location,
             ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
             2000
           )
  ) then
    raise exception 'VENUE_EXISTS' using errcode = '23505';
  end if;

  select count(*) into v_pending
    from public.venues v
   where v.suggested_by = v_uid and v.status = 'pending';
  if v_pending >= 5 then
    raise exception 'TOO_MANY_PENDING' using errcode = '53400';
  end if;

  -- `location` is GENERATED ALWAYS from lat/lng, so it must not be inserted.
  insert into public.venues (name, address, lat, lng, sport_types, status, suggested_by, created_by)
  values (v_name, v_address, in_lat, in_lng, array[in_sport], 'pending', v_uid, v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.suggest_venue(text, text, double precision, double precision, text)
  from public, anon;
grant execute on function public.suggest_venue(text, text, double precision, double precision, text)
  to authenticated;

-- Approve / hide a suggestion. Admin-only, mirroring the venues_admin_all
-- policy the admin screen already relies on.
create or replace function public.set_venue_status(
  in_venue_id uuid,
  in_status   text
)
returns public.venues
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.venues%rowtype;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'NOT_AN_ADMIN' using errcode = '42501';
  end if;
  if in_status not in ('approved', 'pending', 'hidden') then
    raise exception 'BAD_STATUS' using errcode = '23514';
  end if;

  update public.venues set status = in_status
   where id = in_venue_id
  returning * into v_row;

  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_venue_status(uuid, text) from public, anon;
grant execute on function public.set_venue_status(uuid, text) to authenticated;
