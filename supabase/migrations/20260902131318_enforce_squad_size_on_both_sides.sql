-- The squad rule was ONE-SIDED. 20260901134003 put a BEFORE INSERT trigger on
-- team_challenges checking `from_team_id`, so the team POSTING a 4 v 4 needs 4
-- players. Nothing ever checked the team on the other side.
--
-- Verified against production in a rolled-back transaction: ASR WARRIORS (4
-- players) posted a 4 v 4, Amy titans (ONE player) applied and was accepted, and
-- finalise_challenge happily produced a confirmed fixture with 4 players on one
-- side and 1 on the other. Neither apply_to_open_challenge nor
-- accept_open_challenge nor respond_to_challenge looks at squad size.
--
-- Three entry points have to be covered, and they set to_team_id at different
-- moments, which is why one trigger is not enough:
--   * create_challenge     writes to_team_id AT INSERT (direct invite by code)
--   * accept_open_challenge writes it on UPDATE (radar / open challenge)
--   * respond_to_challenge  never touches it -- to_team_id was already there
--                           from the insert; it only moves status to 'accepted'
-- So: check to_team_id on insert when it is present, and check it again on the
-- transition into 'accepted', which every acceptance path must pass through.

-- One definition of "big enough", so the rule cannot drift between call sites.
-- total_slots is players-per-side x 2, so a side needs half of it.
create or replace function public.squad_meets_size(in_team_id uuid, in_total_slots integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select in_team_id is null
      or (select count(*) from public.team_members tm where tm.team_id = in_team_id)
         >= greatest(coalesce(in_total_slots, 0) / 2, 1);
$function$;

revoke execute on function public.squad_meets_size(uuid, integer) from anon, authenticated;

-- Poster on insert (unchanged behaviour), plus the invited team when
-- create_challenge names one straight away.
create or replace function public.assert_squad_big_enough()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.squad_meets_size(new.from_team_id, new.total_slots) then
    raise exception 'SQUAD_TOO_SMALL' using errcode = '23514',
      detail = format('%s of %s players',
        (select count(*) from public.team_members where team_id = new.from_team_id),
        greatest(new.total_slots / 2, 1));
  end if;

  if not public.squad_meets_size(new.to_team_id, new.total_slots) then
    raise exception 'OPPONENT_SQUAD_TOO_SMALL' using errcode = '23514',
      detail = format('%s of %s players',
        (select count(*) from public.team_members where team_id = new.to_team_id),
        greatest(new.total_slots / 2, 1));
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_squad_big_enough() from anon, authenticated;

-- The acceptance gate. Fires on the transition into 'accepted' whichever path
-- got there, so a fixture can never be confirmed against a short squad.
create or replace function public.assert_opponent_squad_on_accept()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    if not public.squad_meets_size(new.to_team_id, new.total_slots) then
      raise exception 'OPPONENT_SQUAD_TOO_SMALL' using errcode = '23514',
        detail = format('%s of %s players',
          (select count(*) from public.team_members where team_id = new.to_team_id),
          greatest(new.total_slots / 2, 1));
    end if;
    if not public.squad_meets_size(new.from_team_id, new.total_slots) then
      raise exception 'SQUAD_TOO_SMALL' using errcode = '23514',
        detail = format('%s of %s players',
          (select count(*) from public.team_members where team_id = new.from_team_id),
          greatest(new.total_slots / 2, 1));
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.assert_opponent_squad_on_accept() from anon, authenticated;

drop trigger if exists team_challenges_squad_check_on_accept on public.team_challenges;
create trigger team_challenges_squad_check_on_accept
  before update on public.team_challenges
  for each row execute function public.assert_opponent_squad_on_accept();

-- Fail at the moment the opponent taps "send request", not after the host has
-- accepted and a match has been built. 'offered' rows are written by
-- rank_challenge_candidates -- the radar suggesting teams -- and are deliberately
-- left alone: being offered a fixture is not a commitment, and silently hiding
-- short squads from the radar would look like the radar was broken.
create or replace function public.assert_applicant_squad_big_enough()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slots integer;
begin
  if new.status <> 'interested' then
    return new;
  end if;

  select total_slots into v_slots
    from public.team_challenges where id = new.challenge_id;

  if not public.squad_meets_size(new.team_id, v_slots) then
    raise exception 'SQUAD_TOO_SMALL' using errcode = '23514',
      detail = format('%s of %s players',
        (select count(*) from public.team_members where team_id = new.team_id),
        greatest(coalesce(v_slots, 0) / 2, 1));
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_applicant_squad_big_enough() from anon, authenticated;

drop trigger if exists challenge_candidates_squad_check on public.challenge_candidates;
create trigger challenge_candidates_squad_check
  before insert or update on public.challenge_candidates
  for each row execute function public.assert_applicant_squad_big_enough();
