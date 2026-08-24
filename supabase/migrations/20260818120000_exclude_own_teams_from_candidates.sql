-- Exclude teams owned by the challenger or sharing squad members with the challenger
-- from open challenge candidate matching.

create or replace function public.rank_challenge_candidates(
  in_challenge_id uuid,
  in_radius_m     integer default 25000,
  in_limit        integer default 5
)
returns table (team_id uuid, distance_m double precision, rank integer)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select ch.id,
           ch.from_team_id,
           ch.created_by,
           ch.scheduled_at,
           ch.total_slots,
           ft.sport   as sport,
           v.location as venue_location
      from public.team_challenges ch
      join public.teams  ft on ft.id = ch.from_team_id
      join public.venues v  on v.id  = ch.venue_id
     where ch.id = in_challenge_id
  ),
  eligible as (
    select t.id as team_id,
           ST_Distance(tl.loc, c.venue_location) as distance_m
      from public.teams t
      cross join c
      -- LATERAL so team_location is evaluated once per team, not once per reference.
      join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
     where t.id <> c.from_team_id
       -- Cannot challenge your own team, or another team you own
       and t.owner_id <> c.created_by
       -- Cannot challenge a team where the challenger is a squad member
       and not public.is_team_member(t.id, c.created_by)
       -- Cannot challenge a team that shares players with the challenger squad
       and not exists (
         select 1
           from public.team_members tm1
           join public.team_members tm2 on tm1.user_id = tm2.user_id
          where tm1.team_id = c.from_team_id
            and tm2.team_id = t.id
       )
       and t.sport = c.sport
       and public.is_active_user(t.owner_id)
       and not public.is_blocked_between(t.owner_id, c.created_by)
       and ST_DWithin(tl.loc, c.venue_location, in_radius_m)
       -- Both squads must fit on one sheet.
       and (
         (select count(distinct tm.user_id) from public.team_members tm
           where tm.team_id in (t.id, c.from_team_id))
         <= c.total_slots
       )
       -- Not already committed to a match within three hours either side.
       and not exists (
         select 1
           from public.matches m
           join public.match_players mp on mp.match_id = m.id
           join public.team_members  tm on tm.user_id  = mp.user_id
          where tm.team_id = t.id
            and mp.status = 'confirmed'
            and m.scheduled_at between c.scheduled_at - interval '3 hours'
                                   and c.scheduled_at + interval '3 hours'
       )
  )
  select e.team_id,
         e.distance_m,
         (row_number() over (order by e.distance_m asc, e.team_id asc))::integer as rank
    from eligible e
   order by e.distance_m asc, e.team_id asc
   limit greatest(in_limit, 0);
$$;

revoke execute on function public.rank_challenge_candidates(uuid, integer, integer) from anon, public;
grant  execute on function public.rank_challenge_candidates(uuid, integer, integer) to authenticated;
