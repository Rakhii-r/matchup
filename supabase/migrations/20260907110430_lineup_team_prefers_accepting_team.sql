-- Follow-up to roster_cap_and_match_lineups.
--
-- `v_lineup_team` preferred `v_is_host`, which is wrong when one person is BOTH
-- the poster and the owner of the accepting team — reachable from the poster's
-- candidate list, where a row flagged `i_own_team` can be accepted. There the
-- caller is acting AS the accepting team, so that is the squad they are naming;
-- preferring the host branch would have named the wrong side's lineup.
--
-- Owning the accepting team wins. Falling back to `from_team_id` still covers a
-- host letting somebody else's team in, who can only name their own squad.

drop function if exists public.resolve_lineup_team(boolean, uuid, uuid);

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

  -- The squad the CALLER is acting as. Owning the accepting team wins; a host
  -- letting another team in can only name their own side.
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

  perform public.set_match_lineup(v_match.id, v_lineup_team, in_lineup);

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
