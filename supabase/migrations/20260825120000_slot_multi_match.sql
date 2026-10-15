-- ============================================================================
-- Multi-match ("N games") within one booked slot.
--
-- A booked slot is one `end_time`. Every game played inside it is a separate
-- `matches` row sharing a `rematch_of` root and copying that root's `end_time`,
-- so the whole series has one cutoff.
--
-- Three changes:
--   1. finalise_challenge  — copy end_time / game_type / search_radius_m from
--      the challenge. It never did, which is the real reason 19 of the 22 rows
--      in this database have a null end_time: the wizard has been collecting an
--      end time and post_open_challenge has been storing it on
--      team_challenges all along, and then the match got built without it.
--   2. create_rematch      — slot gate, correct game numbering, name clamping,
--      series serialisation, roster copy, roster notification.
--   3. get_match_series    — every game in one slot with its innings totals.
--
-- On the slot gate specifically: a NULL end_time means "no booked slot" and is
-- ALLOWED, it is not an expiry. The version of this function shipped on
-- 20 Aug raised SLOT_EXPIRED on a null, which killed Play Again for every match
-- in the database and had to be removed on 24 Aug. Only a slot that exists and
-- has passed refuses.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. finalise_challenge — carry the booked slot onto the match it creates.
-- ---------------------------------------------------------------------------
create or replace function public.finalise_challenge(in_challenge_id uuid, in_to_team_id uuid)
returns public.matches
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_venue public.venues%rowtype;
  v_match public.matches%rowtype;
  v_code  text;
  v_try   int;
  v_lat   double precision;
  v_lng   double precision;
  v_end   timestamptz;
  v_radius integer;
begin
  if in_to_team_id is null then
    raise exception 'NO_OPPONENT' using errcode = '23514';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if in_to_team_id = v_c.from_team_id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  select * into v_to from public.teams where id = in_to_team_id;
  if not found then
    raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_c.venue_id is not null then
    select * into v_venue from public.venues where id = v_c.venue_id;
  end if;

  v_lat := coalesce(v_venue.lat, v_c.match_lat, (select st_y(tl::geometry) from public.team_location(v_c.from_team_id) tl), 18.5204);
  v_lng := coalesce(v_venue.lng, v_c.match_lng, (select st_x(tl::geometry) from public.team_location(v_c.from_team_id) tl), 73.8567);

  -- The booked slot. `matches_end_after_start` refuses an end_time that is not
  -- strictly after scheduled_at, and a challenge posted with an end time
  -- earlier in the day than its start means the game runs past midnight — the
  -- client already rolls that onto the next day before storing it. Defend
  -- anyway: a stale row that violates the constraint would abort the whole
  -- accept, and losing the fixture is worse than losing the slot limit.
  v_end := v_c.end_time;
  if v_end is not null and v_end <= v_c.scheduled_at then
    v_end := null;
  end if;

  -- matches_search_radius_m_check allows null or 1000..50000. Same reasoning:
  -- an out-of-range legacy value must not be allowed to abort the accept.
  v_radius := v_c.search_radius_m;
  if v_radius is not null and (v_radius < 1000 or v_radius > 50000) then
    v_radius := null;
  end if;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id,
        end_time, game_type, search_radius_m, match_type
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name, 'Local Ground'), coalesce(v_c.area_name, 'Local Area'), v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id,
        v_end, coalesce(v_c.game_type, 'friendly'), v_radius, 'team_vs_team'
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Seat both team owners as captains. DISTINCT ON dedupes the same-owner
  -- case: without it, one person owning both teams would make this SELECT
  -- emit two rows for the same (match_id, user_id), and ON CONFLICT DO UPDATE
  -- cannot affect the same row twice within one statement. The ordering keeps
  -- 'creator' on a tie, since that's the side the person actually organised.
  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, owner_id, 'confirmed', 'browse', role
    from (
      select distinct on (t.owner_id)
             t.owner_id,
             case when t.id = v_c.from_team_id then 'creator' else 'opponent_captain' end as role
        from public.teams t
       where t.id in (v_c.from_team_id, in_to_team_id)
       order by t.owner_id, (t.id <> v_c.from_team_id)
    ) captains
  on conflict (match_id, user_id) do update set status = 'confirmed';

  -- Seat squad members as invited
  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, tm.user_id, 'invited', 'browse', 'player'
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where tm.team_id in (v_c.from_team_id, in_to_team_id)
     and tm.user_id <> t.owner_id
  on conflict (match_id, user_id) do nothing;

  update public.team_challenges
     set match_id = v_match.id
   where id = v_c.id;

  return v_match;
end;
$fn$;

revoke execute on function public.finalise_challenge(uuid, uuid) from anon, public;

-- ---------------------------------------------------------------------------
-- 2. create_rematch — the next game in the same booked slot.
-- ---------------------------------------------------------------------------
create or replace function public.create_rematch(in_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path to 'public'
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

  if not (v_orig.creator_id = v_uid or public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_ALLOWED_TO_REMATCH' using errcode = '42501';
  end if;

  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  -- The root of the series. Every game in one slot points at it, including the
  -- first game, whose own rematch_of is null.
  v_root := coalesce(v_orig.rematch_of, v_orig.id);

  -- Serialise the whole series, not just this one row. Two captains tapping
  -- "Play Next Match" at the same instant would otherwise both read game count
  -- N and both insert game N+1. The lock is transaction-scoped and keyed on
  -- the root, so concurrent rematches of DIFFERENT slots never block.
  perform pg_advisory_xact_lock(hashtextextended(v_root::text, 0));

  -- Slot gate. A null end_time is a match with no booked slot, not an expired
  -- one — it is allowed through. Only a slot that exists and has passed stops
  -- the series. Re-read here so the check sits inside the lock.
  if v_orig.end_time is not null and v_orig.end_time <= v_now then
    raise exception 'SLOT_EXPIRED' using errcode = '23514';
  end if;

  -- Idempotent within the series: if a game is already waiting or in progress,
  -- hand that one back instead of stacking another on top of it. Covers the
  -- double-tap and the case where two players open the result screen and both
  -- press the CTA a few seconds apart.
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

  -- Strip an existing "(Game N)" or "· Game N" so numbering never compounds.
  v_base_name := regexp_replace(coalesce(v_orig.match_name, 'Match'), '\s*(\(Game\s*\d+\)|·\s*Game\s*\d+)\s*$', '', 'i');
  v_base_name := trim(v_base_name);
  if v_base_name = '' then
    v_base_name := 'Match';
  end if;

  -- matches_match_name_len caps the column at 80 characters and the base name
  -- may already be at that cap, so the base is trimmed to fit the suffix rather
  -- than letting the insert abort.
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

  -- Roster copy. `side` is NOT a column on match_players — list_match_players
  -- derives 'a'/'b' from team_id against the match's team_a_id / team_b_id, so
  -- carrying team_id across is what carries the sides across.
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

  -- Tell the slot the next game is on. The caller already knows — they tapped
  -- the button — so they are skipped rather than pushed to their own device.
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
      'Same teams, same ground. Tap to join the toss.',
      jsonb_build_object('route', '/match/' || v_new.id::text || '/toss', 'match_id', v_new.id)
    );
  end loop;

  return v_new;
end;
$fn$;

revoke execute on function public.create_rematch(uuid) from anon, public;
grant  execute on function public.create_rematch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_match_series — every game played in one booked slot.
--
-- Returned oldest-first so game_number and array order agree. Innings totals
-- are pivoted onto the two team columns so the caller does not need a second
-- round trip per game to render a series score.
-- ---------------------------------------------------------------------------
create or replace function public.get_match_series(in_match_id uuid)
returns table (
  id             uuid,
  game_number    integer,
  match_name     text,
  status         text,
  scheduled_at   timestamptz,
  end_time       timestamptz,
  team_a_id      uuid,
  team_b_id      uuid,
  winner_team_id uuid,
  result_text    text,
  team_a_runs    integer,
  team_a_wickets integer,
  team_b_runs    integer,
  team_b_wickets integer,
  is_current     boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_root uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Visibility is the requested match's, not the series': you may read the
  -- series only through a game you are actually on.
  select coalesce(m.rematch_of, m.id) into v_root
    from public.matches m
   where m.id = in_match_id
     and (
       m.creator_id = v_uid
       or public.is_match_captain(m.id, v_uid)
       or public.is_match_player(m.id, v_uid)
     );
  if v_root is null then
    return;
  end if;

  return query
  with games as (
    select m.*,
           row_number() over (order by m.created_at asc)::integer as game_number
      from public.matches m
     where m.id = v_root or m.rematch_of = v_root
  )
  select
    g.id,
    g.game_number,
    g.match_name,
    g.status,
    g.scheduled_at,
    g.end_time,
    g.team_a_id,
    g.team_b_id,
    g.winner_team_id,
    g.result_text,
    a.runs,
    a.wickets,
    b.runs,
    b.wickets,
    (g.id = in_match_id)
  from games g
  left join public.innings a on a.match_id = g.id and a.batting_team_id = g.team_a_id
  left join public.innings b on b.match_id = g.id and b.batting_team_id = g.team_b_id
  order by g.game_number asc;
end;
$fn$;

revoke execute on function public.get_match_series(uuid) from anon, public;
grant  execute on function public.get_match_series(uuid) to authenticated;
