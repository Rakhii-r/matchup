-- Latent bug: if one person owns BOTH teams in a fixture (owner testing two
-- squads, or a real case of one captain running two sides), finalise_challenge's
-- captain-seating insert selects the SAME owner_id twice in one statement (once
-- as 'creator', once as 'opponent_captain'). ON CONFLICT (match_id, user_id) DO
-- UPDATE cannot affect the same row twice within a single statement — Postgres
-- raises 21000 "ON CONFLICT DO UPDATE command cannot affect row a second time"
-- — so accept_open_challenge/respond_to_challenge would fail for that pairing.
--
-- Fixed by deduplicating on owner_id before the insert, keeping the 'creator'
-- role on a tie since that's the side the person actually organised. Nothing
-- else in the function changes.

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
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_venue public.venues%rowtype;
  v_match public.matches%rowtype;
  v_code  text;
  v_try   int;
  v_lat   double precision;
  v_lng   double precision;
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

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name, 'Local Ground'), coalesce(v_c.area_name, 'Local Area'), v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id
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
$$;
