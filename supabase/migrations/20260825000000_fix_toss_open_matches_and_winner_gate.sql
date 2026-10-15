-- ============================================================================
-- Toss: the open-match branch had never run, and the winner gate deadlocked.
--
-- ## 1. perform_toss — the "open match with no teams" branch
--
-- Four independent schema mistakes, ANY ONE of which aborts the branch. It has
-- therefore never completed successfully for a single match:
--
--   a. `update match_players set ... side = 'a'` — there is no `side` column.
--      `side` is DERIVED: list_match_players resolves 'a'/'b' by comparing
--      match_players.team_id against the match's team_a_id / team_b_id, so
--      setting team_id is the whole job. Same mistake as create_rematch, fixed
--      there on 24 Aug (fix_create_rematch_side_column) and missed here.
--   b. `insert into teams (..., area_name, ...)` — teams has no `area_name`.
--      The column is `home_ground` (max 120 chars).
--   c. `invite_code` was never supplied. It is NOT NULL, UNIQUE and exactly
--      6 characters with no default, so the insert could not have succeeded.
--      gen_share_code() produces exactly that shape; a retry covers collisions.
--   d. `teams_name_check` caps `name` at 50 characters while
--      `matches_match_name_len` allows 80, so `match_name || ' · Side A'` blew
--      the constraint on any reasonably long match name. The base is now
--      clamped to leave room for the suffix.
--
-- Fixing only (a) would have moved the crash to (b). All four are fixed here.
--
-- Also deduped the closing notification: on an open match BOTH shells are owned
-- by the organiser, so the un-deduped loop pushed them two notices for one toss.
--
-- ## 2. get_toss — i_am_winner
--
-- `set_toss_decision` accepts `v_team.owner_id = v_uid OR v_m.creator_id =
-- v_uid`, but `get_toss` reported `i_am_winner` as `w.owner_id = auth.uid()`
-- alone. An organiser who did not own the winning team was told they had not
-- won, so the Bat/Bowl buttons never rendered — while the server would have
-- accepted their choice. Nobody could spend the toss and the match could not
-- start. The read model now mirrors the write rule exactly.
-- ============================================================================

create or replace function public.perform_toss(
  in_match_id uuid,
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_m       public.matches%rowtype;
  v_row     public.match_toss%rowtype;
  v_winner  uuid;
  v_heads   boolean;
  v_cap     record;
  v_team_a  uuid;
  v_team_b  uuid;
  v_player  record;
  v_idx     integer := 0;
  v_half    integer;
  v_total_p integer;
  v_base    text;
  v_try     integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Lock the match so two captains tapping "Flip" at once cannot both insert.
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  if not (public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  -- An open match has no squads, so two casual shells are created and the sheet
  -- is split across them. See the header for what was wrong with this block.
  if v_m.team_a_id is null or v_m.team_b_id is null then
    -- teams_name_check caps `name` at 50; match_name is allowed 80.
    v_base := left(trim(coalesce(nullif(trim(v_m.match_name), ''), 'Match')), 50 - char_length(' · Side A'));

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code)
        values (v_base || ' · Side A', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code())
        returning id into v_team_a;
        exit;
      exception when unique_violation then
        if v_try = 5 then raise; end if;
      end;
    end loop;

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code)
        values (v_base || ' · Side B', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code())
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

    -- Split the sheet evenly. ONLY team_id is written — the side follows from it.
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

  -- Idempotent: a second tap returns the existing toss rather than re-rolling.
  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  v_heads  := (random() < 0.5);
  v_winner := case when v_heads then v_m.team_a_id else v_m.team_b_id end;

  insert into public.match_toss (match_id, called_by, winner_team_id, outcome)
  values (in_match_id, v_uid, v_winner, case when v_heads then 'heads' else 'tails' end)
  returning * into v_row;

  -- Tell both captains. On an open match BOTH shells belong to the organiser,
  -- so DISTINCT ON keeps that one person to a single notice, and the ordering
  -- makes sure the one they get is the "you won" copy.
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
      case when v_cap.won
           then 'Choose to bat or bowl.'
           else 'The other captain is choosing bat or bowl.' end,
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.perform_toss(uuid, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_toss — i_am_winner now mirrors set_toss_decision's permission check.
-- ---------------------------------------------------------------------------
create or replace function public.get_toss(in_match_id uuid)
returns table (
  match_id         uuid,
  winner_team_id   uuid,
  winner_team_name text,
  outcome          text,
  decision         text,
  overs            integer,
  batting_team_id  uuid,
  bowling_team_id  uuid,
  i_am_captain     boolean,
  i_am_winner      boolean,
  created_at       timestamptz,
  decided_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select mt.match_id,
         mt.winner_team_id,
         w.name,
         mt.outcome,
         mt.decision,
         m.overs,
         case when mt.decision is null then null
              when mt.decision = 'bat' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end,
         case when mt.decision is null then null
              when mt.decision = 'bowl' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end,
         public.is_match_captain(mt.match_id, (select auth.uid())),
         -- Mirrors set_toss_decision: the winning team's owner OR the match
         -- creator may choose. Owner-only here deadlocked every match whose
         -- organiser did not own the winning side.
         (w.owner_id = (select auth.uid()) or m.creator_id = (select auth.uid())),
         mt.created_at,
         mt.decided_at
    from public.match_toss mt
    join public.matches m on m.id = mt.match_id
    join public.teams   w on w.id = mt.winner_team_id
   where mt.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     );
$fn$;

revoke execute on function public.get_toss(uuid) from anon, public;
grant  execute on function public.get_toss(uuid) to authenticated;
