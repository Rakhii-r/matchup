-- Defect 2 (capacity) and defect 3 (lapsed-challenge deadlock) in create_challenge.
-- Defect 1 (block bypass) lands in respond_to_challenge here and is then refined
-- by the next migration, 20260805065022_challenge_block_skip_rule.sql.

create or replace function public.create_challenge(
  in_from_team_id  uuid,
  in_opponent_code text,
  in_match_name    text,
  in_venue_id      uuid,
  in_scheduled_at  timestamptz,
  in_total_slots   integer,
  in_message       text default null
)
returns public.team_challenges
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_from public.teams%rowtype;
  v_to   public.teams%rowtype;
  v_row  public.team_challenges%rowtype;
  v_squad_size int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_from from public.teams where id = in_from_team_id;
  if not found or v_from.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  select * into v_to from public.teams
   where invite_code = upper(btrim(in_opponent_code)) for update;
  if not found then
    raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_to.id = v_from.id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;
  if v_to.sport <> v_from.sport then
    raise exception 'SPORT_MISMATCH' using errcode = '23514';
  end if;
  if public.is_blocked_between(v_uid, v_to.owner_id) then
    raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if in_scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  -- Fail early rather than at accept time: tell the challenger now that the
  -- slot count cannot hold both squads.
  select count(*) into v_squad_size
    from public.team_members tm
   where tm.team_id in (v_from.id, v_to.id);
  if v_squad_size > in_total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  -- Only unexpired pending challenges block a re-issue, otherwise a lapsed row
  -- locks the pair out of ever challenging each other again.
  if exists (
    select 1 from public.team_challenges c
    where c.from_team_id = v_from.id and c.to_team_id = v_to.id
      and c.status = 'pending' and c.scheduled_at > now()
  ) then
    raise exception 'CHALLENGE_ALREADY_PENDING' using errcode = '23505';
  end if;

  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, message
  )
  values (
    v_from.id, v_to.id, v_uid, in_match_name,
    in_venue_id, in_scheduled_at, in_total_slots, in_message
  )
  returning * into v_row;

  return v_row;
end;
$$;
