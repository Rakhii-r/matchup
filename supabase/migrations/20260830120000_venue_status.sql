-- Venues need an approval state, and the picker needs to honour it.
--
-- WHY: the picker offered every row in `venues` — 5 Pune seed rows ~500km from
-- any real user and one row at lat/lng 0,0. Users tagged them: of 9 real venue
-- tags, 1 points at the null-island row and 1 at Pune seed data. Junk got
-- tagged because junk was SELECTABLE, not because anything validated badly.
-- Filtering the picker's candidate set is the fix; validating a submission form
-- would not have stopped any of the 2 bad tags that already exist.
--
-- NOT DELETING the bad rows. `matches_venue_id_fkey` is ON DELETE SET NULL, so
-- a delete would silently un-tag the 2 live matches that point at them — no
-- error, and the captains would never be told. Hidden rows keep those tags
-- readable while staying out of every picker.
--
-- Default is 'approved', not 'pending': inserting into `venues` is already
-- admin-only (policy `venues_admin_all` = is_admin()), so an admin adding a
-- ground through app/admin/venues.tsx must keep working exactly as it does
-- today. The captain suggestion path writes 'pending' explicitly.

alter table public.venues
  add column if not exists status text not null default 'approved';

alter table public.venues
  drop constraint if exists venues_status_check;
alter table public.venues
  add constraint venues_status_check
  check (status in ('approved', 'pending', 'hidden'));

-- Null island: no distance query can ever return it, and one match is tagged
-- to it.
update public.venues
   set status = 'hidden'
 where lat = 0 and lng = 0;

-- Seed data from another city. Keyed on distance from Hyderabad rather than on
-- names, so this stays correct if a seed row is renamed.
update public.venues
   set status = 'hidden'
 where status = 'approved'
   and not ST_DWithin(
         location,
         ST_SetSRID(ST_MakePoint(78.4867, 17.3850), 4326)::geography,
         100000
       );

-- Rebuilt from prod's current body (pg_get_functiondef, 30 Aug) with ONE line
-- added. The RETURNS TABLE is unchanged on purpose: `status` is not exposed, so
-- NearbyVenue in venueRepository.ts and database.types.ts stay correct.
create or replace function public.nearby_venues(
  in_lat      double precision,
  in_lng      double precision,
  in_radius_m integer default 25000,
  in_sport    text default null
)
returns table (
  id uuid, name text, address text, lat double precision, lng double precision,
  sport_types text[], phone text, confirm_note text, image_url text,
  rating numeric, rating_count integer, price_per_hour integer,
  facilities text[], distance_m double precision
)
language sql
stable
set search_path to 'public'
as $function$
  select v.id, v.name, v.address, v.lat, v.lng, v.sport_types, v.phone,
         v.confirm_note, v.image_url, v.rating, v.rating_count,
         v.price_per_hour, v.facilities,
         ST_Distance(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
         ) as distance_m
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
