-- Final form of respond_to_challenge. Fixes defect 1 (block bypass) and
-- defect 2 (capacity), and records the true joined_via.
--
-- A first attempt at the block rule skipped BOTH sides of a block, which
-- emptied the roster: if a squad member had blocked the opposing captain, the
-- captain was dropped too. Verified on prod, then corrected here.
--
-- Correct rule: the two owners are the people who agreed the fixture, and an
-- owner-vs-owner block is already refused at create_challenge. So an owner is
-- always seated. A non-owner member is skipped when they have a block against
-- anyone on the OPPOSING side (own-team blocks are not this feature's business)
-- or against the match creator. Skipping rather than failing the whole fixture
-- keeps the match alive; a skipped player can still join deliberately later.
create or replace function public.respond_to_challenge(
  in_challenge_id uuid,
  in_accept       boolean
)
returns public.team_challenges
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := (select auth.uid());
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_venue public.venues%rowtype;
  v_match public.matches%rowtype;
  v_code  text;
  v_try   int;
  v_count int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'CHALLENGE_ALREADY_ANSWERED' using errcode = '23514';
  end if;

  select * into v_to from public.teams where id = v_c.to_team_id;
  if v_to.owner_id <> v_uid then
    raise exception 'NOT_OPPONENT_OWNER' using errcode = '42501';
  end if;

  if not in_accept then
    update public.team_challenges set status='declined', responded_at=now()
     where id = v_c.id returning * into v_c;
    return v_c;
  end if;

  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_venue from public.venues where id = v_c.venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The sheet must actually hold both squads. sync_filled_slots clamps with
  -- least(), so without this an oversized roster looks full while being
  -- silently over-subscribed.
  select count(distinct tm.user_id) into v_count
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, v_c.to_team_id);
  if v_count > v_c.total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, v_venue.name, v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_venue.lat, v_venue.lng, v_c.match_name, v_c.message,
        v_c.from_team_id, v_c.to_team_id, v_c.id
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, status, joined_via)
  select v_match.id, tm.user_id, 'confirmed', 'challenge'
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, v_c.to_team_id)
     and tm.user_id <> v_c.created_by
     and (
       tm.role = 'owner'
       or (
         not public.is_blocked_between(tm.user_id, v_c.created_by)
         and not exists (
           select 1
             from public.team_members opp
            where opp.team_id = case
                                  when tm.team_id = v_c.from_team_id then v_c.to_team_id
                                  else v_c.from_team_id
                                end
              and public.is_blocked_between(tm.user_id, opp.user_id)
         )
       )
     )
  on conflict (match_id, user_id) do nothing;

  update public.team_challenges
     set status='accepted', responded_at=now(), match_id=v_match.id
   where id = v_c.id returning * into v_c;

  return v_c;
end;
$$;
