-- Team vs team challenges. A challenge is an offer to play; accepting it
-- creates a real match and confirms both squads onto it.
--
-- Opponents are addressed by invite_code, not picked from a list, because
-- teams_select is members-only: you cannot see a team you do not belong to, and
-- adding a public team directory would be a much larger privacy decision.

create table public.team_challenges (
  id            uuid primary key default gen_random_uuid(),
  from_team_id  uuid not null references public.teams (id) on delete cascade,
  to_team_id    uuid not null references public.teams (id) on delete cascade,
  created_by    uuid not null references public.profiles (id) on delete cascade,
  match_name    text not null check (char_length(match_name) between 2 and 80),
  venue_id      uuid not null references public.venues (id) on delete restrict,
  scheduled_at  timestamptz not null,
  total_slots   integer not null check (total_slots > 0),
  message       text check (message is null or char_length(message) <= 280),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','declined','cancelled')),
  match_id      uuid references public.matches (id) on delete set null,
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint no_self_challenge check (from_team_id <> to_team_id)
);
create index team_challenges_to_idx    on public.team_challenges (to_team_id, status);
create index team_challenges_from_idx  on public.team_challenges (from_team_id, status);
create index team_challenges_match_idx on public.team_challenges (match_id) where match_id is not null;

alter table public.team_challenges enable row level security;

-- Visible to members of either side. No client INSERT/UPDATE: both transitions
-- go through the RPCs below so the match-creation side effect cannot be skipped.
create policy "team_challenges_select" on public.team_challenges for select to authenticated
  using (
    public.is_team_member(from_team_id, (select auth.uid()))
    or public.is_team_member(to_team_id, (select auth.uid()))
  );

-- Unambiguous alphabet, same as the client generator (no 0/O/1/I).
create or replace function public.gen_share_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code text := '';
  i int;
begin
  for i in 1..6 loop
    out_code := out_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out_code;
end;
$$;

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
  if exists (
    select 1 from public.team_challenges c
    where c.from_team_id = v_from.id and c.to_team_id = v_to.id and c.status = 'pending'
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
    update public.team_challenges
       set status = 'declined', responded_at = now()
     where id = v_c.id
     returning * into v_c;
    return v_c;
  end if;

  if v_c.scheduled_at <= now() then
    raise exception 'SCHEDULE_IN_PAST' using errcode = '23514';
  end if;

  select * into v_venue from public.venues where id = v_c.venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- share_code is UNIQUE; retry on the rare collision.
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_name, notes
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, v_venue.name, v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_venue.lat, v_venue.lng, v_c.match_name, v_c.message
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Both squads go straight onto the sheet as confirmed: the whole point of a
  -- team challenge is that the rosters are already agreed. The match creator is
  -- implicitly on it, so exclude them to avoid a duplicate row.
  insert into public.match_players (match_id, user_id, status, joined_via)
  select v_match.id, tm.user_id, 'confirmed', 'browse'
    from public.team_members tm
   where tm.team_id in (v_c.from_team_id, v_c.to_team_id)
     and tm.user_id <> v_c.created_by
  on conflict (match_id, user_id) do nothing;

  update public.team_challenges
     set status = 'accepted', responded_at = now(), match_id = v_match.id
   where id = v_c.id
   returning * into v_c;

  return v_c;
end;
$$;

revoke execute on function public.gen_share_code() from anon, public;
revoke execute on function public.create_challenge(uuid, text, text, uuid, timestamptz, integer, text) from anon, public;
revoke execute on function public.respond_to_challenge(uuid, boolean) from anon, public;
grant  execute on function public.create_challenge(uuid, text, text, uuid, timestamptz, integer, text) to authenticated;
grant  execute on function public.respond_to_challenge(uuid, boolean) to authenticated;
