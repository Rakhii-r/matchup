-- ============================================================================
-- One phone runs the match: the creator.
--
-- Box cricket is played with both captains standing on the same patch of
-- ground and one person holding the app. Spreading the toss and the keypad
-- across both sides was never how these games are actually run, and it created
-- races nobody wanted — whoever opened the scoring screen first became the
-- scorer for the whole match, which could be the opposing captain.
--
-- From here the match ORGANISER (`matches.creator_id`) is the only account that
-- may act. Everyone else — including the opposing captain — reads.
--
-- This deliberately NARROWS three rules widened earlier the same week:
--   * perform_toss / redo_toss accepted `is_match_captain OR is_match_player`.
--   * set_toss_decision accepted the winning team's owner OR the creator.
--   * create_rematch accepted the organiser, a captain, or any player.
-- The `get_toss.i_am_winner` fix from 25 Aug still stands and is still needed:
-- it is what lets the creator choose bat/bowl when the OTHER side won the toss,
-- which under this rule is now the normal case rather than an edge case.
--
-- New error token `NOT_THE_ORGANISER` (errcode 42501) on every narrowed path.
--
-- ## Ordering — this file MUST stay after 20260826111500
--
-- `20260826111500_toss_call_heads_tails` introduced the heads/tails call and
-- changed three signatures: `perform_toss(uuid, text, integer)`,
-- `redo_toss(uuid, text)` and a 16-column `get_toss`. The three functions below
-- are that migration's bodies with the organiser guard swapped in — NOT the
-- pre-call versions. Rebuilding them from an older copy silently deletes the
-- call feature, which is exactly what an earlier draft of this file did.
--
-- ## What is deliberately NOT changed
--
-- `record_delivery`, `undo_last_delivery`, `end_innings` and `finish_match`
-- already gate on `matches.scorer_id`, and they keep doing exactly that. The
-- creator-only rule decides who BECOMES the scorer; once `scorer_id` is set it
-- remains the single authority for the rest of the match. That separation is
-- what grandfathers the two in-flight matches whose scorer is a captain rather
-- than the creator — they finish under the scorer they already have instead of
-- deadlocking mid-innings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. perform_toss — organiser only. Body is 20260826111500's, guard swapped.
-- ---------------------------------------------------------------------------
create or replace function public.perform_toss(
  in_match_id uuid,
  in_call     text default 'heads',
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
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

  -- Lock the match so two captains tapping "Flip" at once cannot both insert.
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

  -- If open match with no squads, create casual shells
  if v_m.team_a_id is null or v_m.team_b_id is null then
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

  -- Idempotent check
  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  -- Determine which team is calling
  select mp.team_id into v_p_team
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id = v_uid
   limit 1;

  if v_p_team is not null and v_p_team = v_m.team_b_id then
    v_calling_team := v_m.team_b_id;
    v_other_team   := v_m.team_a_id;
  else
    -- Default to Team A or caller's team
    v_calling_team := coalesce(v_m.team_a_id, v_p_team);
    v_other_team   := case when v_calling_team = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  end if;

  -- Server-side random coin flip
  v_outcome := case when (random() < 0.5) then 'heads' else 'tails' end;

  -- Winner logic based on whether outcome matches caller's call
  if v_outcome = v_call then
    v_winner := v_calling_team;
  else
    v_winner := v_other_team;
  end if;

  insert into public.match_toss (
    match_id,
    called_by,
    calling_team_id,
    called_face,
    winner_team_id,
    outcome
  )
  values (
    in_match_id,
    v_uid,
    v_calling_team,
    v_call,
    v_winner,
    v_outcome
  )
  returning * into v_row;

  -- Notifications
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
$fn$;

revoke execute on function public.perform_toss(uuid, text, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. redo_toss — organiser only. Body is 20260826111500's, guard swapped.
-- ---------------------------------------------------------------------------
create or replace function public.redo_toss(
  in_match_id uuid,
  in_call     text default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid          uuid := (select auth.uid());
  v_m            public.matches%rowtype;
  v_row          public.match_toss%rowtype;
  v_winner       uuid;
  v_outcome      text;
  v_call         text;
  v_calling_team uuid;
  v_other_team   uuid;
  v_cap          record;
  v_p_team       uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Restored: the pre-call redo_toss refused a finished or cancelled match and
  -- 20260826111500 dropped that check, which would have allowed re-flipping the
  -- toss of a completed game.
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  -- Organiser only. Was `is_match_captain OR is_match_player`.
  if v_m.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'TOSS_ALREADY_DECIDED' using errcode = '23514';
  end if;

  v_call := lower(coalesce(in_call, v_row.called_face, 'heads'));
  if v_call not in ('heads', 'tails') then
    v_call := 'heads';
  end if;

  -- Determine calling team
  select mp.team_id into v_p_team
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id = v_uid
   limit 1;

  if v_p_team is not null and v_p_team = v_m.team_b_id then
    v_calling_team := v_m.team_b_id;
    v_other_team   := v_m.team_a_id;
  else
    v_calling_team := coalesce(v_row.calling_team_id, v_m.team_a_id);
    v_other_team   := case when v_calling_team = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  end if;

  v_outcome := case when (random() < 0.5) then 'heads' else 'tails' end;

  if v_outcome = v_call then
    v_winner := v_calling_team;
  else
    v_winner := v_other_team;
  end if;

  update public.match_toss
     set called_by       = v_uid,
         calling_team_id = v_calling_team,
         called_face     = v_call,
         winner_team_id  = v_winner,
         outcome         = v_outcome,
         created_at      = now()
   where match_id = in_match_id
  returning * into v_row;

  for v_cap in
    select distinct on (t.owner_id) t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
     order by t.owner_id, (t.id = v_winner) desc
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      case when v_cap.won then 'Toss re-flipped: You won' else 'Toss re-flipped' end,
      'The organiser is choosing bat or bowl.',
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.redo_toss(uuid, text) from anon, public;
grant  execute on function public.redo_toss(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_toss_decision — organiser only, on behalf of whichever side won.
-- ---------------------------------------------------------------------------
create or replace function public.set_toss_decision(
  in_match_id uuid,
  in_decision text
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_row   public.match_toss%rowtype;
  v_team  public.teams%rowtype;
  v_m     public.matches%rowtype;
  v_cap   record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if in_decision not in ('bat', 'bowl') then
    raise exception 'INVALID_DECISION' using errcode = '23514';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_DONE' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'DECISION_ALREADY_MADE' using errcode = '23514';
  end if;

  select * into v_m from public.matches where id = in_match_id;
  select * into v_team from public.teams where id = v_row.winner_team_id;

  -- Was `v_team.owner_id <> v_uid and v_m.creator_id <> v_uid`. The organiser
  -- now makes the call for whichever side won, because they are the only person
  -- holding the app.
  if v_m.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  update public.match_toss
     set decision = in_decision, decided_at = now()
   where match_id = in_match_id
   returning * into v_row;

  -- BOTH owners except the caller, not just the losing side.
  --
  -- The old version notified only the team that did NOT win. Under the previous
  -- rule the winner had just tapped the button themselves so they knew; now the
  -- organiser taps for everyone, and if the organiser owns the losing side the
  -- winning captain would have been told nothing at all.
  for v_cap in
    select distinct t.owner_id
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
       and t.owner_id <> v_uid
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_done',
      'Toss decided',
      coalesce(v_team.name, 'The toss winner') || ' will ' || in_decision || ' first.',
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.set_toss_decision(uuid, text) from anon, public;
grant  execute on function public.set_toss_decision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_toss — i_am_winner mirrors set_toss_decision, as it must.
--    16-column call-aware shape from 20260826111500.
-- ---------------------------------------------------------------------------
create or replace function public.get_toss(in_match_id uuid)
returns table (
  match_id          uuid,
  winner_team_id    uuid,
  winner_team_name  text,
  outcome           text,
  called_face       text,
  calling_team_id   uuid,
  calling_team_name text,
  decision          text,
  overs             integer,
  batting_team_id   uuid,
  bowling_team_id   uuid,
  i_am_captain      boolean,
  i_am_winner       boolean,
  i_am_caller       boolean,
  created_at        timestamptz,
  decided_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select mt.match_id,
         mt.winner_team_id,
         w.name as winner_team_name,
         mt.outcome,
         mt.called_face,
         mt.calling_team_id,
         ct.name as calling_team_name,
         mt.decision,
         m.overs,
         case when mt.decision is null then null
              when mt.decision = 'bat' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end as batting_team_id,
         case when mt.decision is null then null
              when mt.decision = 'bowl' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end as bowling_team_id,
         public.is_match_captain(mt.match_id, (select auth.uid())),
         -- Mirrors set_toss_decision: the organiser, and nobody else. Was
         -- `w.owner_id = uid or m.creator_id = uid`.
         (m.creator_id = (select auth.uid())),
         (mt.called_by = (select auth.uid())),
         mt.created_at,
         mt.decided_at
    from public.match_toss mt
    join public.matches m on m.id = mt.match_id
    join public.teams   w on w.id = mt.winner_team_id
    left join public.teams ct on ct.id = mt.calling_team_id
   where mt.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     );
$fn$;

revoke execute on function public.get_toss(uuid) from anon, public;
grant  execute on function public.get_toss(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. start_innings — only the organiser may BECOME the scorer.
--
-- One line moves. Everything after the guard is untouched, and that matters:
-- the `elsif v_m.scorer_id <> v_uid` branch is what lets the two in-flight
-- matches whose scorer is a captain finish under that scorer instead of
-- deadlocking. `scorer_id`, once set, stays the authority.
-- ---------------------------------------------------------------------------
create or replace function public.start_innings(in_match_id uuid)
returns public.innings
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_m     public.matches%rowtype;
  v_toss  public.match_toss%rowtype;
  v_prev  public.innings%rowtype;
  v_row   public.innings%rowtype;
  v_bat   uuid;
  v_bowl  uuid;
  v_num   smallint;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.status = 'cancelled' then
    raise exception 'MATCH_CANCELLED' using errcode = '23514';
  end if;

  select * into v_toss from public.match_toss where match_id = in_match_id;
  if not found or v_toss.decision is null then
    raise exception 'TOSS_NOT_DECIDED' using errcode = '23514';
  end if;

  if v_m.scorer_id is null then
    -- Was `is_match_captain OR creator`, first caller wins — which meant the
    -- opposing captain could take the keypad by opening the screen first.
    if v_m.creator_id <> v_uid then
      raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
    end if;
    update public.matches set scorer_id = v_uid where id = in_match_id;
    v_m.scorer_id := v_uid;
  elsif v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  select * into v_prev from public.innings
   where match_id = in_match_id order by number desc limit 1;

  if not found then
    v_num := 1;
    v_bat := case when v_toss.decision = 'bat'
                  then v_toss.winner_team_id
                  else case when v_toss.winner_team_id = v_m.team_a_id
                            then v_m.team_b_id else v_m.team_a_id end end;
    v_bowl := case when v_bat = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  else
    if v_prev.number = 2 then
      raise exception 'MATCH_ALREADY_HAS_TWO_INNINGS' using errcode = '23505';
    end if;
    if v_prev.status <> 'completed' then
      raise exception 'FIRST_INNINGS_NOT_ENDED' using errcode = '23514';
    end if;
    v_num  := 2;
    v_bat  := v_prev.bowling_team_id;
    v_bowl := v_prev.batting_team_id;
  end if;

  insert into public.innings (match_id, number, batting_team_id, bowling_team_id, target)
  values (in_match_id, v_num, v_bat, v_bowl,
          case when v_num = 2 then v_prev.runs + 1 else null end)
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke execute on function public.start_innings(uuid) from anon, public;
grant  execute on function public.start_innings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. create_rematch — organiser only.
--    One booked slot, one person driving it. Body otherwise unchanged from
--    20260825120000_slot_multi_match.
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
  v_open      public.matches%rowtype;
  v_now       timestamptz := now();
  v_root      uuid;
  v_code      text;
  v_try       integer;
  v_count     integer;
  v_game_num  integer;
  v_suffix    text;
  v_new_name  text;
  v_base_name text;
  v_player    record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_orig from public.matches where id = in_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Was organiser OR captain OR any player.
  if v_orig.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  v_root := coalesce(v_orig.rematch_of, v_orig.id);

  perform pg_advisory_xact_lock(hashtextextended(v_root::text, 0));

  -- A NULL end_time is a match with no booked slot, not an expired one.
  if v_orig.end_time is not null and v_orig.end_time <= v_now then
    raise exception 'SLOT_EXPIRED' using errcode = '23514';
  end if;

  select * into v_open
    from public.matches
   where (id = v_root or rematch_of = v_root)
     and status in ('open', 'locked')
   order by created_at desc
   limit 1;
  if found then
    return v_open;
  end if;

  select count(*) into v_count
    from public.matches
   where id = v_root or rematch_of = v_root;

  v_game_num := v_count + 1;

  v_base_name := regexp_replace(coalesce(v_orig.match_name, 'Match'), '\s*(\(Game\s*\d+\)|·\s*Game\s*\d+)\s*$', '', 'i');
  v_base_name := trim(v_base_name);
  if v_base_name = '' then
    v_base_name := 'Match';
  end if;

  v_suffix := ' (Game ' || v_game_num || ')';
  v_new_name := left(v_base_name, 80 - char_length(v_suffix)) || v_suffix;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, match_name, sport, game_type, match_type, area_name,
        lat, lng, match_lat, match_lng, venue_id, venue_text, search_radius_m,
        scheduled_at, end_time, total_slots, filled_slots, missing_count,
        status, share_code, team_a_id, team_b_id, rematch_of, overs, notes
      )
      values (
        v_uid, v_new_name, v_orig.sport, v_orig.game_type, v_orig.match_type,
        v_orig.area_name, v_orig.lat, v_orig.lng, v_orig.match_lat, v_orig.match_lng,
        v_orig.venue_id, v_orig.venue_text, v_orig.search_radius_m,
        v_now, v_orig.end_time, v_orig.total_slots, 0, 0,
        'locked', v_code, v_orig.team_a_id, v_orig.team_b_id,
        v_root, v_orig.overs, coalesce(v_orig.notes, 'Next game in this slot')
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (
    match_id, user_id, team_id, status, role, joined_via
  )
  select v_new.id, mp.user_id, mp.team_id, 'confirmed', mp.role, mp.joined_via
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.status = 'confirmed'
  on conflict (match_id, user_id) do nothing;

  update public.matches
     set filled_slots = (
           select count(*) from public.match_players
            where match_id = v_new.id and status = 'confirmed'
         )
   where id = v_new.id
  returning * into v_new;

  for v_player in
    select distinct mp.user_id
      from public.match_players mp
     where mp.match_id = v_new.id
       and mp.status = 'confirmed'
       and mp.user_id <> v_uid
  loop
    perform public.enqueue_notification(
      v_player.user_id,
      'next_game_started',
      'Game ' || v_game_num || ' is starting now',
      'Same teams, same ground. Tap to follow the score.',
      jsonb_build_object('route', '/match/' || v_new.id::text || '/toss', 'match_id', v_new.id)
    );
  end loop;

  return v_new;
end;
$fn$;

revoke execute on function public.create_rematch(uuid) from anon, public;
grant  execute on function public.create_rematch(uuid) to authenticated;
