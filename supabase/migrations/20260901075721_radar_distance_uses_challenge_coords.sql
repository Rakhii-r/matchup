-- The radar measured distance from the VENUE only. The create wizard captures
-- an AREA and defers the ground, so most open challenges have venue_id NULL --
-- and for those, v.location is NULL, which meant:
--
--   * distance_m fell through to 0, so every venue-less challenge rendered as
--     "0 m away" and sorted as if it were next door;
--   * the radius test `or v.location is null` let them ALL through, so the
--     radius the user picked was silently ignored for most of the list.
--
-- The coordinates were there the whole time in c.match_lat / c.match_lng (NOT
-- c.lat/c.lng -- team_challenges names them differently to matches). Same class
-- as the venues join that hid challenges in list_my_challenges.
create or replace function public.list_open_challenges_nearby(
  in_lat double precision default null,
  in_lng double precision default null,
  in_radius_m integer default 50000,
  in_sport text default null
)
returns table (
  challenge_id uuid, match_name text, from_team_id uuid, from_team_name text,
  from_team_logo text, sport text, venue_id uuid, venue_name text, area_name text,
  scheduled_at timestamptz, total_slots integer, message text,
  distance_m double precision, created_at timestamptz, applied_status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_user_loc geography := null;
begin
  if in_lat is not null and in_lng is not null then
    v_user_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  with rows_with_loc as (
    select
      c.*,
      t.name as t_name, t.logo_url as t_logo, t.sport as t_sport, t.owner_id as t_owner,
      v.name as v_name, v.address as v_address,
      -- The ground if one is set, otherwise the area the organiser chose.
      coalesce(
        v.location,
        case
          when c.match_lat is not null and c.match_lng is not null
            then ST_SetSRID(ST_MakePoint(c.match_lng, c.match_lat), 4326)::geography
        end
      ) as loc
    from public.team_challenges c
    join public.teams t on t.id = c.from_team_id
    left join public.venues v on v.id = c.venue_id
  )
  select
    r.id as challenge_id,
    r.match_name,
    r.from_team_id,
    r.t_name as from_team_name,
    r.t_logo as from_team_logo,
    r.t_sport as sport,
    r.venue_id,
    coalesce(r.v_name, r.area_name, 'Local Area') as venue_name,
    coalesce(r.area_name, r.v_address, 'Local Area') as area_name,
    r.scheduled_at,
    r.total_slots,
    r.message,
    case
      when v_user_loc is not null and r.loc is not null then ST_Distance(v_user_loc, r.loc)
      else 0::double precision
    end as distance_m,
    r.created_at,
    (
      select cc.status
        from public.challenge_candidates cc
        join public.teams my_t on my_t.id = cc.team_id
       where cc.challenge_id = r.id
         and my_t.owner_id = v_uid
       order by cc.created_at desc
       limit 1
    ) as applied_status
  from rows_with_loc r
  where r.status = 'open'
    and r.scheduled_at > now()
    and (in_sport is null or r.t_sport = in_sport)
    -- You cannot play yourself: not your team, and not a team you are in.
    and r.t_owner <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.team_members tm
       where tm.team_id = r.from_team_id and tm.user_id = v_uid
    )
    and (
      v_user_loc is null
      -- A challenge with no venue AND no coordinates still shows: dropping it
      -- would hide a real fixture over missing metadata.
      or r.loc is null
      or ST_DWithin(v_user_loc, r.loc, in_radius_m)
    )
  order by r.scheduled_at asc
  limit 50;
end;
$function$;

revoke execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text) from anon;
