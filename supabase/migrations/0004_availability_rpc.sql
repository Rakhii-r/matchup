-- ============================================================================
-- MatchUp — "I'm available today" discovery RPC.
-- Mirrors nearby_matches: radius + sport filtered, block-aware, distance-ordered.
-- Only returns rows that are for today and not yet expired, excluding the caller.
-- ============================================================================
create or replace function public.nearby_available(
  in_lat       double precision,
  in_lng       double precision,
  in_radius_m  integer default 5000,
  in_sport     text default null
)
returns setof public.availability
language sql stable security definer set search_path = public as $$
  select a.*
  from public.availability a
  where a.available_date = current_date
    and a.expires_at > now()
    and (in_sport is null or a.sport = in_sport)
    and a.user_id <> auth.uid()
    and ST_DWithin(
          a.location,
          ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
          in_radius_m)
    and not public.is_blocked_between(auth.uid(), a.user_id)
  order by a.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
  limit 100;
$$;
