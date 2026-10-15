-- Venues near a point, for the area-scoped venue picker.
--
-- venueRepository.list() fetches every venue ordered by name. That is fine for
-- the 7-row admin table and useless for a picker that must show the grounds
-- near the area the organiser already chose at wizard step 2.
--
-- SECURITY INVOKER on purpose. Every other RPC in this project is SECURITY
-- DEFINER because it writes or reads across users, but public.venues carries a
-- `venues_select` policy of `true` -- the directory is world-readable -- so this
-- needs no elevation. The advisor already logs 68
-- `authenticated_security_definer_function_executable` warnings; do not add a
-- 69th for a function that reads a public table.
--
-- venues.location is geography (not geometry), so the probe point must be cast
-- ::geography. venues_location_gix already indexes it and ST_DWithin on
-- geography uses that index.
--
-- Ranking is distance, then rating, then name. Deliberately NO featured /
-- bookable / verified tier: there are no columns behind those and no booking
-- integration, and a badge the data cannot back is worse than no badge.

create or replace function public.nearby_venues(
  in_lat double precision,
  in_lng double precision,
  in_radius_m integer default 25000,
  in_sport text default null
)
returns table (
  id             uuid,
  name           text,
  address        text,
  lat            double precision,
  lng            double precision,
  sport_types    text[],
  phone          text,
  confirm_note   text,
  image_url      text,
  rating         numeric,
  rating_count   integer,
  price_per_hour integer,
  facilities     text[],
  distance_m     double precision
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
   where (in_sport is null or in_sport = any (v.sport_types))
     and ST_DWithin(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
           in_radius_m
         )
   order by distance_m asc, v.rating desc nulls last, v.name asc;
$function$;

-- New functions get an implicit EXECUTE to PUBLIC, which would hand this to
-- anon as well. Revoke first so the grant below is the whole story.
revoke execute on function public.nearby_venues(double precision, double precision, integer, text)
  from public, anon;
grant  execute on function public.nearby_venues(double precision, double precision, integer, text)
  to authenticated;
