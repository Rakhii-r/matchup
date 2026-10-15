-- ============================================================================
-- Capture of four dashboard RPCs that existed only in the deployed database.
--
-- get_player_stats, get_my_next_match, get_my_recent_matches and
-- get_player_batting_history were created directly against the project and
-- never written down, so a database rebuilt from this folder (a new
-- environment, a restore, a Supabase branch) came up without them and Home and
-- Profile failed. The bodies below are pg_get_functiondef() output from the
-- live project on 2 Oct 2026, unchanged.
--
-- Not applied through the migration tool, because the functions already exist
-- there. `create or replace` makes it a no-op if `supabase db push` runs it.
-- ============================================================================

create or replace function public.get_player_stats(in_user_id uuid default null::uuid)
 returns table(user_id uuid, full_name text, area_name text, avatar_url text, playing_role text, matches_played integer, wins integer, win_rate integer, runs integer, wickets integer, motm integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (select coalesce(in_user_id, (select auth.uid())) as uid),
  played as (
    select m.id, m.winner_team_id, mp.team_id
      from public.match_players mp
      join public.matches m on m.id = mp.match_id
      cross join me
     where mp.user_id = me.uid
       and mp.status = 'confirmed'
       and m.status = 'completed'
  )
  select me.uid,
         p.full_name, p.area_name, p.avatar_url, p.playing_role,
         (select count(*) from played)::integer,
         (select count(*) from played where winner_team_id is not null
                                        and winner_team_id = team_id)::integer,
         coalesce((
           select round(100.0 * count(*) filter (
                    where winner_team_id is not null and winner_team_id = team_id)
                  / nullif(count(*), 0))
             from played
         ), 0)::integer,
         coalesce((select sum(d.runs_off_bat) from public.deliveries d
                    where d.striker_id = me.uid), 0)::integer,
         coalesce((select count(*) from public.deliveries d
                    where d.bowler_id = me.uid
                      and d.wicket_type is not null
                      and d.wicket_type <> 'run_out'), 0)::integer,
         (select count(*) from public.matches m where m.motm_user_id = me.uid)::integer
    from me
    left join public.profiles p on p.id = me.uid;
$function$;

create or replace function public.get_my_next_match()
 returns table(match_id uuid, match_name text, scheduled_at timestamp with time zone, venue_text text, status text, team_a_id uuid, team_a_name text, team_b_id uuid, team_b_name text, my_status text, confirmed_count integer, total_slots integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.id, m.match_name, m.scheduled_at, m.venue_text, m.status,
         m.team_a_id, ta.name, m.team_b_id, tb.name,
         mp.status,
         (select count(*) from public.match_players x
           where x.match_id = m.id and x.status = 'confirmed')::integer,
         m.total_slots
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.teams ta on ta.id = m.team_a_id
    left join public.teams tb on tb.id = m.team_b_id
   where mp.user_id = (select auth.uid())
     and mp.status in ('confirmed', 'invited', 'approved')
     and m.status in ('open', 'locked')
     and m.scheduled_at > now() - interval '3 hours'
   order by m.scheduled_at asc
   limit 1;
$function$;

create or replace function public.get_my_recent_matches(in_limit integer default 5)
 returns table(match_id uuid, match_name text, played_at timestamp with time zone, my_team_id uuid, my_team_name text, opponent_name text, my_runs integer, their_runs integer, outcome text, result_text text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.id, m.match_name, m.scheduled_at,
         mp.team_id, mine.name,
         opp.name,
         (select i.runs from public.innings i
           where i.match_id = m.id and i.batting_team_id = mp.team_id),
         (select i.runs from public.innings i
           where i.match_id = m.id and i.batting_team_id <> mp.team_id limit 1),
         case
           when m.winner_team_id is null then 'tied'
           when m.winner_team_id = mp.team_id then 'won'
           else 'lost'
         end,
         m.result_text
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.teams mine on mine.id = mp.team_id
    left join public.teams opp
      on opp.id = case when mp.team_id = m.team_a_id then m.team_b_id else m.team_a_id end
   where mp.user_id = (select auth.uid())
     and mp.status = 'confirmed'
     and m.status = 'completed'
   order by m.scheduled_at desc
   limit greatest(in_limit, 1);
$function$;

create or replace function public.get_player_batting_history(in_user_id uuid default null::uuid, in_limit integer default 10)
 returns table(match_id uuid, match_name text, played_at timestamp with time zone, opponent_name text, outcome text, overs integer, runs integer, balls integer, fours integer, sixes integer, is_out boolean, strike_rate numeric, is_motm boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select coalesce(in_user_id, (select auth.uid())) as uid
  ),
  mine as (
    select mp.match_id, mp.team_id
      from public.match_players mp
      join me on mp.user_id = me.uid
     where mp.status = 'confirmed'
  ),
  bat as (
    select i.match_id,
           sum(d.runs_off_bat)::integer as runs,
           count(*) filter (where d.extra_type is distinct from 'wide')::integer as balls,
           count(*) filter (where d.runs_off_bat = 4)::integer as fours,
           count(*) filter (where d.runs_off_bat = 6)::integer as sixes,
           bool_or(
             exists (
               select 1 from public.deliveries d2
                where d2.innings_id = d.innings_id
                  and d2.out_player_id = d.striker_id
             )
           ) as is_out
      from public.deliveries d
      join public.innings i on i.id = d.innings_id
      join me on d.striker_id = me.uid
     group by i.match_id
  )
  select m.id,
         m.match_name,
         m.scheduled_at,
         opp.name,
         case
           when m.winner_team_id is null then 'tied'
           when m.winner_team_id = mine.team_id then 'won'
           else 'lost'
         end,
         m.overs,
         coalesce(bat.runs, 0),
         coalesce(bat.balls, 0),
         coalesce(bat.fours, 0),
         coalesce(bat.sixes, 0),
         coalesce(bat.is_out, false),
         round(100.0 * bat.runs / nullif(bat.balls, 0), 2),
         (m.motm_user_id is not null and m.motm_user_id = (select uid from me))
    from mine
    join public.matches m on m.id = mine.match_id
    left join public.teams opp
      on opp.id = case when m.team_a_id = mine.team_id then m.team_b_id else m.team_a_id end
    left join bat on bat.match_id = m.id
   where m.status = 'completed'
   order by m.scheduled_at desc
   limit greatest(in_limit, 1);
$function$;

-- Same privileges as deployed: signed-in users and the service role only.
revoke all on function public.get_player_stats(uuid) from public, anon;
revoke all on function public.get_my_next_match() from public, anon;
revoke all on function public.get_my_recent_matches(integer) from public, anon;
revoke all on function public.get_player_batting_history(uuid, integer) from public, anon;

grant execute on function public.get_player_stats(uuid) to authenticated, service_role;
grant execute on function public.get_my_next_match() to authenticated, service_role;
grant execute on function public.get_my_recent_matches(integer) to authenticated, service_role;
grant execute on function public.get_player_batting_history(uuid, integer) to authenticated, service_role;
