-- Find Players.
--
-- A captain says how big the squad should be; the team then appears to solo
-- players as an opening with N slots left. A player asks to join, the captain
-- sees the request with their profile and accepts or declines, and accepting
-- puts them in team_members. Only then is the squad big enough to post a
-- team fixture.
--
-- target_size is NULLABLE and null means "not recruiting", so no backfill is
-- needed and no existing team is dragged into the browse list.
alter table public.teams
  add column if not exists target_size integer;

alter table public.teams drop constraint if exists teams_target_size_check;
alter table public.teams add constraint teams_target_size_check
  check (target_size is null or (target_size between 2 and 20));

comment on column public.teams.target_size is
  'Squad size the captain is recruiting to. NULL = not recruiting; the team does not appear in list_teams_needing_players.';

create table if not exists public.team_join_requests (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  message     text check (message is null or char_length(message) <= 200),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles(id)
);

-- One LIVE request per player per team. A declined request may be re-sent
-- later, so the uniqueness is partial rather than on the whole table.
create unique index if not exists team_join_requests_one_pending
  on public.team_join_requests (team_id, user_id)
  where status = 'pending';

create index if not exists team_join_requests_team_idx
  on public.team_join_requests (team_id, status);

alter table public.team_join_requests enable row level security;

-- Readable by the person who asked and by the captain. Writes go through the
-- RPCs only, so there is deliberately no INSERT/UPDATE/DELETE policy.
drop policy if exists team_join_requests_select on public.team_join_requests;
create policy team_join_requests_select on public.team_join_requests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.teams t
       where t.id = team_id and t.owner_id = (select auth.uid())
    )
  );

revoke insert, update, delete on public.team_join_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Captain: start (or stop) recruiting.
create or replace function public.set_team_target_size(in_team_id uuid, in_size integer)
returns teams
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_t   public.teams%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select * into v_t from public.teams where id = in_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_t.owner_id <> v_uid then raise exception 'NOT_THE_CAPTAIN' using errcode = '42501'; end if;
  if in_size is not null and (in_size < 2 or in_size > 20) then
    raise exception 'INVALID_SQUAD_SIZE' using errcode = '23514';
  end if;

  update public.teams set target_size = in_size where id = in_team_id returning * into v_t;
  return v_t;
end;
$function$;

revoke execute on function public.set_team_target_size(uuid, integer) from anon;

-- ---------------------------------------------------------------------------
-- Player: the openings worth asking to join.
--
-- Distance comes from the CAPTAIN's profile coordinates -- teams have no
-- coordinates of their own, only a free-text home_ground. A team whose captain
-- has no coords still lists rather than being hidden over missing metadata.
create or replace function public.list_teams_needing_players(
  in_lat double precision default null,
  in_lng double precision default null,
  in_radius_m integer default 25000,
  in_sport text default null
)
returns table (
  team_id uuid, name text, sport text, logo_url text, home_ground text,
  player_count integer, target_size integer, slots_left integer,
  captain_name text, distance_m double precision, my_request_status text
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_loc geography := null;
begin
  if in_lat is not null and in_lng is not null then
    v_loc := ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography;
  end if;

  return query
  with counted as (
    select t.*,
           (select count(*) from public.team_members tm where tm.team_id = t.id)::integer as n,
           p.full_name as cap_name,
           case
             when p.home_lat is not null and p.home_lng is not null
               then ST_SetSRID(ST_MakePoint(p.home_lng, p.home_lat), 4326)::geography
           end as cap_loc
      from public.teams t
      join public.profiles p on p.id = t.owner_id
     where t.target_size is not null
  )
  select c.id, c.name, c.sport, c.logo_url, c.home_ground,
         c.n, c.target_size, (c.target_size - c.n)::integer,
         c.cap_name,
         case when v_loc is not null and c.cap_loc is not null
              then ST_Distance(v_loc, c.cap_loc) else 0::double precision end,
         (select r.status from public.team_join_requests r
           where r.team_id = c.id and r.user_id = v_uid
           order by r.created_at desc limit 1)
    from counted c
   where c.n < c.target_size
     and (in_sport is null or c.sport = in_sport)
     -- Not a team you are already in, and not your own.
     and c.owner_id <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
     and not exists (
       select 1 from public.team_members tm
        where tm.team_id = c.id and tm.user_id = v_uid
     )
     and (v_loc is null or c.cap_loc is null or ST_DWithin(v_loc, c.cap_loc, in_radius_m))
   order by (v_loc is not null and c.cap_loc is not null) desc,
            case when v_loc is not null and c.cap_loc is not null
                 then ST_Distance(v_loc, c.cap_loc) else 0 end asc,
            c.name asc
   limit 50;
end;
$function$;

revoke execute on function public.list_teams_needing_players(double precision, double precision, integer, text) from anon;

-- ---------------------------------------------------------------------------
-- Player: ask to join.
create or replace function public.request_to_join_team(in_team_id uuid, in_message text default null)
returns team_join_requests
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_t   public.teams%rowtype;
  v_n   integer;
  v_row public.team_join_requests%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_t from public.teams where id = in_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (select 1 from public.team_members tm
              where tm.team_id = in_team_id and tm.user_id = v_uid) then
    raise exception 'ALREADY_A_MEMBER' using errcode = '23505';
  end if;

  if v_t.target_size is null then
    raise exception 'TEAM_NOT_RECRUITING' using errcode = '23514';
  end if;

  select count(*) into v_n from public.team_members tm where tm.team_id = in_team_id;
  if v_n >= v_t.target_size then
    raise exception 'TEAM_FULL' using errcode = '23514';
  end if;

  if exists (select 1 from public.team_join_requests r
              where r.team_id = in_team_id and r.user_id = v_uid and r.status = 'pending') then
    raise exception 'REQUEST_ALREADY_SENT' using errcode = '23505';
  end if;

  insert into public.team_join_requests (team_id, user_id, message)
  values (in_team_id, v_uid, nullif(btrim(coalesce(in_message, '')), ''))
  returning * into v_row;

  perform public.enqueue_notification(
    v_t.owner_id,
    'team_join_requested',
    'Someone wants to join ' || v_t.name,
    coalesce((select full_name from public.profiles where id = v_uid), 'A player')
      || ' asked to join your squad.',
    jsonb_build_object('route', '/teams/' || in_team_id::text || '/requests', 'team_id', in_team_id)
  );

  return v_row;
end;
$function$;

revoke execute on function public.request_to_join_team(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Captain: the inbox, with enough profile to judge.
create or replace function public.list_team_join_requests(in_team_id uuid)
returns table (
  request_id uuid, user_id uuid, full_name text, avatar_url text,
  area_name text, playing_role text, matches_played integer,
  message text, status text, created_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.teams t
                  where t.id = in_team_id and t.owner_id = v_uid) then
    raise exception 'NOT_THE_CAPTAIN' using errcode = '42501';
  end if;

  return query
  select r.id, r.user_id, p.full_name, p.avatar_url, p.area_name, p.playing_role,
         (select count(*) from public.match_players mp
            join public.matches m on m.id = mp.match_id
           where mp.user_id = r.user_id and m.status = 'completed')::integer,
         r.message, r.status, r.created_at
    from public.team_join_requests r
    join public.profiles p on p.id = r.user_id
   where r.team_id = in_team_id
     and r.status = 'pending'
   order by r.created_at asc;
end;
$function$;

revoke execute on function public.list_team_join_requests(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Captain: accept or decline.
create or replace function public.respond_to_join_request(in_request_id uuid, in_accept boolean)
returns team_join_requests
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_r   public.team_join_requests%rowtype;
  v_t   public.teams%rowtype;
  v_n   integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_r from public.team_join_requests where id = in_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_t from public.teams where id = v_r.team_id;
  if v_t.owner_id <> v_uid then raise exception 'NOT_THE_CAPTAIN' using errcode = '42501'; end if;
  if v_r.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_ANSWERED' using errcode = '23514';
  end if;

  if in_accept then
    -- Re-checked here, not just at request time: two captains' taps could
    -- otherwise take a squad past its target.
    select count(*) into v_n from public.team_members tm where tm.team_id = v_r.team_id;
    if v_t.target_size is not null and v_n >= v_t.target_size then
      raise exception 'TEAM_FULL' using errcode = '23514';
    end if;

    insert into public.team_members (team_id, user_id, role)
    values (v_r.team_id, v_r.user_id, 'member')
    on conflict (team_id, user_id) do nothing;
  end if;

  update public.team_join_requests
     set status = case when in_accept then 'accepted' else 'declined' end,
         decided_at = now(), decided_by = v_uid
   where id = in_request_id
  returning * into v_r;

  perform public.enqueue_notification(
    v_r.user_id,
    'team_join_answered',
    case when in_accept then 'You are in ' || v_t.name else 'Not this time' end,
    case when in_accept
         then 'The captain accepted you into the squad.'
         else v_t.name || ' declined your request to join.' end,
    jsonb_build_object('route', '/teams/' || v_r.team_id::text, 'team_id', v_r.team_id)
  );

  return v_r;
end;
$function$;

revoke execute on function public.respond_to_join_request(uuid, boolean) from anon;
