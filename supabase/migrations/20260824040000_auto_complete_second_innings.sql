-- ============================================================================
-- The second innings ends itself.
--
-- Until now nothing stopped the scorer recording balls after the target was
-- passed: match 99fa36aa finished on 37 chasing 33. Ending the match was two
-- manual taps ("End match" -> finish_match), and if the scorer never tapped
-- them the fixture stayed in progress with no result.
--
-- record_delivery now closes the innings and completes the match on the ball
-- that settles it: the target is reached, or the overs run out. The next ball
-- is then refused with INNINGS_ENDED, so there is no window in which a score
-- can be added to a finished match.
--
-- The FIRST innings is deliberately left manual. Sides swap between innings and
-- the scorer confirms that themselves with "End innings" -> "Start second
-- innings", as before.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- finish_match — chase wins no longer claim a wicket margin.
--
-- The margin came from counting `match_players` with status 'confirmed' on the
-- chasing side. Scoring is team-only (see 20260824030000_team_only_scoring),
-- rosters are rarely confirmed, and that count is normally zero — which is how
-- a four-wicket win came out as "ASR WARRIORS won by 0 wickets". There is no
-- squad size to derive N from, so a chase win reports no margin at all. A
-- defending win still reports runs, which is computed from the innings totals
-- and was always right.
-- ---------------------------------------------------------------------------
create or replace function public.finish_match(
  in_match_id uuid, in_motm_user_id uuid default null
)
returns public.matches
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches%rowtype; v_i1 public.innings%rowtype; v_i2 public.innings%rowtype;
  v_txt text; v_a text; v_b text;
begin
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  select * into v_i1 from public.innings where match_id = in_match_id and number = 1;
  select * into v_i2 from public.innings where match_id = in_match_id and number = 2;
  if v_i2.id is null then raise exception 'SECOND_INNINGS_MISSING' using errcode = '23514'; end if;

  select name into v_a from public.teams where id = v_i1.batting_team_id;
  select name into v_b from public.teams where id = v_i2.batting_team_id;

  if v_i2.runs > v_i1.runs then
    v_txt := v_b || ' won';
  elsif v_i1.runs > v_i2.runs then
    v_txt := v_a || ' won by ' || (v_i1.runs - v_i2.runs) || ' runs';
  else
    v_txt := 'Match tied';
  end if;

  update public.matches
     set status = 'completed', result_text = v_txt,
         motm_user_id = coalesce(in_motm_user_id, motm_user_id)
   where id = in_match_id returning * into v_m;
  return v_m;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- record_delivery — same as 20260824030000 plus the auto-complete tail.
-- ---------------------------------------------------------------------------
create or replace function public.record_delivery(
  in_innings_id uuid, in_striker_id uuid, in_non_striker_id uuid, in_bowler_id uuid,
  in_runs_off_bat smallint default 0, in_extra_type text default null,
  in_extra_runs smallint default 0, in_wicket_type text default null,
  in_out_player_id uuid default null
)
returns public.deliveries
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype; v_row public.deliveries%rowtype;
  v_seq integer; v_legal boolean; v_over integer; v_ball smallint;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_i.status <> 'in_progress' then raise exception 'INNINGS_ENDED' using errcode = '23514'; end if;

  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  if in_striker_id = in_non_striker_id then
    raise exception 'SAME_BATTER_BOTH_ENDS' using errcode = '23514';
  end if;

  v_legal := in_extra_type is null or in_extra_type in ('bye', 'leg_bye');
  v_over := v_i.legal_balls / 6;
  v_ball := (v_i.legal_balls % 6) + 1;

  if v_m.overs is not null and v_legal and v_i.legal_balls >= v_m.overs * 6 then
    raise exception 'OVERS_EXHAUSTED' using errcode = '23514';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.deliveries where innings_id = in_innings_id;

  insert into public.deliveries (
    innings_id, seq, over_number, ball_in_over,
    striker_id, non_striker_id, bowler_id,
    runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id
  ) values (
    in_innings_id, v_seq, v_over, v_ball,
    in_striker_id, in_non_striker_id, in_bowler_id,
    coalesce(in_runs_off_bat, 0), in_extra_type, coalesce(in_extra_runs, 0),
    in_wicket_type, in_out_player_id
  ) returning * into v_row;

  -- Did that ball settle it? Re-read the innings: `deliveries_sync_totals` is
  -- an AFTER INSERT row trigger, so the totals are already recomputed, but v_i
  -- is the copy taken before the ball.
  if v_i.number = 2 then
    select * into v_i from public.innings where id = in_innings_id;

    if (v_i.target is not null and v_i.runs >= v_i.target)
       or (v_m.overs is not null and v_i.legal_balls >= v_m.overs * 6) then
      update public.innings
         set status = 'completed', ended_at = now()
       where id = in_innings_id;

      -- finish_match is what works out the winner and writes
      -- matches.status/result_text. It re-reads both innings rows, so it sees
      -- the totals and the closed status written above. Its scorer check is the
      -- one already passed at the top of this function.
      perform public.finish_match(v_i.match_id, null);
    end if;
  end if;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- create_rematch — no longer tied to the booked slot.
--
-- The rule was: end_time must be set and still in the future, or SLOT_EXPIRED.
-- Every match in this database has a null end_time, so "Play again" could never
-- succeed. Slot booking is not enforced anywhere else either; gating the
-- rematch on it only made the button dead.
-- ---------------------------------------------------------------------------
create or replace function public.create_rematch(in_match_id uuid)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_orig      public.matches%rowtype;
  v_new       public.matches%rowtype;
  v_now       timestamptz := now();
  v_code      text;
  v_count     integer;
  v_game_num  integer;
  v_new_name  text;
  v_base_name text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_orig from public.matches where id = in_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Only organiser or match captain/player can trigger rematch
  if not (v_orig.creator_id = v_uid or public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_ALLOWED_TO_REMATCH' using errcode = '42501';
  end if;

  -- Match must be completed
  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  -- Determine Game number
  select count(*) into v_count
    from public.matches
   where id = in_match_id
      or rematch_of = in_match_id
      or id = v_orig.rematch_of
      or rematch_of = v_orig.rematch_of;

  v_game_num := v_count + 1;
  v_base_name := regexp_replace(v_orig.match_name, '\s*\(Game\s*\d+\)$', '', 'i');
  v_new_name := v_base_name || ' (Game ' || v_game_num || ')';

  -- Generate unique share code
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, match_name, sport, game_type, match_type, area_name,
        lat, lng, match_lat, match_lng, venue_id, venue_text, search_radius_m,
        scheduled_at, end_time, total_slots, filled_slots, missing_count,
        status, share_code, team_a_id, team_b_id, rematch_of, notes
      )
      values (
        v_uid, v_new_name, v_orig.sport, v_orig.game_type, v_orig.match_type,
        v_orig.area_name, v_orig.lat, v_orig.lng, v_orig.match_lat, v_orig.match_lng,
        v_orig.venue_id, v_orig.venue_text, v_orig.search_radius_m,
        v_now, v_orig.end_time, v_orig.total_slots, v_orig.filled_slots, 0,
        'locked', v_code, v_orig.team_a_id, v_orig.team_b_id,
        coalesce(v_orig.rematch_of, v_orig.id), coalesce(v_orig.notes, 'Rematch')
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Copy over confirmed players from previous match.
  --
  -- `side` is NOT copied because there is no such column: match_players has
  -- only team_id, and list_match_players derives 'a'/'b' from whether that
  -- team_id is the match's team_a_id or team_b_id. The original insert named
  -- `side` and so create_rematch failed outright with
  -- `column "side" of relation "match_players" does not exist` — the second
  -- reason, after SLOT_EXPIRED, that "Play again" never worked. The rematch
  -- copies team_id and both team ids, so the derived side is unchanged.
  insert into public.match_players (
    match_id, user_id, team_id, status, role, joined_via
  )
  select v_new.id, mp.user_id, mp.team_id, 'confirmed', mp.role, mp.joined_via
  from public.match_players mp
  where mp.match_id = in_match_id
    and mp.status = 'confirmed'
  on conflict (match_id, user_id) do nothing;

  update public.matches
     set filled_slots = (select count(*) from public.match_players where match_id = v_new.id and status = 'confirmed')
   where id = v_new.id
  returning * into v_new;

  return v_new;
end;
$fn$;
