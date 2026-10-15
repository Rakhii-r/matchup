-- Two holes in the openings read model, both of which showed up as "no area" on
-- the Teams-needing-players card.
--
-- 1. AREA WAS NEVER POPULATED. The card's location line reads `home_ground`, a
--    free-text field on `teams` that nothing in the app ever writes -- it is
--    null on every team in production. The area a squad actually plays in lives
--    on the captain's profile (`profiles.area_name`), which is what the radar
--    already measures and labels from. So the row now carries `area_name` as
--    well, and the client falls back to it.
--
-- 2. THE NEXT FIXTURE WAS FILTERED OUT BY STATUS. The lateral accepted only
--    `matches.status = 'open'`. A team-versus-team fixture is never 'open' --
--    accepting a challenge writes it straight to 'locked' -- so the one thing a
--    joiner most wants to see (a real, confirmed game) was excluded by
--    construction, and every card fell through to "No game scheduled yet".
--    'open' is kept for a team fixture still gathering players.
--
-- Exposing a 'locked' fixture's time and area to a non-member is deliberate:
-- this function is SECURITY DEFINER and the team is publicly advertising for
-- players, so when and where it plays is exactly the information the ask-to-join
-- decision turns on. Nothing else about the match crosses -- no id, no opponent,
-- no sheet -- so a stranger still cannot reach the fixture itself.
drop function if exists public.list_teams_needing_players(double precision, double precision, integer, text);

create function public.list_teams_needing_players(
  in_lat double precision default null,
  in_lng double precision default null,
  in_radius_m integer default 25000,
  in_sport text default null
)
returns table (
  team_id uuid, name text, sport text, logo_url text, home_ground text,
  area_name text,
  player_count integer, target_size integer, slots_left integer,
  captain_name text, distance_m double precision, my_request_status text,
  next_game_at timestamptz, next_game_where text, next_game_kind text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_loc geography := null;
begin
  if in_lat is not null and in_lng is not null then
    v_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  with counted as (
    select t.*,
           (select count(*) from public.team_members tm where tm.team_id = t.id)::integer as n,
           p.full_name as cap_name,
           p.area_name as cap_area,
           case
             when p.home_lat is not null and p.home_lng is not null
               then ST_SetSRID(ST_MakePoint(p.home_lng, p.home_lat), 4326)::geography
           end as cap_loc
      from public.teams t
      join public.profiles p on p.id = t.owner_id
     where t.target_size is not null
  )
  select c.id, c.name, c.sport, c.logo_url,
         nullif(btrim(c.home_ground), ''),
         nullif(btrim(c.cap_area), ''),
         c.n, c.target_size, (c.target_size - c.n)::integer,
         c.cap_name,
         case when v_loc is not null and c.cap_loc is not null
              then ST_Distance(v_loc, c.cap_loc) else 0::double precision end,
         (select r.status from public.team_join_requests r
           where r.team_id = c.id and r.user_id = v_uid
           order by r.created_at desc limit 1),
         g.at, g.where_, g.kind
    from counted c
    left join lateral (
      -- Earliest upcoming fixture, whether it is a confirmed game or still a
      -- challenge looking for an opponent. Both are things a joiner would turn
      -- up to, so both count.
      select * from (
        select m.scheduled_at as at,
               coalesce(nullif(btrim(m.venue_text), ''), nullif(btrim(m.area_name), '')) as where_,
               'match'::text as kind
          from public.matches m
         where (m.team_a_id = c.id or m.team_b_id = c.id)
           and m.status in ('open', 'locked')
           and m.scheduled_at > now()
        union all
        select ch.scheduled_at,
               coalesce(
                 (select v.name from public.venues v where v.id = ch.venue_id),
                 nullif(btrim(ch.area_name), '')
               ),
               'challenge'::text
          from public.team_challenges ch
         where ch.from_team_id = c.id
           and ch.status = 'open'
           and ch.scheduled_at > now()
      ) both_sources
      order by at asc
      limit 1
    ) g on true
   where c.n < c.target_size
     and (in_sport is null or c.sport = in_sport)
     -- Not a team you are already in, and not your own.
     and c.owner_id <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
     and not exists (
       select 1 from public.team_members tm
        where tm.team_id = c.id and tm.user_id = v_uid
     )
     and (v_loc is null or c.cap_loc is null or ST_DWithin(v_loc, c.cap_loc, in_radius_m))
   -- A squad with a game on the books first: that is the one you can actually
   -- turn up to. Then nearest, then name.
   order by (g.at is not null) desc,
            (v_loc is not null and c.cap_loc is not null) desc,
            case when v_loc is not null and c.cap_loc is not null
                 then ST_Distance(v_loc, c.cap_loc) else 0 end asc,
            c.name asc
   limit 50;
end;
$function$;

revoke execute on function public.list_teams_needing_players(double precision, double precision, integer, text) from anon;
