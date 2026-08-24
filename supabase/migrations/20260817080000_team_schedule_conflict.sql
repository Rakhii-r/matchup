-- Bug: post_open_challenge's "one live open challenge per team" check blocked
-- ANY second post regardless of date/time — a team with an open challenge for
-- 17 Aug 7-9pm could not post an unrelated one for 19 Aug, and the client
-- surfaced "This team already has an open challenge. Withdraw it first." for a
-- fixture that never conflicted with anything.
--
-- Replaced with a real interval-overlap check: a team may hold any number of
-- open/pending commitments as long as no two overlap in time. This is checked
-- against BOTH sources of a real commitment —
--   public.matches         (status 'open'/'locked' — already a real fixture)
--   public.team_challenges (status 'pending'/'open' — not yet a match, but
--                            accepting/answering it would create one at that
--                            time, so it must count too)
-- 'accepted' challenges are deliberately excluded: finalise_challenge always
-- creates the matches row in the same transaction that sets status =
-- 'accepted', so the resulting match is already covered by the first source
-- and checking both would just double the same conflict.
--
-- Rows with no end_time (the column is nullable — see 20260816120000) are
-- assumed to run 3 hours, matching the buffer rank_challenge_candidates
-- already uses elsewhere in this file for the same "is this team busy then"
-- question.

create or replace function public.team_schedule_conflict(
  p_team_id              uuid,
  p_start                timestamptz,
  p_end                  timestamptz,
  p_exclude_match_id     uuid default null,
  p_exclude_challenge_id uuid default null
)
returns table (source text, scheduled_at timestamptz, end_time timestamptz, match_name text)
language sql
stable
security definer
set search_path = public
as $$
  with conflicts as (
    select 'match'::text as source,
           m.scheduled_at,
           coalesce(m.end_time, m.scheduled_at + interval '3 hours') as end_time,
           m.match_name
      from public.matches m
     where (m.team_a_id = p_team_id or m.team_b_id = p_team_id)
       and m.status in ('open', 'locked')
       and (p_exclude_match_id is null or m.id <> p_exclude_match_id)
       and p_start < coalesce(m.end_time, m.scheduled_at + interval '3 hours')
       and p_end   > m.scheduled_at
    union all
    select 'challenge'::text,
           c.scheduled_at,
           coalesce(c.end_time, c.scheduled_at + interval '3 hours'),
           c.match_name
      from public.team_challenges c
     where (c.from_team_id = p_team_id or c.to_team_id = p_team_id)
       and c.status in ('pending', 'open')
       and (p_exclude_challenge_id is null or c.id <> p_exclude_challenge_id)
       and p_start < coalesce(c.end_time, c.scheduled_at + interval '3 hours')
       and p_end   > c.scheduled_at
  )
  select * from conflicts order by scheduled_at asc limit 1;
$$;

-- Internal only, same reasoning as team_location: this discloses a team's
-- booked time slots, so only the SECURITY DEFINER RPCs below may call it.
revoke execute on function public.team_schedule_conflict(uuid, timestamptz, timestamptz, uuid, uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- post_open_challenge — same signature as 20260816120000, body only.
-- ---------------------------------------------------------------------------
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
  v_uid        uuid := (select auth.uid());
  v_from       public.teams%rowtype;
  v_row        public.team_challenges%rowtype;
  v_cand       record;
  v_window_end timestamptz;
  v_conflict   record;
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

  v_window_end := coalesce(in_end_time, in_scheduled_at + interval '3 hours');

  -- Serialises the check-then-insert below against any other post/accept for
  -- the same team racing it in a concurrent transaction.
  perform pg_advisory_xact_lock(hashtext(v_from.id::text));

  select * into v_conflict
    from public.team_schedule_conflict(v_from.id, in_scheduled_at, v_window_end);
  if found then
    raise exception '%', format(
      'TEAM_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
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

-- ---------------------------------------------------------------------------
-- finalise_challenge — same signature as 20260813133002, body extended with
-- the same overlap check for BOTH squads right before the match is created.
-- v_c.id is excluded from the lookup: v_c is itself a live 'open'/'pending'
-- row for one of these teams and would otherwise conflict with itself.
-- ---------------------------------------------------------------------------
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
  v_c          public.team_challenges%rowtype;
  v_to         public.teams%rowtype;
  v_venue      public.venues%rowtype;
  v_match      public.matches%rowtype;
  v_code       text;
  v_try        int;
  v_count      int;
  v_window_end timestamptz;
  v_conflict   record;
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

  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_venue from public.venues where id = v_c.venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock both teams in a stable order (uuid text order — arbitrary but
  -- consistent) so two concurrent finalisations touching an overlapping pair
  -- of teams can never deadlock against each other.
  if v_c.from_team_id::text < in_to_team_id::text then
    perform pg_advisory_xact_lock(hashtext(v_c.from_team_id::text));
    perform pg_advisory_xact_lock(hashtext(in_to_team_id::text));
  else
    perform pg_advisory_xact_lock(hashtext(in_to_team_id::text));
    perform pg_advisory_xact_lock(hashtext(v_c.from_team_id::text));
  end if;

  v_window_end := coalesce(v_c.end_time, v_c.scheduled_at + interval '3 hours');

  select * into v_conflict from public.team_schedule_conflict(
    v_c.from_team_id, v_c.scheduled_at, v_window_end, null, v_c.id
  );
  if found then
    raise exception '%', format(
      'TEAM_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  select * into v_conflict from public.team_schedule_conflict(
    in_to_team_id, v_c.scheduled_at, v_window_end, null, v_c.id
  );
  if found then
    raise exception '%', format(
      'OPPONENT_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  -- The sheet must actually hold both squads. sync_filled_slots clamps with
  -- least(), so without this an oversized roster looks full while being
  -- silently over-subscribed.
  select count(distinct tm.user_id) into v_count
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, in_to_team_id);
  if v_count > v_c.total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  -- share_code is UNIQUE; retry on the rare collision.
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_name, notes,
        team_a_id, team_b_id, challenge_id, end_time, game_type
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, v_venue.name, v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_venue.lat, v_venue.lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id, v_c.end_time, v_c.game_type
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, status, joined_via, team_id)
  select v_match.id,
         tm.user_id,
         case when tm.role = 'owner' then 'confirmed' else 'invited' end,
         'challenge',
         tm.team_id
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, in_to_team_id)
     and tm.user_id <> v_c.created_by
     and (
       tm.role = 'owner'
       or (
         not public.is_blocked_between(tm.user_id, v_c.created_by)
         and not exists (
           select 1
             from public.team_members opp
            where opp.team_id = case
                                  when tm.team_id = v_c.from_team_id then in_to_team_id
                                  else v_c.from_team_id
                                end
              and public.is_blocked_between(tm.user_id, opp.user_id)
         )
       )
     )
  on conflict (match_id, user_id) do nothing;

  return v_match;
end;
$$;

revoke execute on function public.finalise_challenge(uuid, uuid) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- create_challenge — directed challenge (app/teams/challenge.tsx). Not on the
-- wizard's path today, but it is the other RPC that creates a team_challenges
-- row up front, and it already knows both teams, so it gets the same guard.
-- ---------------------------------------------------------------------------
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
  v_uid        uuid := (select auth.uid());
  v_from       public.teams%rowtype;
  v_to         public.teams%rowtype;
  v_row        public.team_challenges%rowtype;
  v_squad_size int;
  v_window_end timestamptz;
  v_conflict   record;
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

  select count(*) into v_squad_size
    from public.team_members tm
   where tm.team_id in (v_from.id, v_to.id);
  if v_squad_size > in_total_slots then
    raise exception 'TOO_MANY_PLAYERS' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.team_challenges c
    where c.from_team_id = v_from.id and c.to_team_id = v_to.id
      and c.status = 'pending' and c.scheduled_at > now()
  ) then
    raise exception 'CHALLENGE_ALREADY_PENDING' using errcode = '23505';
  end if;

  if v_from.id::text < v_to.id::text then
    perform pg_advisory_xact_lock(hashtext(v_from.id::text));
    perform pg_advisory_xact_lock(hashtext(v_to.id::text));
  else
    perform pg_advisory_xact_lock(hashtext(v_to.id::text));
    perform pg_advisory_xact_lock(hashtext(v_from.id::text));
  end if;

  v_window_end := in_scheduled_at + interval '3 hours';

  select * into v_conflict
    from public.team_schedule_conflict(v_from.id, in_scheduled_at, v_window_end);
  if found then
    raise exception '%', format(
      'TEAM_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
  end if;

  select * into v_conflict
    from public.team_schedule_conflict(v_to.id, in_scheduled_at, v_window_end);
  if found then
    raise exception '%', format(
      'OPPONENT_SCHEDULE_CONFLICT|%s|%s|%s',
      to_char(v_conflict.scheduled_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(v_conflict.end_time at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      coalesce(v_conflict.match_name, '')
    ) using errcode = '23505';
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

revoke execute on function public.create_challenge(uuid, text, text, uuid, timestamptz, integer, text) from anon, public;
grant  execute on function public.create_challenge(uuid, text, text, uuid, timestamptz, integer, text) to authenticated;
