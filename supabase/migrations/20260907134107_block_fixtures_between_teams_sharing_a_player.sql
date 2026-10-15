-- The radar has always refused to pair two squads that share a player:
-- rank_challenge_candidates carries a `not exists (tm1 join tm2 on user_id)`
-- clause. Nothing else did, so a captain could still apply by hand, the accept
-- went through, and set_match_lineup's
--
--     on conflict (match_id, user_id) do update set team_id = excluded.team_id
--
-- silently MOVED the shared player to whichever side named them last. The other
-- side was left a man short with no error anywhere: a 4v4 fixture came out as a
-- 3 / 4 / 7 sheet.
--
-- The three write paths now agree with the radar. Guards are raised BEFORE
-- enqueue_notification in every case, so a refused pairing never notifies.

create or replace function public.teams_share_players(in_a uuid, in_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select in_a is not null and in_b is not null and exists (
    select 1
      from public.team_members ta
      join public.team_members tb on tb.user_id = ta.user_id
     where ta.team_id = in_a
       and tb.team_id = in_b
  );
$function$;

revoke execute on function public.teams_share_players(uuid, uuid) from public, anon;
grant  execute on function public.teams_share_players(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The backstop. Every pairing writes team_challenges.to_team_id, on insert
--    (direct challenge) or on update (accept), so this catches paths that do
--    not go through the RPCs below.
-- ---------------------------------------------------------------------------
create or replace function public.assert_not_self_fixture()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.to_team_id is not null then
    if public.teams_share_owner(new.from_team_id, new.to_team_id) then
      raise exception 'SELF_CHALLENGE' using errcode = '23514',
        detail = 'both squads have the same captain';
    end if;
    if public.teams_share_players(new.from_team_id, new.to_team_id) then
      raise exception 'SHARED_PLAYER' using errcode = '23514',
        detail = 'the same player is on both squads';
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Applying to somebody else's open fixture.
-- ---------------------------------------------------------------------------
create or replace function public.apply_to_open_challenge(in_challenge_id uuid, in_team_id uuid)
returns public.challenge_candidates
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_c    public.team_challenges%rowtype;
  v_team public.teams%rowtype;
  v_from public.teams%rowtype;
  v_row  public.challenge_candidates%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'open' then
    raise exception 'CHALLENGE_ALREADY_TAKEN' using errcode = '23514';
  end if;
  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_team from public.teams where id = in_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_team.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  -- You cannot play yourself — not with this team, and not with any other team
  -- you captain. Raised before the insert and before enqueue_notification, so
  -- no self-notification is ever produced.
  if v_team.id = v_c.from_team_id
     or public.teams_share_owner(v_team.id, v_c.from_team_id) then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  -- Nor can a squad play a squad it shares a player with: one body cannot be on
  -- both team sheets, and the lineup upsert would quietly move them.
  if public.teams_share_players(v_team.id, v_c.from_team_id) then
    raise exception 'SHARED_PLAYER' using errcode = '23514',
      detail = 'the same player is on both squads';
  end if;

  select * into v_from from public.teams where id = v_c.from_team_id;
  if v_team.sport <> v_from.sport then
    raise exception 'SPORT_MISMATCH' using errcode = '23514';
  end if;

  if not public.team_format_matches(v_team.id, v_c.total_slots) then
    raise exception 'FORMAT_MISMATCH' using errcode = '23514',
      detail = format('%s v %s fixture, your team plays %s a side',
        public.challenge_format(v_c.total_slots),
        public.challenge_format(v_c.total_slots),
        coalesce(v_team.target_size::text, 'no declared format'));
  end if;

  if public.is_blocked_between(v_uid, v_c.created_by) then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status, responded_at)
  values (v_c.id, v_team.id, 1, 0, 'interested', now())
  on conflict (challenge_id, team_id)
  do update set
    status = 'interested',
    responded_at = now()
  returning * into v_row;

  perform public.enqueue_notification(
    v_c.created_by,
    'challenge_interest',
    'New Match Request!',
    v_team.name || ' wants to play your '
      || public.challenge_format(v_c.total_slots) || ' v '
      || public.challenge_format(v_c.total_slots) || '. Tap to review and accept.',
    jsonb_build_object('route', '/match/create/searching', 'challengeId', v_c.id)
  );

  return v_row;
end;
$function$;

revoke execute on function public.apply_to_open_challenge(uuid, uuid) from public, anon;
grant  execute on function public.apply_to_open_challenge(uuid, uuid) to authenticated;
