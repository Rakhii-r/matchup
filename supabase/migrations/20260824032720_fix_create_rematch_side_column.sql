-- Backfilled into the repo after the fact — this was applied directly to the
-- project (recorded remotely as migration version 20260824032720,
-- "fix_create_rematch_side_column") without a matching local file. Content
-- below is reconstructed from the live function definition so this file
-- documents what is actually running rather than replacing it.
--
-- Bug: create_rematch's player-copy insert named a `side` column on
-- match_players. That column does not exist — match_players has only
-- `team_id`, and list_match_players derives 'a'/'b' from whether team_id
-- matches the match's team_a_id or team_b_id. Every "Play again" call failed
-- outright with "column \"side\" of relation \"match_players\" does not exist".
--
-- This was the SECOND reason "Play again" never worked; the first (the
-- SLOT_EXPIRED / end_time gate) was already removed in the same day's
-- 20260824040000_auto_complete_second_innings.sql, which is why that file's
-- copy of create_rematch looks identical to this one — the fix landed twice
-- in two different places (once here, applied directly; once there, checked
-- into the repo) and they happen to agree.

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
  v_now       timestamptz := now();
  v_code      text;
  v_try       integer;
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

  if not (v_orig.creator_id = v_uid or public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_ALLOWED_TO_REMATCH' using errcode = '42501';
  end if;

  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  select count(*) into v_count
    from public.matches
   where id = in_match_id
      or rematch_of = in_match_id
      or id = v_orig.rematch_of
      or rematch_of = v_orig.rematch_of;

  v_game_num := v_count + 1;
  v_base_name := regexp_replace(v_orig.match_name, '\s*\(Game\s*\d+\)$', '', 'i');
  v_new_name := v_base_name || ' (Game ' || v_game_num || ')';

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

  -- `side` is not a column on match_players; list_match_players derives it from
  -- team_id against the match's team_a_id / team_b_id. Naming it here is what
  -- made create_rematch fail outright.
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

revoke execute on function public.create_rematch(uuid) from anon, public;
grant  execute on function public.create_rematch(uuid) to authenticated;
