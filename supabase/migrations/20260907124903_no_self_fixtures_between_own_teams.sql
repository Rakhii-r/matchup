-- ============================================================================
-- A captain cannot play themselves, with ANY of their teams.
--
-- `rank_challenge_candidates` has always refused to OFFER a fixture to a team
-- the poster owns. Nothing else agreed with it:
--
--   * apply_to_open_challenge blocked only the SAME team, so a second squad you
--     own could apply to your own fixture — and enqueue a `challenge_interest`
--     notification to yourself on the way in.
--   * create_challenge blocked only `v_to.id = v_from.id`, so entering your own
--     other team's invite code produced a self-fixture directly.
--   * accept_open_challenge would then happily finalise it.
--
-- That inconsistency is also what made the lineup-team ambiguity reachable: one
-- person being both host and applicant-owner is only possible in a self-fixture.
-- Closing it here removes that whole class.
--
-- Enforced as a TRIGGER plus an early guard, deliberately:
--   * the trigger is the guarantee — it covers create_challenge, the accept
--     path, and any future writer, exactly as assert_squad_big_enough does;
--   * the guard in apply_to_open_challenge is what makes the refusal HAPPEN
--     BEFORE `enqueue_notification`, which is the point: no self-notifications.
-- ============================================================================

-- One definition of "these two squads have the same captain", so the rule
-- cannot drift between the trigger and the two RPCs that also check it.
create or replace function public.teams_share_owner(in_a uuid, in_b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select in_a is not null
     and in_b is not null
     and exists (
       select 1
         from public.teams ta
         join public.teams tb on tb.id = in_b
        where ta.id = in_a
          and ta.owner_id = tb.owner_id
     );
$function$;

revoke execute on function public.teams_share_owner(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- The guarantee. Fires on insert (create_challenge names to_team_id straight
-- away) and on update (accept_open_challenge sets it later), so both shapes of
-- fixture are covered by one rule.
-- ---------------------------------------------------------------------------
create or replace function public.assert_not_self_fixture()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- to_team_id is null on an open challenge that has not been taken yet; there
  -- is no pairing to judge until somebody is on the other side.
  if new.to_team_id is not null
     and public.teams_share_owner(new.from_team_id, new.to_team_id) then
    raise exception 'SELF_CHALLENGE' using errcode = '23514',
      detail = 'both squads have the same captain';
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_not_self_fixture() from public, anon, authenticated;

drop trigger if exists team_challenges_self_fixture_check on public.team_challenges;
create trigger team_challenges_self_fixture_check
  before insert or update on public.team_challenges
  for each row execute function public.assert_not_self_fixture();

-- ---------------------------------------------------------------------------
-- Refuse the application BEFORE any notification is enqueued.
--
-- Only the SELF_CHALLENGE condition changes; the rest of the function is the
-- strict-format version from 20260904092956, unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.apply_to_open_challenge(
  in_challenge_id uuid,
  in_team_id      uuid
)
returns public.challenge_candidates
language plpgsql
volatile
security definer
set search_path = public
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

  /*
    You cannot play yourself — not with this team, and not with any other team
    you captain.

    Raised here, before the insert and before enqueue_notification, so applying
    with a second squad you own is silently impossible rather than something
    that pings you about your own fixture. The trigger on team_challenges is the
    real guarantee; this is the clean early refusal.
  */
  if v_team.id = v_c.from_team_id
     or public.teams_share_owner(v_team.id, v_c.from_team_id) then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
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

revoke execute on function public.apply_to_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.apply_to_open_challenge(uuid, uuid) to authenticated;
