-- URGENT FIX to 20260907105244_roster_cap_and_match_lineups.
--
-- That migration rewrote finalise_challenge from a GREPPED view of the
-- function rather than the whole body, and silently dropped everything the grep
-- had not matched:
--
--   * `share_code` (generated per attempt by gen_share_code() — which is what
--     the unique_violation retry loop exists for), plus `lat` and `lng`.
--     All three are NOT NULL with no default, so EVERY acceptance of a team
--     fixture failed with a not-null violation.
--   * the lat/lng fallback chain: venue -> challenge coords -> squad centroid
--     -> a final default, so a fixture always has coordinates.
--   * the NO_OPPONENT and SELF_CHALLENGE guards.
--   * the `matches_end_after_start` rescue (a stale end_time is dropped rather
--     than aborting the accept) and the search_radius_m sanity clamp.
--   * venue_text / area_name coalesces, notes, game_type, search_radius_m.
--
-- This restores the original body verbatim and re-applies ONLY the intended
-- change: the "seat squad members as invited" block is gone, because that is
-- what notified all 20 roster members. Captains are seated here; squads are
-- named afterwards by set_match_lineup.
--
-- The captain insert additionally carries team_id now, which the original
-- omitted — set_match_lineup and the match screen both key off it.

create or replace function public.finalise_challenge(
  in_challenge_id uuid,
  in_to_team_id   uuid
)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c      public.team_challenges%rowtype;
  v_to     public.teams%rowtype;
  v_venue  public.venues%rowtype;
  v_match  public.matches%rowtype;
  v_code   text;
  v_try    int;
  v_lat    double precision;
  v_lng    double precision;
  v_end    timestamptz;
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

  -- matches_end_after_start refuses an end_time that is not strictly after
  -- scheduled_at. A stale row that violates it must not abort the accept:
  -- losing the fixture is worse than losing the slot limit.
  v_end := v_c.end_time;
  if v_end is not null and v_end <= v_c.scheduled_at then
    v_end := null;
  end if;

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

  -- Seat both team owners as captains, WITH their team_id: set_match_lineup and
  -- the match screen both resolve "which side is this person on" from it.
  insert into public.match_players (match_id, user_id, team_id, status, joined_via, role)
  select v_match.id, owner_id, team_id, 'confirmed', 'browse', role
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

  -- The "seat squad members as invited" block that used to follow is REMOVED.
  -- It inserted every member of both rosters and is what notified all 20.
  -- Squads are named by their captain through set_match_lineup.

  update public.team_challenges
     set match_id = v_match.id
   where id = v_c.id;

  -- Link any pre-match chat messages to this match
  update public.captain_chat_messages
     set match_id = v_match.id
   where challenge_id = v_c.id and match_id is null;

  return v_match;
end;
$$;

revoke execute on function public.finalise_challenge(uuid, uuid) from public, anon;
grant  execute on function public.finalise_challenge(uuid, uuid) to authenticated;
