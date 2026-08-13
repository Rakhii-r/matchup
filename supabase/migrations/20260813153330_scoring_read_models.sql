-- ============================================================================
-- Read models for scoring. SECURITY DEFINER because a scorecard needs player
-- names (profiles is self-only) and team names (teams is members-only); both
-- apply the same "on the sheet" visibility rule the tables do.
-- ============================================================================

create or replace function public.get_live_state(in_match_id uuid)
returns table (
  innings_id uuid, innings_number smallint,
  batting_team_id uuid, batting_team text,
  bowling_team_id uuid, bowling_team text,
  runs integer, wickets integer, legal_balls integer,
  overs_limit integer, target integer, status text,
  i_am_scorer boolean, last_ball_seq integer
)
language sql stable security definer set search_path = public
as $fn$
  select i.id, i.number,
         i.batting_team_id, bt.name,
         i.bowling_team_id, bw.name,
         i.runs, i.wickets, i.legal_balls,
         m.overs, i.target, i.status,
         m.scorer_id = (select auth.uid()),
         (select max(d.seq) from public.deliveries d where d.innings_id = i.id)
    from public.innings i
    join public.matches m on m.id = i.match_id
    join public.teams bt on bt.id = i.batting_team_id
    join public.teams bw on bw.id = i.bowling_team_id
   where i.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     )
   order by i.number desc
   limit 1;
$fn$;

revoke execute on function public.get_live_state(uuid) from anon, public;
grant  execute on function public.get_live_state(uuid) to authenticated;

-- The ball chips ("1 4 0 W 1 2"). Labels are built server-side so every client
-- renders the same thing.
create or replace function public.get_this_over(in_innings_id uuid)
returns table (
  seq integer, over_number integer, ball_in_over smallint,
  runs_off_bat smallint, extra_type text, extra_runs smallint,
  wicket_type text, label text
)
language sql stable security definer set search_path = public
as $fn$
  with cur as (
    select coalesce(max(over_number), 0) as o
      from public.deliveries where innings_id = in_innings_id
  )
  select d.seq, d.over_number, d.ball_in_over,
         d.runs_off_bat, d.extra_type, d.extra_runs, d.wicket_type,
         case
           when d.wicket_type is not null then 'W'
           when d.extra_type = 'wide'     then 'wd' || nullif(d.extra_runs - 1, 0)::text
           when d.extra_type = 'no_ball'  then 'nb' || nullif(d.extra_runs - 1, 0)::text
           when d.extra_type = 'bye'      then d.extra_runs::text || 'b'
           when d.extra_type = 'leg_bye'  then d.extra_runs::text || 'lb'
           else d.runs_off_bat::text
         end
    from public.deliveries d, cur
   where d.innings_id = in_innings_id
     and d.over_number = cur.o
     and exists (
       select 1 from public.innings i
        where i.id = in_innings_id
          and (
            public.is_match_creator(i.match_id, (select auth.uid()))
            or public.is_match_player(i.match_id, (select auth.uid()))
          )
     )
   order by d.seq asc;
$fn$;

revoke execute on function public.get_this_over(uuid) from anon, public;
grant  execute on function public.get_this_over(uuid) to authenticated;

-- Balls faced excludes WIDES only. A no-ball is a ball the batter faced and
-- could score off; a wide is not.
create or replace function public.get_batting_card(in_innings_id uuid)
returns table (
  user_id uuid, full_name text, runs integer, balls integer,
  fours integer, sixes integer, strike_rate numeric,
  is_out boolean, wicket_type text
)
language sql stable security definer set search_path = public
as $fn$
  select b.striker_id,
         p.full_name,
         sum(b.runs_off_bat)::integer,
         count(*) filter (where b.extra_type is distinct from 'wide')::integer,
         count(*) filter (where b.runs_off_bat = 4)::integer,
         count(*) filter (where b.runs_off_bat = 6)::integer,
         round(
           100.0 * sum(b.runs_off_bat)
           / nullif(count(*) filter (where b.extra_type is distinct from 'wide'), 0), 2),
         bool_or(o.out_player_id is not null),
         max(o.wicket_type)
    from public.deliveries b
    left join public.profiles p on p.id = b.striker_id
    left join lateral (
      select d2.wicket_type, d2.out_player_id
        from public.deliveries d2
       where d2.innings_id = b.innings_id and d2.out_player_id = b.striker_id
       limit 1
    ) o on true
   where b.innings_id = in_innings_id
     and exists (
       select 1 from public.innings i
        where i.id = in_innings_id
          and (
            public.is_match_creator(i.match_id, (select auth.uid()))
            or public.is_match_player(i.match_id, (select auth.uid()))
          )
     )
   group by b.striker_id, p.full_name
   order by sum(b.runs_off_bat) desc;
$fn$;

revoke execute on function public.get_batting_card(uuid) from anon, public;
grant  execute on function public.get_batting_card(uuid) to authenticated;

-- Byes and leg byes are NOT charged to the bowler; wides and no-balls are.
-- A run-out is not the bowler's wicket.
create or replace function public.get_bowling_card(in_innings_id uuid)
returns table (
  user_id uuid, full_name text, legal_balls integer,
  overs_text text, runs integer, wickets integer, economy numeric
)
language sql stable security definer set search_path = public
as $fn$
  with agg as (
    select d.bowler_id,
           count(*) filter (
             where d.extra_type is null or d.extra_type in ('bye', 'leg_bye')
           )::integer as legal_balls,
           (sum(d.runs_off_bat)
            + coalesce(sum(d.extra_runs) filter (
                where d.extra_type in ('wide', 'no_ball')), 0))::integer as runs,
           count(*) filter (
             where d.wicket_type is not null and d.wicket_type <> 'run_out'
           )::integer as wickets
      from public.deliveries d
     where d.innings_id = in_innings_id
       and exists (
         select 1 from public.innings i
          where i.id = in_innings_id
            and (
              public.is_match_creator(i.match_id, (select auth.uid()))
              or public.is_match_player(i.match_id, (select auth.uid()))
            )
       )
     group by d.bowler_id
  )
  select a.bowler_id, p.full_name, a.legal_balls,
         (a.legal_balls / 6)::text || '.' || (a.legal_balls % 6)::text,
         a.runs, a.wickets,
         round(6.0 * a.runs / nullif(a.legal_balls, 0), 2)
    from agg a
    left join public.profiles p on p.id = a.bowler_id
   order by a.wickets desc, a.runs asc;
$fn$;

revoke execute on function public.get_bowling_card(uuid) from anon, public;
grant  execute on function public.get_bowling_card(uuid) to authenticated;
