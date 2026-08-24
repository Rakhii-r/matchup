-- 1. Match Offers never loaded, for anyone, ever.
--
-- The cause was mutually recursive RLS:
--   challenge_candidates_select     -> EXISTS (select from team_challenges ...)
--   team_challenges_select_offered  -> EXISTS (select from challenge_candidates ...)
-- Reading either table evaluated the other's policy, which evaluated the first
-- again; Postgres aborted the query with 42P17 "infinite recursion detected in
-- policy". No client-side change could have fixed it.
--
-- The cycle is broken by moving each cross-table lookup into a SECURITY DEFINER
-- helper: a definer function runs as the owner, so the inner read does not
-- re-enter the other table's policy. Both helpers still scope on auth.uid(),
-- so nothing is widened.

create or replace function public.is_offered_to_me(in_challenge_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.challenge_candidates cc
     where cc.challenge_id = in_challenge_id
       and public.is_team_member(cc.team_id, (select auth.uid()))
  );
$$;

create or replace function public.is_challenge_poster(in_challenge_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.team_challenges c
     where c.id = in_challenge_id
       and public.is_team_member(c.from_team_id, (select auth.uid()))
  );
$$;

revoke execute on function public.is_offered_to_me(uuid) from anon, public;
revoke execute on function public.is_challenge_poster(uuid) from anon, public;
grant execute on function public.is_offered_to_me(uuid) to authenticated;
grant execute on function public.is_challenge_poster(uuid) to authenticated;

drop policy if exists "challenge_candidates_select" on public.challenge_candidates;
create policy "challenge_candidates_select" on public.challenge_candidates for select
  using (
    public.is_team_member(team_id, (select auth.uid()))
    or public.is_challenge_poster(challenge_id)
  );

drop policy if exists "team_challenges_select_offered" on public.team_challenges;
create policy "team_challenges_select_offered" on public.team_challenges for select
  using (status = 'open' and public.is_offered_to_me(id));

-- 2. The poster could not see who their challenge was offered to.
--
-- `teams` is members-only, so embedding team:teams(name) from
-- challenge_candidates returns NULL for every candidate — the poster is not a
-- member of the teams they are matched against. This is the read model behind
-- the radar result and the poster-side Match Offers list.
drop function if exists public.get_challenge_candidates(uuid);
create or replace function public.get_challenge_candidates(in_challenge_id uuid)
returns table (
  candidate_id uuid, team_id uuid, team_name text, logo_url text, sport text,
  player_count integer, matches_played integer, wins integer, win_rate integer,
  rank integer, distance_m double precision, status text, responded_at timestamptz
) language sql stable security definer set search_path to 'public' as $function$
  with played as (
    select m.id as match_id, m.winner_team_id, cc.team_id
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
           coalesce(round(100.0 * count(*) filter (where winner_team_id = team_id)
             / nullif(count(*), 0)), 0)::integer as win_rate
      from played group by team_id
  )
  select cc.id, t.id, t.name, t.logo_url, t.sport,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         coalesce(agg.matches_played, 0), coalesce(agg.wins, 0), coalesce(agg.win_rate, 0),
         cc.rank, cc.distance_m, cc.status, cc.responded_at
    from public.challenge_candidates cc
    join public.teams t on t.id = cc.team_id
    left join agg on agg.team_id = cc.team_id
   where cc.challenge_id = in_challenge_id
     and public.is_challenge_poster(in_challenge_id)
   order by cc.rank;
$function$;

revoke execute on function public.get_challenge_candidates(uuid) from anon, public;
grant execute on function public.get_challenge_candidates(uuid) to authenticated;
