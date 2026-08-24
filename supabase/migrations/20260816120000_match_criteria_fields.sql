-- Fields the redesigned Match Details screen shows and Edit Match edits:
-- game type (friendly/competitive), an optional end time, and the search radius.
--
-- search_radius_m is the notable one: post_open_challenge already ACCEPTED
-- in_radius_m but discarded it after ranking candidates, so "Search Again" had
-- no idea what radius the poster originally chose and silently fell back to the
-- 25km default.

alter table public.matches
  add column if not exists game_type text not null default 'friendly'
    check (game_type in ('friendly', 'competitive'));
alter table public.matches
  add column if not exists end_time timestamptz;
alter table public.matches
  add column if not exists search_radius_m integer
    check (search_radius_m is null or (search_radius_m between 1000 and 50000));

alter table public.team_challenges
  add column if not exists game_type text not null default 'friendly'
    check (game_type in ('friendly', 'competitive'));
alter table public.team_challenges
  add column if not exists end_time timestamptz;
alter table public.team_challenges
  add column if not exists search_radius_m integer
    check (search_radius_m is null or (search_radius_m between 1000 and 50000));

alter table public.matches drop constraint if exists matches_end_after_start;
alter table public.matches add constraint matches_end_after_start
  check (end_time is null or end_time > scheduled_at);
alter table public.team_challenges drop constraint if exists team_challenges_end_after_start;
alter table public.team_challenges add constraint team_challenges_end_after_start
  check (end_time is null or end_time > scheduled_at);

-- Replacing the function with two extra defaulted parameters creates a SECOND
-- function rather than replacing the first, because argument count is part of a
-- function's identity. With both present a 7-argument call matches either and
-- PostgREST fails with PGRST203. Drop the old signature FIRST.
drop function if exists public.post_open_challenge(uuid, text, uuid, timestamptz, integer, text, integer);

create or replace function public.post_open_challenge(
  in_from_team_id uuid,
  in_match_name text,
  in_venue_id uuid,
  in_scheduled_at timestamptz,
  in_total_slots integer,
  in_message text default null,
  in_radius_m integer default 25000,
  in_game_type text default 'friendly',
  in_end_time timestamptz default null
)
returns team_challenges
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_from public.teams%rowtype;
  v_row  public.team_challenges%rowtype;
  v_cand record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_from from public.teams where id = in_from_team_id;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_from.owner_id <> v_uid then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;

  if in_scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;
  if in_total_slots <= 0 then
    raise exception 'INVALID_SLOTS' using errcode = '23514';
  end if;
  if in_game_type not in ('friendly', 'competitive') then
    raise exception 'INVALID_GAME_TYPE' using errcode = '23514';
  end if;
  if in_end_time is not null and in_end_time <= in_scheduled_at then
    raise exception 'END_BEFORE_START' using errcode = '23514';
  end if;
  if in_radius_m < 1000 or in_radius_m > 50000 then
    raise exception 'INVALID_RADIUS' using errcode = '23514';
  end if;
  if not exists (select 1 from public.venues where id = in_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.team_challenges c
     where c.from_team_id = v_from.id and c.status = 'open'
  ) then
    raise exception 'OPEN_CHALLENGE_ALREADY_LIVE' using errcode = '23505';
  end if;

  insert into public.team_challenges (
    from_team_id, to_team_id, created_by, match_name,
    venue_id, scheduled_at, total_slots, message, status,
    game_type, end_time, search_radius_m
  )
  values (
    v_from.id, null, v_uid, in_match_name,
    in_venue_id, in_scheduled_at, in_total_slots, in_message, 'open',
    in_game_type, in_end_time, in_radius_m
  )
  returning * into v_row;

  for v_cand in
    select * from public.rank_challenge_candidates(v_row.id, in_radius_m, 5)
  loop
    insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m)
    values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m);

    perform public.enqueue_notification(
      (select owner_id from public.teams where id = v_cand.team_id),
      'challenge_offer',
      'Match offer',
      v_from.name || ' wants a game. Tap to accept.',
      jsonb_build_object('route', '/teams/offers', 'challenge_id', v_row.id)
    );
  end loop;

  return v_row;
end;
$function$;

revoke execute on function public.post_open_challenge(uuid, text, uuid, timestamptz, integer, text, integer, text, timestamptz) from anon, public;
grant execute on function public.post_open_challenge(uuid, text, uuid, timestamptz, integer, text, integer, text, timestamptz) to authenticated;
