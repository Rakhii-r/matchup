-- ============================================================================
-- Squad-only matchmaking, and strict format-to-format opponent matching.
-- 3 Sep 2026.
--
-- TWO changes, and they are the same change seen from two ends.
--
-- 1. THE SOLO PLAYER IS GONE FROM TEAM MATCHMAKING.
--    `list_teams_needing_players` advertised a squad to strangers and
--    `request_to_join_team` queued one against it, with
--    `list_team_join_requests` / `respond_to_join_request` as the captain's
--    inbox. That was the only way an individual could search for, queue for or
--    join a Team vs Team lobby, and all four are dropped here. A player joins a
--    squad by invite code; a squad plays another squad.
--
--    `public.team_join_requests` is deliberately NOT dropped. Nothing can read
--    or write it any more (no RPC, and the table never had INSERT/UPDATE/DELETE
--    grants), so it is inert, but it holds real rows that captains answered and
--    dropping a table is not a migration you can take back. Drop it in a later
--    migration once the data is no longer wanted.
--
-- 2. FORMAT IS NOW A HARD FILTER, NOT A SUGGESTION.
--    `teams.target_size` used to mean "recruiting up to N players", which is
--    what put a team on the Find Players board. With that board gone the column
--    is re-purposed as the team's DECLARED FORMAT in players per side: a 6 means
--    "we are a 6 v 6 side".
--
--    Symmetric matching, enforced in four places so no path can skip it:
--      * rank_challenge_candidates   the radar only ranks same-format teams
--      * list_open_challenges_nearby a team only sees its own format's fixtures
--      * apply_to_open_challenge     refuses a cross-format request
--      * accept_open_challenge       refuses a cross-format acceptance
--    plus the three triggers below, which cover create_challenge and any future
--    path into the tables without either function being edited.
--
--    The yardstick is one expression everywhere -- a fixture's format is
--    `total_slots / 2` and a team's is `target_size` -- so a 4 v 4 team can
--    never see, challenge, or be challenged by a 6 v 6 team.
--
--    A captain may still override the format for a single fixture: the create
--    wizard writes the new format to the team first (set_team_target_size) and
--    posts second, because a team judged by one format while posting another is
--    exactly the asymmetry this migration exists to remove. The insert trigger
--    is what makes that ordering mandatory rather than a client convention.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove the solo-player recruiting API.
-- ---------------------------------------------------------------------------
drop function if exists public.list_teams_needing_players(double precision, double precision, integer, text);
drop function if exists public.request_to_join_team(uuid, text);
drop function if exists public.list_team_join_requests(uuid);
drop function if exists public.respond_to_join_request(uuid, boolean);

comment on table public.team_join_requests is
  'DEAD as of 20260903090000. The solo player -> team request flow was removed; '
  'no RPC reads or writes this table and there are no direct grants. Kept only '
  'so historical rows are not destroyed. Safe to drop once no longer wanted.';

-- ---------------------------------------------------------------------------
-- 2. target_size becomes the team's declared format.
-- ---------------------------------------------------------------------------
comment on column public.teams.target_size is
  'The team FORMAT in players per side (4 = a 4 v 4 side). Null means the team '
  'has not declared one and is invisible to matchmaking in both directions. '
  'Was "recruiting target" until 20260903090000.';

/*
  Backfill, and it CLAMPS rather than just filling blanks.

  Two traps, both found against production before this ran:

  1. The existing values are not formats. `target_size` meant "recruiting up to
     N" -- an aspiration -- so a 1-player squad legitimately held a 4. Read as a
     format, that is a team claiming a 4 v 4 it cannot field: visible in every
     4 v 4 list, refused with OPPONENT_SQUAD_TOO_SMALL the moment anyone accepts
     it. So every row is normalised, not only the nulls.

  2. The last fixture a team posted is not a format it can still field either.
     Squads shrink, and several teams last posted a 6 v 6 with one player left.

  Hence: never above what the squad can actually put on the field today, and
  NULL below two players -- out of matchmaking until the captain declares a
  format, which is the honest state for a team that cannot field one. Preference
  order within that ceiling is the value the captain last chose, then the format
  they last posted, then the squad size itself.
*/
with squad as (
  select team_id, count(*)::integer as n from public.team_members group by team_id
),
last_format as (
  select ch.from_team_id as team_id,
         greatest(ch.total_slots / 2, 1) as fmt,
         row_number() over (partition by ch.from_team_id order by ch.created_at desc) as rn
    from public.team_challenges ch
   where ch.total_slots is not null
),
resolved as (
  select t.id,
         case
           when coalesce(s.n, 0) < 2 then null
           else least(greatest(least(coalesce(t.target_size, lf.fmt, s.n), s.n), 2), 20)
         end as new_format
    from public.teams t
    left join squad s on s.team_id = t.id
    left join last_format lf on lf.team_id = t.id and lf.rn = 1
)
update public.teams t
   set target_size = r.new_format
  from resolved r
 where r.id = t.id
   and t.target_size is distinct from r.new_format;

-- A team cannot declare a format it cannot field. Without this a 2-player squad
-- could declare 6 v 6, appear in every 6 v 6 list, and fail at accept time --
-- which reads to the other captain as the app being broken.
create or replace function public.set_team_target_size(in_team_id uuid, in_size integer)
returns teams
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_t   public.teams%rowtype;
  v_n   integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select * into v_t from public.teams where id = in_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_t.owner_id <> v_uid then raise exception 'NOT_THE_CAPTAIN' using errcode = '42501'; end if;
  if in_size is not null and (in_size < 2 or in_size > 20) then
    raise exception 'INVALID_SQUAD_SIZE' using errcode = '23514';
  end if;

  if in_size is not null then
    select count(*) into v_n from public.team_members tm where tm.team_id = in_team_id;
    if v_n < in_size then
      raise exception 'SQUAD_TOO_SMALL_FOR_FORMAT' using errcode = '23514',
        detail = format('%s of %s players', v_n, in_size);
    end if;
  end if;

  update public.teams set target_size = in_size where id = in_team_id returning * into v_t;
  return v_t;
end;
$function$;

revoke execute on function public.set_team_target_size(uuid, integer) from anon;
grant  execute on function public.set_team_target_size(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One definition of "same format", so the rule cannot drift between the
--    four call sites and three triggers that apply it.
-- ---------------------------------------------------------------------------

-- A fixture's format in players per side. total_slots is per-side x 2.
create or replace function public.challenge_format(in_total_slots integer)
returns integer
language sql
immutable
as $function$
  select greatest(coalesce(in_total_slots, 0) / 2, 1);
$function$;

/*
  Strict equality, and a NULL format is a NO.

  "The team has not said what it plays" is not a wildcard -- treating it as one
  is how a 4 v 4 side ends up on a 6 v 6 sheet. A team with no declared format
  is simply not in matchmaking until its captain declares one.
*/
create or replace function public.team_format_matches(in_team_id uuid, in_total_slots integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select t.target_size from public.teams t where t.id = in_team_id)
      = public.challenge_format(in_total_slots),
    false);
$function$;

revoke execute on function public.team_format_matches(uuid, integer) from anon, authenticated;
revoke execute on function public.challenge_format(integer) from anon;
grant  execute on function public.challenge_format(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The radar only ranks teams of the same format.
--
--    Also restores the two self-match exclusions that 20260820120000 dropped
--    when it rewrote this function for coordinate fallback: a captain was being
--    offered their own other team, and teams sharing players were being offered
--    each other. Strict matching is meaningless if the closest "opponent" is
--    yourself.
-- ---------------------------------------------------------------------------
create or replace function public.rank_challenge_candidates(
  in_challenge_id uuid,
  in_radius_m     integer default 25000,
  in_limit        integer default 5
)
returns table (team_id uuid, distance_m double precision, rank integer)
language sql
stable
security definer
set search_path = public
as $function$
  with c as (
    select ch.id,
           ch.from_team_id,
           ch.created_by,
           ch.scheduled_at,
           ch.total_slots,
           ft.sport   as sport,
           coalesce(
             v.location,
             case when ch.match_lng is not null and ch.match_lat is not null
                  then ST_SetSRID(ST_MakePoint(ch.match_lng, ch.match_lat), 4326)::geography
                  else public.team_location(ch.from_team_id)
             end
           ) as origin_location
      from public.team_challenges ch
      join public.teams  ft on ft.id = ch.from_team_id
      left join public.venues v  on v.id  = ch.venue_id
     where ch.id = in_challenge_id
  ),
  eligible as (
    select t.id as team_id,
           ST_Distance(tl.loc, c.origin_location) as distance_m
      from public.teams t
      cross join c
      join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
     where t.id <> c.from_team_id
       and t.sport = c.sport
       -- STRICT FORMAT. A 4 v 4 fixture ranks 4 v 4 teams and nothing else.
       and t.target_size = public.challenge_format(c.total_slots)
       -- And it must be able to field that format today, not in principle.
       and (select count(*) from public.team_members tm where tm.team_id = t.id)
             >= public.challenge_format(c.total_slots)
       -- You cannot play yourself: not another team you own, not a team you are
       -- in, not a team that shares players with the posting squad.
       and t.owner_id <> c.created_by
       and not public.is_team_member(t.id, c.created_by)
       and not exists (
         select 1
           from public.team_members tm1
           join public.team_members tm2 on tm1.user_id = tm2.user_id
          where tm1.team_id = c.from_team_id
            and tm2.team_id = t.id
       )
       and public.is_active_user(t.owner_id)
       and not public.is_blocked_between(t.owner_id, c.created_by)
       and ST_DWithin(tl.loc, c.origin_location, in_radius_m)
       -- Not already committed to a match within three hours either side.
       and not exists (
         select 1
           from public.matches m
           join public.match_players mp on mp.match_id = m.id
           join public.team_members  tm on tm.user_id  = mp.user_id
          where tm.team_id = t.id
            and mp.status = 'confirmed'
            and m.scheduled_at between c.scheduled_at - interval '3 hours'
                                   and c.scheduled_at + interval '3 hours'
       )
  )
  select e.team_id,
         e.distance_m,
         dense_rank() over (order by e.distance_m asc)::integer as rank
    from eligible e
   order by e.distance_m asc
   limit in_limit;
$function$;

revoke execute on function public.rank_challenge_candidates(uuid, integer, integer) from anon, public;
grant  execute on function public.rank_challenge_candidates(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Discovery: a team only ever sees its own format's fixtures.
--
--    New required argument `in_team_size` (players per side). The 4-argument
--    version is DROPPED rather than left beside this one: an overload that
--    silently returns every format is the exact bug this migration closes, and
--    an old client calling it should fail loudly instead.
--
--    A null `in_team_size` returns NOTHING, on purpose. "I have not told you my
--    format" is not "show me everything" -- the caller has no team, or a team
--    with no declared format, and the screen says so rather than listing
--    fixtures it cannot legally accept.
-- ---------------------------------------------------------------------------
drop function if exists public.list_open_challenges_nearby(double precision, double precision, integer, text);

create or replace function public.list_open_challenges_nearby(
  in_lat       double precision default null,
  in_lng       double precision default null,
  in_radius_m  integer default 50000,
  in_sport     text default null,
  in_team_size integer default null
)
returns table (
  challenge_id uuid, match_name text, from_team_id uuid, from_team_name text,
  from_team_logo text, sport text, venue_id uuid, venue_name text, area_name text,
  scheduled_at timestamptz, total_slots integer, message text,
  distance_m double precision, created_at timestamptz, applied_status text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_user_loc geography := null;
begin
  -- No declared format, no opponents. See the header note.
  if in_team_size is null then
    return;
  end if;

  if in_lat is not null and in_lng is not null then
    v_user_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  with rows_with_loc as (
    select
      c.*,
      t.name as t_name, t.logo_url as t_logo, t.sport as t_sport, t.owner_id as t_owner,
      v.name as v_name, v.address as v_address,
      coalesce(
        v.location,
        case
          when c.match_lat is not null and c.match_lng is not null
            then ST_SetSRID(ST_MakePoint(c.match_lng, c.match_lat), 4326)::geography
        end
      ) as loc
    from public.team_challenges c
    join public.teams t on t.id = c.from_team_id
    left join public.venues v on v.id = c.venue_id
  )
  select
    r.id as challenge_id,
    r.match_name,
    r.from_team_id,
    r.t_name as from_team_name,
    r.t_logo as from_team_logo,
    r.t_sport as sport,
    r.venue_id,
    coalesce(r.v_name, r.area_name, 'Local Area') as venue_name,
    coalesce(r.area_name, r.v_address, 'Local Area') as area_name,
    r.scheduled_at,
    r.total_slots,
    r.message,
    case
      when v_user_loc is not null and r.loc is not null then ST_Distance(v_user_loc, r.loc)
      else 0::double precision
    end as distance_m,
    r.created_at,
    (
      select cc.status
        from public.challenge_candidates cc
        join public.teams my_t on my_t.id = cc.team_id
       where cc.challenge_id = r.id
         and my_t.owner_id = v_uid
       order by cc.created_at desc
       limit 1
    ) as applied_status
  from rows_with_loc r
  where r.status = 'open'
    and r.scheduled_at > now()
    -- STRICT FORMAT, and it is not optional: 4 v 4 sees 4 v 4.
    and public.challenge_format(r.total_slots) = in_team_size
    and (in_sport is null or r.t_sport = in_sport)
    and r.t_owner <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.team_members tm
       where tm.team_id = r.from_team_id and tm.user_id = v_uid
    )
    and (
      v_user_loc is null
      or r.loc is null
      or ST_DWithin(v_user_loc, r.loc, in_radius_m)
    )
  order by r.scheduled_at asc
  limit 50;
end;
$function$;

revoke execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text, integer) from anon, public;
grant  execute on function public.list_open_challenges_nearby(double precision, double precision, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The two write paths refuse a cross-format fixture by name, so the client
--    can say WHICH rule was broken instead of "something went wrong".
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
  if v_team.id = v_c.from_team_id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  select * into v_from from public.teams where id = v_c.from_team_id;
  if v_team.sport <> v_from.sport then
    raise exception 'SPORT_MISMATCH' using errcode = '23514';
  end if;

  -- STRICT FORMAT. Named separately from SQUAD_TOO_SMALL because they are
  -- different problems with different fixes: one is "recruit", the other is
  -- "this fixture is not for you".
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

-- accept_open_challenge: same gate, on BOTH sides. The poster is re-checked
-- because a captain can change their team's format between posting and
-- accepting, and the fixture keeps the format it was posted at.
create or replace function public.accept_open_challenge(
  in_challenge_id uuid,
  in_team_id      uuid
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

  -- Both squads must play the format this fixture was posted at.
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

  perform public.enqueue_notification(
    case when v_is_host then v_team.owner_id else v_c.created_by end,
    'challenge_accepted',
    'Match Confirmed! 🎉',
    'Your ' || public.challenge_format(v_c.total_slots) || ' v '
      || public.challenge_format(v_c.total_slots) || ' between '
      || (select name from public.teams where id = v_c.from_team_id)
      || ' and ' || v_team.name || ' is fixed!',
    jsonb_build_object('route', '/match/' || v_match.id::text)
  );

  return v_c;
end;
$function$;

revoke execute on function public.accept_open_challenge(uuid, uuid) from anon, public;
grant  execute on function public.accept_open_challenge(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Triggers. These are what cover create_challenge (direct invite by code)
--    and respond_to_challenge without editing either function, exactly as
--    20260902131318 argued: one rule, every path.
-- ---------------------------------------------------------------------------

-- Insert: the poster must play the format it is posting, and an invited
-- opponent must play it too.
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
        public.challenge_format(new.total_slots));
  end if;

  if not public.team_format_matches(new.from_team_id, new.total_slots) then
    raise exception 'FORMAT_MISMATCH' using errcode = '23514',
      detail = format('your team plays %s a side, this fixture is %s v %s',
        coalesce((select target_size::text from public.teams where id = new.from_team_id), 'no declared format'),
        public.challenge_format(new.total_slots),
        public.challenge_format(new.total_slots));
  end if;

  if not public.squad_meets_size(new.to_team_id, new.total_slots) then
    raise exception 'OPPONENT_SQUAD_TOO_SMALL' using errcode = '23514',
      detail = format('%s of %s players',
        (select count(*) from public.team_members where team_id = new.to_team_id),
        public.challenge_format(new.total_slots));
  end if;

  -- to_team_id is null on an open challenge; only a named opponent is checked.
  if new.to_team_id is not null
     and not public.team_format_matches(new.to_team_id, new.total_slots) then
    raise exception 'OPPONENT_FORMAT_MISMATCH' using errcode = '23514',
      detail = format('they play %s a side, this fixture is %s v %s',
        coalesce((select target_size::text from public.teams where id = new.to_team_id), 'no declared format'),
        public.challenge_format(new.total_slots),
        public.challenge_format(new.total_slots));
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_squad_big_enough() from anon, authenticated;

-- Acceptance: the last gate before finalise_challenge builds a real fixture.
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
          public.challenge_format(new.total_slots));
    end if;
    if not public.squad_meets_size(new.from_team_id, new.total_slots) then
      raise exception 'SQUAD_TOO_SMALL' using errcode = '23514',
        detail = format('%s of %s players',
          (select count(*) from public.team_members where team_id = new.from_team_id),
          public.challenge_format(new.total_slots));
    end if;
    if not public.team_format_matches(new.to_team_id, new.total_slots) then
      raise exception 'OPPONENT_FORMAT_MISMATCH' using errcode = '23514',
        detail = format('they play %s a side, this fixture is %s v %s',
          coalesce((select target_size::text from public.teams where id = new.to_team_id), 'no declared format'),
          public.challenge_format(new.total_slots),
          public.challenge_format(new.total_slots));
    end if;
    if not public.team_format_matches(new.from_team_id, new.total_slots) then
      raise exception 'FORMAT_MISMATCH' using errcode = '23514',
        detail = format('your team plays %s a side, this fixture is %s v %s',
          coalesce((select target_size::text from public.teams where id = new.from_team_id), 'no declared format'),
          public.challenge_format(new.total_slots),
          public.challenge_format(new.total_slots));
    end if;
  end if;
  return new;
end;
$function$;

revoke execute on function public.assert_opponent_squad_on_accept() from anon, authenticated;

-- Applying: fail when the opponent captain taps "send request", not after the
-- host has accepted. 'offered' rows are still left alone -- they are written by
-- rank_challenge_candidates, which now only ever ranks same-format teams, so an
-- offered row cannot be cross-format in the first place.
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
        public.challenge_format(v_slots));
  end if;

  if not public.team_format_matches(new.team_id, v_slots) then
    raise exception 'FORMAT_MISMATCH' using errcode = '23514',
      detail = format('your team plays %s a side, this fixture is %s v %s',
        coalesce((select target_size::text from public.teams where id = new.team_id), 'no declared format'),
        public.challenge_format(v_slots),
        public.challenge_format(v_slots));
  end if;

  return new;
end;
$function$;

revoke execute on function public.assert_applicant_squad_big_enough() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The Teams read model has to carry the format.
--
--    `get_my_teams_overview` is what the create wizard, Home and the Games tab
--    read to know which squads the caller owns. Strict matching now asks a
--    second question of every one of them -- what format does it play -- and
--    without it here the client would have to call get_team_overview once per
--    team, which is exactly the 1 + 2N round trips this function exists to
--    avoid. Column APPENDED, so every existing positional consumer is unmoved.
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_teams_overview();

create or replace function public.get_my_teams_overview()
returns table (
  id uuid,
  name text,
  sport text,
  invite_code text,
  logo_url text,
  home_ground text,
  player_count integer,
  my_role text,
  i_am_owner boolean,
  matches_played integer,
  wins integer,
  losses integer,
  ties integer,
  win_rate integer,
  target_size integer
) language sql stable security definer set search_path to 'public' as $function$
  with mine as (
    select t.id, t.name, t.sport, t.invite_code, t.logo_url, t.home_ground,
           t.owner_id, t.target_size, tm.role as my_role
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where tm.user_id = (select auth.uid())
  ),
  counts as (
    select tm.team_id, count(*)::integer as player_count
      from public.team_members tm
      join mine m on m.id = tm.team_id
     group by tm.team_id
  ),
  played as (
    select m.id as team_id, mt.winner_team_id
      from mine m
      join public.matches mt
        on mt.team_a_id = m.id or mt.team_b_id = m.id
     where mt.status = 'completed'
  ),
  agg as (
    select team_id,
           count(*)::integer as matches_played,
           count(*) filter (where winner_team_id = team_id)::integer as wins,
           count(*) filter (
             where winner_team_id is not null and winner_team_id <> team_id
           )::integer as losses,
           count(*) filter (where winner_team_id is null)::integer as ties,
           coalesce(round(
             100.0 * count(*) filter (where winner_team_id = team_id)
             / nullif(count(*), 0)
           ), 0)::integer as win_rate
      from played
     group by team_id
  )
  select mine.id, mine.name, mine.sport, mine.invite_code, mine.logo_url,
         mine.home_ground,
         coalesce(counts.player_count, 0),
         mine.my_role,
         mine.owner_id = (select auth.uid()),
         coalesce(agg.matches_played, 0),
         coalesce(agg.wins, 0),
         coalesce(agg.losses, 0),
         coalesce(agg.ties, 0),
         coalesce(agg.win_rate, 0),
         mine.target_size
    from mine
    left join counts on counts.team_id = mine.id
    left join agg on agg.team_id = mine.id
   order by mine.name;
$function$;

revoke execute on function public.get_my_teams_overview() from anon, public;
grant execute on function public.get_my_teams_overview() to authenticated;
