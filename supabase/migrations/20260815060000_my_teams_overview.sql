-- One call for the Teams tab.
--
-- The tab previously rendered a card per team and each card called
-- get_team_overview + get_team_stats for itself, so listing N teams cost
-- 1 + 2N round trips. This returns the same figures for every team the caller
-- belongs to in a single query: the membership rows are collected once and the
-- counts, results and win rate are aggregated against that set rather than
-- re-derived per team.
--
-- Security: the `mine` CTE is the only entry point and it filters on
-- auth.uid(), so a caller can never see a team they are not a member of. That
-- is why no is_team_member() guard is repeated below — membership is the join.

create or replace function public.get_my_teams_overview()
returns table (
  id uuid,
  name text,
  sport text,
  invite_code text,
  logo_url text,
  home_ground text,
  player_count integer,
  my_role text,
  i_am_owner boolean,
  matches_played integer,
  wins integer,
  losses integer,
  ties integer,
  win_rate integer
) language sql stable security definer set search_path to 'public' as $function$
  with mine as (
    select t.id, t.name, t.sport, t.invite_code, t.logo_url, t.home_ground,
           t.owner_id, tm.role as my_role
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where tm.user_id = (select auth.uid())
  ),
  counts as (
    select tm.team_id, count(*)::integer as player_count
      from public.team_members tm
      join mine m on m.id = tm.team_id
     group by tm.team_id
  ),
  played as (
    select m.id as team_id, mt.winner_team_id
      from mine m
      join public.matches mt
        on mt.team_a_id = m.id or mt.team_b_id = m.id
     where mt.status = 'completed'
  ),
  agg as (
    select team_id,
           count(*)::integer as matches_played,
           count(*) filter (where winner_team_id = team_id)::integer as wins,
           count(*) filter (
             where winner_team_id is not null and winner_team_id <> team_id
           )::integer as losses,
           count(*) filter (where winner_team_id is null)::integer as ties,
           coalesce(round(
             100.0 * count(*) filter (where winner_team_id = team_id)
             / nullif(count(*), 0)
           ), 0)::integer as win_rate
      from played
     group by team_id
  )
  select mine.id, mine.name, mine.sport, mine.invite_code, mine.logo_url,
         mine.home_ground,
         coalesce(counts.player_count, 0),
         mine.my_role,
         mine.owner_id = (select auth.uid()),
         coalesce(agg.matches_played, 0),
         coalesce(agg.wins, 0),
         coalesce(agg.losses, 0),
         coalesce(agg.ties, 0),
         coalesce(agg.win_rate, 0)
    from mine
    left join counts on counts.team_id = mine.id
    left join agg on agg.team_id = mine.id
   order by mine.name;
$function$;

revoke execute on function public.get_my_teams_overview() from anon, public;
grant execute on function public.get_my_teams_overview() to authenticated;
