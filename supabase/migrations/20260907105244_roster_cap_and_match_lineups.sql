-- ============================================================================
-- Team roster cap (20) and captain-selected match lineups.
--
-- WHY THERE IS NO `match_lineups` TABLE.
--
-- `match_players` already stores match_id + team_id + user_id + role + status,
-- which is exactly a lineup row, and TWENTY-FIVE functions read it —
-- list_match_players, match_occupied_slots, the scoring read models,
-- player_schedule_conflict, get_player_stats, the toss, attendance, venue
-- ratings. A second table describing who plays would either need every one of
-- those taught about it, or it would silently disagree with them: the scorecard
-- showing one squad and the lineup screen another.
--
-- So a "lineup" here is not a new object. It is the answer to a question
-- match_players was already being asked badly: WHICH members of the roster are
-- on this sheet. finalise_challenge used to seat every member of both rosters
-- as 'invited' — that single insert is what notified all 20 people — and the
-- captain now names the squad instead.
--
-- The status vocabulary maps one-to-one onto what already exists, so nothing
-- downstream has to learn new words:
--     selected -> 'invited'    (picked, not yet answered)
--     confirmed -> 'confirmed' (player accepted)
--     declined  -> 'rejected'  (player declined)
--
-- Selected players are seated 'invited', NOT 'confirmed'. Only captains are
-- auto-confirmed in this app; every other player answers a "can you make it"
-- prompt, and filled_slots counts confirmed only. Seating a pick straight to
-- confirmed would mark somebody available without asking them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Roster cap: 20 players per team.
--
--    A trigger, not a check constraint: the rule is about the COUNT of sibling
--    rows, which a per-row CHECK cannot see. Same reasoning as
--    assert_squad_big_enough, and it covers every path into the table — the
--    join_team RPC, an invite, and any future one — rather than one function.
-- ---------------------------------------------------------------------------
create or replace function public.assert_roster_not_full()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.team_members tm
   where tm.team_id = new.team_id;

  if v_count >= 20 then
    raise exception 'TEAM_ROSTER_FULL' using errcode = '23514',
      detail = format('%s of 20 players', v_count);
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_roster_not_full() from public;

drop trigger if exists team_members_roster_cap on public.team_members;
create trigger team_members_roster_cap
  before insert on public.team_members
  for each row execute function public.assert_roster_not_full();

-- ---------------------------------------------------------------------------
-- 2. The lineup itself.
--
--    Replaces one team's side of the sheet in a single call. Idempotent: a
--    captain who changes their mind calls it again with a different array and
--    the previous picks are unseated.
-- ---------------------------------------------------------------------------
create or replace function public.set_match_lineup(
  in_match_id uuid,
  in_team_id  uuid,
  in_user_ids uuid[]
)
returns setof public.match_players
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_match   public.matches%rowtype;
  v_team    public.teams%rowtype;
  v_format  integer;
  v_picked  integer;
  v_captain_role text;
  v_new     uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_match from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_match.status not in ('open', 'locked') then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;
  if in_team_id is null or in_team_id not in (v_match.team_a_id, v_match.team_b_id) then
    raise exception 'TEAM_NOT_IN_MATCH' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = in_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_team.owner_id <> v_uid then
    raise exception 'NOT_THE_CAPTAIN' using errcode = '42501';
  end if;

  -- The format is the fixture's, not the team's: total_slots is per-side x 2.
  v_format := public.challenge_format(v_match.total_slots);
  v_picked := coalesce(array_length(in_user_ids, 1), 0);

  if v_picked <> v_format then
    raise exception 'LINEUP_SIZE_MISMATCH' using errcode = '23514',
      detail = format('%s selected, %s required', v_picked, v_format);
  end if;

  -- Duplicates would pass the count check and then collide on the unique index.
  if v_picked <> (select count(distinct u) from unnest(in_user_ids) as u) then
    raise exception 'LINEUP_DUPLICATE_PLAYER' using errcode = '23514';
  end if;

  -- Every pick must currently be on this roster.
  if exists (
    select 1 from unnest(in_user_ids) as u
     where not exists (
       select 1 from public.team_members tm
        where tm.team_id = in_team_id and tm.user_id = u
     )
  ) then
    raise exception 'LINEUP_NOT_A_MEMBER' using errcode = '23514';
  end if;

  -- The captain plays. They are one of the N, not an extra.
  if not (v_team.owner_id = any(in_user_ids)) then
    raise exception 'LINEUP_MISSING_CAPTAIN' using errcode = '23514';
  end if;

  -- Which captain seat this team holds, so re-selecting does not demote them.
  v_captain_role := case
    when in_team_id = v_match.team_a_id then 'creator'
    else 'opponent_captain'
  end;

  -- Unseat anyone previously picked for THIS team who is no longer in the
  -- lineup. Scoped to team_id so the opponent's side is never touched, and a
  -- player who has already answered is removed rather than left as a ghost.
  delete from public.match_players mp
   where mp.match_id = in_match_id
     and mp.team_id = in_team_id
     and not (mp.user_id = any(in_user_ids));

  -- Seat the lineup. The captain is confirmed (they chose); everyone else is
  -- invited and answers for themselves.
  foreach v_new in array in_user_ids loop
    insert into public.match_players (match_id, user_id, team_id, status, joined_via, role)
    values (
      in_match_id,
      v_new,
      in_team_id,
      case when v_new = v_team.owner_id then 'confirmed' else 'invited' end,
      'challenge',
      case when v_new = v_team.owner_id then v_captain_role else 'player' end
    )
    on conflict (match_id, user_id) do update
      set team_id = excluded.team_id,
          -- An existing answer is preserved: re-picking somebody who already
          -- said yes must not reset them to 'invited' and ask again.
          status = case
            when match_players.status in ('confirmed', 'rejected')
              then match_players.status
            else excluded.status
          end,
          role = excluded.role;

    -- Tell the player they are in, once, and only the players who are in.
    if v_new <> v_team.owner_id then
      perform public.enqueue_notification(
        v_new,
        'lineup_selected',
        'You are in the squad',
        format(
          'You have been selected by %s for the %s v %s match on %s%s.',
          coalesce((select full_name from public.profiles where id = v_team.owner_id), 'your captain'),
          v_format, v_format,
          to_char(v_match.scheduled_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM'),
          coalesce(' at ' || nullif(v_match.venue_text, ''), '')
        ),
        jsonb_build_object('route', '/match/' || in_match_id::text)
      );
    end if;
  end loop;

  return query
    select * from public.match_players
     where match_id = in_match_id and team_id = in_team_id;
end;
$function$;

revoke execute on function public.set_match_lineup(uuid, uuid, uuid[]) from public, anon;
grant  execute on function public.set_match_lineup(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. finalise_challenge seats the two captains and nobody else.
--
--    The removed block is the whole point of this migration:
--
--        insert into public.match_players (...)
--        select v_match.id, tm.user_id, 'invited', 'browse', 'player'
--          from public.team_members tm ...
--
--    That seated — and notified — every member of both rosters. Squads are
--    named by their captain through set_match_lineup instead.
--
--    !! THIS BODY IS BROKEN. DO NOT COPY IT. !!
--
--    The claim that "only the seating block changes" was wrong. This body was
--    reconstructed from a GREPPED view of the function rather than the whole
--    thing, and silently dropped share_code, lat and lng (all NOT NULL, no
--    default) along with the lat/lng fallback chain, the NO_OPPONENT and
--    SELF_CHALLENGE guards, the matches_end_after_start rescue, the
--    search_radius_m clamp, and notes / game_type / venue_text / area_name.
--    Every acceptance of a team fixture failed with a not-null violation.
--
--    It is left here verbatim because it is what was applied to the database.
--    20260907125110_restore_finalise_challenge_body.sql restores the real body
--    a few minutes later, so a rebuild ends up correct. Read THAT file for the
--    function as it actually stands.
-- ---------------------------------------------------------------------------
create or replace function public.finalise_challenge(
  in_challenge_id uuid,
  in_to_team_id   uuid
)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_c     public.team_challenges%rowtype;
  v_match public.matches%rowtype;
  v_try   integer := 0;
begin
  select * into v_c from public.team_challenges where id = in_challenge_id;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  loop
    v_try := v_try + 1;
    begin
      insert into public.matches (
        creator_id, sport, match_name, venue_id, venue_text, area_name,
        scheduled_at, end_time, total_slots, missing_count, status,
        team_a_id, team_b_id, challenge_id, match_type, match_lat, match_lng
      )
      values (
        v_c.created_by,
        (select sport from public.teams where id = v_c.from_team_id),
        v_c.match_name, v_c.venue_id,
        (select name from public.venues where id = v_c.venue_id),
        v_c.area_name,
        v_c.scheduled_at, v_c.end_time, v_c.total_slots, 0, 'open',
        v_c.from_team_id, in_to_team_id, v_c.id, 'team_vs_team',
        v_c.match_lat, v_c.match_lng
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Seat both team owners as captains. Their squads are named afterwards.
  insert into public.match_players (match_id, user_id, team_id, status, joined_via, role)
  select v_match.id, owner_id, team_id, 'confirmed', 'challenge', role
    from (
      select distinct on (t.owner_id)
             t.owner_id,
             t.id as team_id,
             case when t.id = v_c.from_team_id then 'creator' else 'opponent_captain' end as role
        from public.teams t
       where t.id in (v_c.from_team_id, in_to_team_id)
       order by t.owner_id, (t.id <> v_c.from_team_id)
    ) captains
  on conflict (match_id, user_id) do update
    set status = 'confirmed', team_id = excluded.team_id;

  update public.team_challenges
     set match_id = v_match.id
   where id = v_c.id;

  update public.captain_chat_messages
     set match_id = v_match.id
   where challenge_id = v_c.id and match_id is null;

  return v_match;
end;
$function$;

revoke execute on function public.finalise_challenge(uuid, uuid) from public, anon;
grant  execute on function public.finalise_challenge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Accepting a fixture requires the accepting captain's lineup.
--
--    Third argument, and the two-argument version is DROPPED rather than kept
--    beside it: an overload that confirms a fixture with no squad is exactly
--    the behaviour being replaced, and an old client should fail loudly.
--
--    Only ONE captain is present at acceptance, so only their side can be
--    named here. The poster is notified to name theirs.
-- ---------------------------------------------------------------------------
drop function if exists public.accept_open_challenge(uuid, uuid);

create or replace function public.accept_open_challenge(
  in_challenge_id uuid,
  in_team_id      uuid,
  in_lineup       uuid[]
)
returns public.team_challenges
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_uid   uuid := (select auth.uid());
  v_c     public.team_challenges%rowtype;
  v_team  public.teams%rowtype;
  v_match public.matches%rowtype;
  v_loser record;
  v_is_host boolean := false;
  v_is_applicant_owner boolean := false;
  v_format integer;
  v_lineup_team uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'open' then
    raise exception 'CHALLENGE_ALREADY_TAKEN' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = in_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_is_host := (v_c.created_by = v_uid or exists (
    select 1 from public.teams t where t.id = v_c.from_team_id and t.owner_id = v_uid
  ));
  v_is_applicant_owner := (v_team.owner_id = v_uid);

  if not v_is_host and not v_is_applicant_owner then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.challenge_candidates cc
     where cc.challenge_id = v_c.id
       and cc.team_id = in_team_id
       and cc.status in ('offered', 'interested')
  ) then
    raise exception 'NOT_OFFERED' using errcode = '42501';
  end if;

  if not public.team_format_matches(in_team_id, v_c.total_slots) then
    raise exception 'FORMAT_MISMATCH' using errcode = '23514',
      detail = format('opponent plays %s a side, fixture is %s v %s',
        coalesce((select target_size::text from public.teams where id = in_team_id), 'no declared format'),
        public.challenge_format(v_c.total_slots),
        public.challenge_format(v_c.total_slots));
  end if;
  if not public.team_format_matches(v_c.from_team_id, v_c.total_slots) then
    raise exception 'FORMAT_MISMATCH' using errcode = '23514',
      detail = format('host plays %s a side, fixture is %s v %s',
        coalesce((select target_size::text from public.teams where id = v_c.from_team_id), 'no declared format'),
        public.challenge_format(v_c.total_slots),
        public.challenge_format(v_c.total_slots));
  end if;

  /*
    The lineup belongs to the team the CALLER captains, which is not always
    `in_team_id`.

    Two captains can reach this function. An applicant's owner accepting an
    offer names their own squad — `in_team_id`. A HOST letting somebody else's
    team in is naming THEIRS, `from_team_id`; `in_team_id` there belongs to the
    opponent, whose players the host has no right to pick.

    Owning the accepting team wins, because one person can be both: the poster's
    candidate list lets them accept a row flagged `i_own_team`, and there they
    are acting AS that team.
  */
  v_lineup_team := case when v_is_applicant_owner then in_team_id else v_c.from_team_id end;

  -- Checked BEFORE the match is built, so a bad lineup cannot leave a confirmed
  -- fixture with an unnamed squad behind it.
  v_format := public.challenge_format(v_c.total_slots);
  if coalesce(array_length(in_lineup, 1), 0) <> v_format then
    raise exception 'LINEUP_SIZE_MISMATCH' using errcode = '23514',
      detail = format('%s selected, %s required',
        coalesce(array_length(in_lineup, 1), 0), v_format);
  end if;

  v_match := public.finalise_challenge(v_c.id, in_team_id);

  update public.team_challenges
     set status = 'accepted',
         to_team_id = in_team_id,
         responded_at = now(),
         match_id = v_match.id
   where id = v_c.id
   returning * into v_c;

  update public.challenge_candidates
     set status = 'accepted', responded_at = now()
   where challenge_id = v_c.id and team_id = in_team_id;

  for v_loser in
    update public.challenge_candidates
       set status = 'expired', responded_at = now()
     where challenge_id = v_c.id
       and team_id <> in_team_id
       and status in ('offered', 'interested')
     returning team_id
  loop
    perform public.enqueue_notification(
      (select owner_id from public.teams where id = v_loser.team_id),
      'challenge_taken',
      'Match fixture taken',
      'Another team locked in the fixture with ' || (select name from public.teams where id = v_c.from_team_id) || '.',
      jsonb_build_object('route', '/(tabs)/teams')
    );
  end loop;

  -- The accepting captain's squad. Full validation (membership, duplicates,
  -- captain included) lives in set_match_lineup; this raises out of the same
  -- transaction, so a refused lineup rolls the fixture back with it.
  perform public.set_match_lineup(v_match.id, v_lineup_team, in_lineup);

  -- The other captain still owes a squad, and this is the only prompt they get.
  perform public.enqueue_notification(
    case when v_is_applicant_owner then v_c.created_by else v_team.owner_id end,
    'challenge_accepted',
    'Match Confirmed!',
    'Your ' || v_format || ' v ' || v_format || ' between '
      || (select name from public.teams where id = v_c.from_team_id)
      || ' and ' || v_team.name || ' is fixed. Pick your squad.',
    jsonb_build_object('route', '/match/' || v_match.id::text)
  );

  return v_c;
end;
$function$;

revoke execute on function public.accept_open_challenge(uuid, uuid, uuid[]) from anon, public;
grant  execute on function public.accept_open_challenge(uuid, uuid, uuid[]) to authenticated;
