-- ============================================================================
-- Hide the toss-time "Side A / Side B" shells from My Teams
-- ============================================================================
--
-- Reported as "duplicate teams in My Teams". They are not duplicates of a real
-- squad: `perform_toss` gives an OPEN match (no team_a_id / team_b_id) two
-- throwaway teams named `<match name> · Side A` and `· Side B`, both owned by
-- the organiser, so the scoring tables have a side to point at. The owner
-- trigger then seats the organiser in both, and `get_my_teams_overview` lists
-- every team the caller belongs to -- so each open match the organiser tossed
-- added two near-identical cards ("Box Cricket · Venk…") to their squad list.
-- On the live project 10 of 19 teams were these shells.
--
-- Fix: mark them. `teams.is_match_side` is true only for a shell; the toss
-- sets it, the backfill marks the existing ones, and the My Teams read model
-- skips them. The rows stay: matches, match_players, innings and deliveries
-- reference them, and the scorecard still needs their names.
--
-- Backfill rule: a team is a shell when a match created by the team's owner
-- points at it as team_a with a ` · Side A` name, or as team_b with a
-- ` · Side B` name. That is exactly what perform_toss writes; no real squad
-- created through the app matches both halves.
-- ============================================================================

alter table public.teams
  add column if not exists is_match_side boolean not null default false;

comment on column public.teams.is_match_side is
  'True for the Side A / Side B team perform_toss creates for an open match. Hidden from My Teams.';

update public.teams t
   set is_match_side = true
 where exists (
         select 1
           from public.matches m
          where m.creator_id = t.owner_id
            and (   (m.team_a_id = t.id and t.name ~ ' · Side A$')
                 or (m.team_b_id = t.id and t.name ~ ' · Side B$'))
       );

-- ---------------------------------------------------------------------------
-- perform_toss: body unchanged from 20260826120000 except that both shell
-- inserts now write is_match_side = true.
-- ---------------------------------------------------------------------------
create or replace function public.perform_toss(
  in_match_id uuid,
  in_call     text    default 'heads',
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid            uuid := (select auth.uid());
  v_m              public.matches%rowtype;
  v_row            public.match_toss%rowtype;
  v_winner         uuid;
  v_outcome        text;
  v_call           text := lower(coalesce(in_call, 'heads'));
  v_calling_team   uuid;
  v_other_team     uuid;
  v_cap            record;
  v_team_a         uuid;
  v_team_b         uuid;
  v_player         record;
  v_idx            integer := 0;
  v_half           integer;
  v_total_p        integer;
  v_base           text;
  v_try            integer;
  v_p_team         uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if v_call not in ('heads', 'tails') then
    v_call := 'heads';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  -- Organiser only. Was `is_match_captain OR is_match_player`.
  if v_m.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_m.team_a_id is null or v_m.team_b_id is null then
    v_base := left(trim(coalesce(nullif(trim(v_m.match_name), ''), 'Match')), 50 - char_length(' · Side A'));

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code, is_match_side)
        values (v_base || ' · Side A', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code(), true)
        returning id into v_team_a;
        exit;
      exception when unique_violation then
        if v_try = 5 then raise; end if;
      end;
    end loop;

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code, is_match_side)
        values (v_base || ' · Side B', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code(), true)
        returning id into v_team_b;
        exit;
      exception when unique_violation then
        if v_try = 5 then raise; end if;
      end;
    end loop;

    update public.matches
       set team_a_id = v_team_a,
           team_b_id = v_team_b
     where id = in_match_id;

    v_m.team_a_id := v_team_a;
    v_m.team_b_id := v_team_b;

    select count(*) into v_total_p from public.match_players where match_id = in_match_id;
    v_half := ceil(v_total_p::numeric / 2.0);

    for v_player in (select id from public.match_players where match_id = in_match_id order by created_at asc) loop
      v_idx := v_idx + 1;
      if v_idx <= v_half then
        update public.match_players set team_id = v_team_a where id = v_player.id;
      else
        update public.match_players set team_id = v_team_b where id = v_player.id;
      end if;
    end loop;
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  -- Which side is calling. The organiser is the only caller now, so this
  -- resolves to whichever squad they are seated with, defaulting to Team A.
  select mp.team_id into v_p_team
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id = v_uid
   limit 1;

  if v_p_team is not null and v_p_team = v_m.team_b_id then
    v_calling_team := v_m.team_b_id;
    v_other_team   := v_m.team_a_id;
  else
    v_calling_team := coalesce(v_m.team_a_id, v_p_team);
    v_other_team   := case when v_calling_team = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  end if;

  v_outcome := case when (random() < 0.5) then 'heads' else 'tails' end;

  if v_outcome = v_call then
    v_winner := v_calling_team;
  else
    v_winner := v_other_team;
  end if;

  insert into public.match_toss (
    match_id, called_by, calling_team_id, called_face, winner_team_id, outcome
  )
  values (
    in_match_id, v_uid, v_calling_team, v_call, v_winner, v_outcome
  )
  returning * into v_row;

  -- The opposing captain cannot act any more, so a push is the only way they
  -- learn the toss happened.
  for v_cap in
    select distinct on (t.owner_id) t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
     order by t.owner_id, (t.id = v_winner) desc
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      case when v_cap.won then 'You won the toss' else 'Toss done' end,
      'The organiser is choosing bat or bowl.',
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$function$;

revoke execute on function public.perform_toss(uuid, text, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_teams_overview: body unchanged from 20260904092956 except the
-- `not t.is_match_side` filter in `mine`.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_teams_overview()
returns table(
  id uuid, name text, sport text, invite_code text, logo_url text, home_ground text,
  player_count integer, my_role text, i_am_owner boolean, matches_played integer,
  wins integer, losses integer, ties integer, win_rate integer, target_size integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select t.id, t.name, t.sport, t.invite_code, t.logo_url, t.home_ground,
           t.owner_id, t.target_size, tm.role as my_role
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where tm.user_id = (select auth.uid())
       and not t.is_match_side
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
         coalesce(agg.win_rate, 0),
         mine.target_size
    from mine
    left join counts on counts.team_id = mine.id
    left join agg on agg.team_id = mine.id
   order by mine.name;
$function$;

revoke execute on function public.get_my_teams_overview() from anon, public;
grant  execute on function public.get_my_teams_overview() to authenticated;
