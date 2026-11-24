-- Venue Partner, phase 1: venue owners (docs/VENUE_PARTNER_PLAN.md).
--
-- An owner signs in with the normal phone OTP, registers a venue (hidden as
-- 'pending' until an admin approves it) and edits its details. Admins can hand
-- an existing venue to an owner by phone number.
--
-- Roles reuse venue_staff: role 'owner' manages the venue, 'staff' (the
-- default, as before) runs the counter. Owners therefore also see Court Lights,
-- because can_manage_venue_lights only asks for a venue_staff row.

-- ------------------------------------------------------------------ roles ---

alter table public.venue_staff
  add column if not exists role text not null default 'staff';
alter table public.venue_staff drop constraint if exists venue_staff_role_check;
alter table public.venue_staff
  add constraint venue_staff_role_check check (role in ('owner', 'staff'));

create or replace function public.is_venue_owner(in_venue_id uuid, in_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select in_uid is not null and exists (
    select 1 from public.venue_staff s
     where s.venue_id = in_venue_id and s.user_id = in_uid and s.role = 'owner'
  );
$$;

create or replace function public.is_venue_member(in_venue_id uuid, in_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select in_uid is not null and exists (
    select 1 from public.venue_staff s
     where s.venue_id = in_venue_id and s.user_id = in_uid
  );
$$;

-- --------------------------------------------------------- venue reading ---

-- Pending and hidden venues were readable by every signed-in user, so a
-- venue an owner had just registered would show on the Venues tab before
-- approval. Now: approved for everyone, everything for admins, and a venue's
-- own owner/staff can read it.
drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues for select to authenticated
  using (
    status = 'approved'
    or public.is_admin()
    or public.is_venue_member(id, (select auth.uid()))
  );

-- ------------------------------------------------------ shared validation ---

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
  if in_open is null or in_close is null or in_close <= in_open then
    raise exception 'BAD_HOURS' using errcode = '23514';
  end if;
  if in_slot not in (30, 45, 60, 90, 120) then
    raise exception 'BAD_SLOT' using errcode = '23514';
  end if;
end;
$$;

-- --------------------------------------------------------------- register ---

create or replace function public.register_venue(
  in_name text, in_address text, in_lat double precision, in_lng double precision,
  in_phone text, in_sports text[], in_courts integer,
  in_open time, in_close time, in_slot integer
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  perform public.validate_venue_input(in_name, in_address, in_lat, in_lng, in_phone,
                                      in_sports, in_courts, in_open, in_close, in_slot);

  if exists (
    select 1 from public.venues v
     where lower(btrim(v.name)) = lower(btrim(in_name))
       and ST_DWithin(v.location,
                      ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography, 2000)
  ) then
    raise exception 'VENUE_EXISTS' using errcode = '23505';
  end if;

  if (select count(*) from public.venues v
        join public.venue_staff s on s.venue_id = v.id
       where s.user_id = v_uid and s.role = 'owner' and v.status = 'pending') >= 3 then
    raise exception 'TOO_MANY_PENDING' using errcode = '53400';
  end if;

  insert into public.venues (name, address, lat, lng, phone, sport_types, courts_count,
                             operating_hours_start, operating_hours_end, slot_duration_minutes,
                             status, created_by)
  values (btrim(in_name), nullif(btrim(coalesce(in_address, '')), ''), in_lat, in_lng,
          nullif(btrim(coalesce(in_phone, '')), ''), in_sports, in_courts,
          in_open, in_close, in_slot, 'pending', v_uid)
  returning id into v_id;

  insert into public.venue_staff (venue_id, user_id, added_by, role)
  values (v_id, v_uid, v_uid, 'owner');

  return v_id;
end;
$$;

-- ------------------------------------------------------------------- edit ---

create or replace function public.update_venue_details(
  in_venue_id uuid,
  in_name text, in_address text, in_lat double precision, in_lng double precision,
  in_phone text, in_sports text[], in_courts integer,
  in_open time, in_close time, in_slot integer,
  in_facilities text[], in_image_url text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not (public.is_venue_owner(in_venue_id, v_uid) or public.is_superadmin(v_uid)) then
    raise exception 'NOT_VENUE_OWNER' using errcode = '42501';
  end if;
  if not exists (select 1 from public.venues where id = in_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.validate_venue_input(in_name, in_address, in_lat, in_lng, in_phone,
                                      in_sports, in_courts, in_open, in_close, in_slot);
  if cardinality(coalesce(in_facilities, '{}')) > 20 then
    raise exception 'TOO_MANY_FACILITIES' using errcode = '23514';
  end if;
  -- Only photos in this venue's own folder of the public bucket.
  if in_image_url is not null
     and position('/venue-images/partner/' || in_venue_id::text || '/' in in_image_url) = 0 then
    raise exception 'BAD_IMAGE' using errcode = '23514';
  end if;

  update public.venues
     set name = btrim(in_name),
         address = nullif(btrim(coalesce(in_address, '')), ''),
         lat = in_lat,
         lng = in_lng,
         phone = nullif(btrim(coalesce(in_phone, '')), ''),
         sport_types = in_sports,
         courts_count = in_courts,
         operating_hours_start = in_open,
         operating_hours_end = in_close,
         slot_duration_minutes = in_slot,
         facilities = coalesce(in_facilities, '{}'),
         image_url = coalesce(in_image_url, image_url)
   where id = in_venue_id;
end;
$$;

-- ------------------------------------------------------------------- list ---

create or replace function public.list_my_partner_venues()
returns table (
  id uuid, name text, address text, lat double precision, lng double precision,
  phone text, sport_types text[], courts_count integer,
  operating_hours_start time, operating_hours_end time, slot_duration_minutes integer,
  facilities text[], image_url text, status text, role text
)
language sql stable security definer set search_path = public as $$
  select v.id, v.name, v.address, v.lat, v.lng, v.phone, v.sport_types,
         coalesce(v.courts_count, 1), v.operating_hours_start, v.operating_hours_end,
         v.slot_duration_minutes, v.facilities, v.image_url, v.status, s.role
    from public.venue_staff s
    join public.venues v on v.id = s.venue_id
   where s.user_id = (select auth.uid())
   order by (s.role = 'owner') desc, v.name;
$$;

-- ------------------------------------------------------------------ admin ---

create or replace function public.admin_assign_venue_owner(in_venue_id uuid, in_phone text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := (select auth.uid());
  v_digits text := right(regexp_replace(coalesce(in_phone, ''), '\D', '', 'g'), 10);
  v_user   uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin(v_uid) then raise exception 'NOT_SUPERADMIN' using errcode = '42501'; end if;
  if not exists (select 1 from public.venues where id = in_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if length(v_digits) <> 10 then raise exception 'INVALID_PHONE' using errcode = '22023'; end if;

  select p.id into v_user
    from public.profiles p
    left join auth.users u on u.id = p.id
   where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = v_digits
      or right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = v_digits
   limit 1;
  if v_user is null then raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.venue_staff (venue_id, user_id, added_by, role)
  values (in_venue_id, v_user, v_uid, 'owner')
  on conflict (venue_id, user_id) do update set role = 'owner';
end;
$$;

-- Owner names per venue, for the admin venue list.
create or replace function public.admin_list_venue_owners()
returns table (venue_id uuid, user_id uuid, owner_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_AN_ADMIN' using errcode = '42501'; end if;
  return query
    select s.venue_id, s.user_id, p.full_name
      from public.venue_staff s
      join public.profiles p on p.id = s.user_id
     where s.role = 'owner'
     order by p.full_name;
end;
$$;

-- ---------------------------------------------------------------- photos ---

-- Owners upload a cover photo to venue-images/partner/<venue_id>/...
drop policy if exists "venue_images_owner_write" on storage.objects;
create policy "venue_images_owner_write" on storage.objects for all to authenticated
  using (
    bucket_id = 'venue-images'
    and (storage.foldername(name))[1] = 'partner'
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and public.is_venue_owner(((storage.foldername(name))[2])::uuid, (select auth.uid()))
  )
  with check (
    bucket_id = 'venue-images'
    and (storage.foldername(name))[1] = 'partner'
    and (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
    and public.is_venue_owner(((storage.foldername(name))[2])::uuid, (select auth.uid()))
  );

-- ---------------------------------------------------------------- grants ---

revoke execute on function
  public.is_venue_owner(uuid, uuid),
  public.is_venue_member(uuid, uuid),
  public.validate_venue_input(text, text, double precision, double precision, text, text[],
                              integer, time, time, integer)
  from public, anon;
-- The venues and storage policies call these as the signed-in user.
grant execute on function public.is_venue_owner(uuid, uuid), public.is_venue_member(uuid, uuid)
  to authenticated;

revoke execute on function
  public.register_venue(text, text, double precision, double precision, text, text[],
                        integer, time, time, integer),
  public.update_venue_details(uuid, text, text, double precision, double precision, text,
                              text[], integer, time, time, integer, text[], text),
  public.list_my_partner_venues(),
  public.admin_assign_venue_owner(uuid, text),
  public.admin_list_venue_owners()
  from public, anon;
grant execute on function
  public.register_venue(text, text, double precision, double precision, text, text[],
                        integer, time, time, integer),
  public.update_venue_details(uuid, text, text, double precision, double precision, text,
                              text[], integer, time, time, integer, text[], text),
  public.list_my_partner_venues(),
  public.admin_assign_venue_owner(uuid, text),
  public.admin_list_venue_owners()
  to authenticated;
