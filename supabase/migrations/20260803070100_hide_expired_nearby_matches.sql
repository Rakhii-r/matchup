-- Do not show historical matches in Nearby merely because their organiser
-- forgot to change the status from `open`. A six-hour window preserves matches
-- that are currently being played while removing stale rows.
create or replace function public.nearby_matches(
  in_lat       double precision,
  in_lng       double precision,
  in_radius_m  integer default 5000,
  in_sport     text default null
)
returns setof public.matches
language sql stable security definer set search_path = public as $$
  select m.*
  from public.matches m
  where m.status = 'open'
    and m.scheduled_at > now() - interval '6 hours'
    and (in_sport is null or m.sport = in_sport)
    and ST_DWithin(
          m.location,
          ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
          in_radius_m)
    and not public.is_blocked_between(auth.uid(), m.creator_id)
  order by m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
  limit 50;
$$;

-- CREATE OR REPLACE preserves the existing grants, but make the intended
-- authenticated-only access explicit for fresh and restored environments.
revoke execute on function public.nearby_matches(double precision, double precision, integer, text)
  from anon, public;
grant execute on function public.nearby_matches(double precision, double precision, integer, text)
  to authenticated;
