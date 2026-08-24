-- Changing the OUT columns changes the return type, which create-or-replace
-- cannot do; the old signature must be dropped first.
drop function if exists public.get_challenge_candidates(uuid);

-- `losses` / `ties`: "View Details" shows played / won / lost / win rate. Those
-- were the figures the read model did not carry, so the screen fell back to
-- fetching the team itself — and `teams` is members-only, which is why it failed
-- with "Unable to load team". With them here the detail view needs no query.
--
-- `i_own_team`: accept_open_challenge requires the ACCEPTING team's owner. A user
-- CAN own a candidate team (own two teams and one may be matched against the
-- other), so the client must know which cards it may act on. It cannot derive
-- this itself — `teams` is members-only, so the poster cannot read owner_id for
-- candidate teams.
create function public.get_challenge_candidates(in_challenge_id uuid)
returns table (
  candidate_id uuid, team_id uuid, team_name text, logo_url text, sport text,
  player_count integer, matches_played integer, wins integer, losses integer,
  ties integer, win_rate integer, rank integer, distance_m double precision,
  status text, responded_at timestamptz, i_own_team boolean
) language sql stable security definer set search_path to 'public' as $function$
  with played as (
    select m.winner_team_id, cc.team_id
      from public.challenge_candidates cc
      join public.matches m
        on (m.team_a_id = cc.team_id or m.team_b_id = cc.team_id)
       and m.status = 'completed'
     where cc.challenge_id = in_challenge_id
  ),
  agg as (
    select team_id,
           count(*)::integer as matches_played,
           count(*) filter (where winner_team_id = team_id)::integer as wins,
           count(*) filter (
             where winner_team_id is not null and winner_team_id <> team_id
           )::integer as losses,
           count(*) filter (where winner_team_id is null)::integer as ties,
           coalesce(round(100.0 * count(*) filter (where winner_team_id = team_id)
             / nullif(count(*), 0)), 0)::integer as win_rate
      from played group by team_id
  )
  select cc.id, t.id, t.name, t.logo_url, t.sport,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         coalesce(agg.matches_played, 0), coalesce(agg.wins, 0),
         coalesce(agg.losses, 0), coalesce(agg.ties, 0), coalesce(agg.win_rate, 0),
         cc.rank, cc.distance_m, cc.status, cc.responded_at,
         t.owner_id = (select auth.uid())
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
    left join agg on agg.team_id = cc.team_id
   where cc.challenge_id = in_challenge_id
     and public.is_challenge_poster(in_challenge_id)
   order by cc.rank;
$function$;

revoke execute on function public.get_challenge_candidates(uuid) from anon, public;
grant execute on function public.get_challenge_candidates(uuid) to authenticated;
