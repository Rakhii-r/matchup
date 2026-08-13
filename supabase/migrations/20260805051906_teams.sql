-- ============================================================================
-- Teams — persistent squads.
--
-- A team is a named, reusable roster ("Sunday Warriors") that outlives any one
-- match. Distinct from the word "team" elsewhere in the app, which means either
-- the confirmed roster of a single match (matches.status = 'locked') or one of
-- the two sides within a match (Phase 2 FR-204). Those are unrelated to this.
--
-- Design mirrors matches deliberately, so there is one pattern to reason about:
--   * invite_code is the join mechanism, same alphabet and length as share_code
--   * joining goes through a SECURITY DEFINER RPC that locks the row, never a
--     client INSERT — see join_match_rpc for why that is the only safe way
--   * membership reads go through a SECURITY DEFINER helper to avoid the RLS
--     recursion that fix_matches_rls_recursion had to undo on matches
-- ============================================================================

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 50),
  sport       text not null check (sport in ('box_cricket','badminton')),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  invite_code text not null unique check (char_length(invite_code) = 6),
  created_at  timestamptz not null default now()
);
create index teams_owner_idx on public.teams (owner_id);

create table public.team_members (
  id        uuid primary key default gen_random_uuid(),
  team_id   uuid not null references public.teams (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create index team_members_team_idx on public.team_members (team_id);
create index team_members_user_idx on public.team_members (user_id);

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so they bypass RLS: a policy on team_members that
-- queried team_members directly would recurse infinitely.
-- ---------------------------------------------------------------------------
create or replace function public.is_team_member(p_team_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = p_uid
  );
$$;

create or replace function public.is_team_owner(p_team_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.owner_id = p_uid
  );
$$;

revoke execute on function public.is_team_member(uuid, uuid) from anon, public;
revoke execute on function public.is_team_owner(uuid, uuid)  from anon, public;

-- ---------------------------------------------------------------------------
-- The creator is a member from the moment the team exists. Doing this in a
-- trigger rather than the client keeps the invariant true even if the insert
-- comes from SQL, and means the owner is visible in the roster immediately.
-- ---------------------------------------------------------------------------
create or replace function public.add_team_owner_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_members (team_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (team_id, user_id) do nothing;
  return null;
end;
$$;

create trigger teams_add_owner_member
after insert on public.teams
for each row execute function public.add_team_owner_as_member();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
create policy "teams_select" on public.teams for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_team_member(id, (select auth.uid()))
  );

create policy "teams_insert_owner" on public.teams for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

create policy "teams_update_owner" on public.teams for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "teams_delete_owner" on public.teams for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "team_members_select" on public.team_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_team_member(team_id, (select auth.uid()))
  );

-- No INSERT policy, by design: join_team() is the only way in, exactly as
-- join_match() is for match_players. Adding one would let a client insert
-- itself into any team whose id it can guess.

-- Leaving is self-service; the owner can also remove a member. The owner's own
-- row is protected so a team can never end up ownerless.
create policy "team_members_delete" on public.team_members for delete to authenticated
  using (
    role <> 'owner'
    and (
      user_id = (select auth.uid())
      or public.is_team_owner(team_id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- join_team — atomic, idempotent, server-authoritative.
-- Failures raise a stable token as the message; the client maps it to copy.
-- ---------------------------------------------------------------------------
create or replace function public.join_team(in_invite_code text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_team public.teams%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- Lock the team row so two people redeeming the same code cannot race.
  select * into v_team
  from public.teams
  where invite_code = upper(btrim(in_invite_code))
  for update;

  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  if public.is_blocked_between(v_uid, v_team.owner_id) then
    -- Same wording as not-found: never confirm a team exists to a blocked user.
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotent: re-redeeming must not demote an owner back to member.
  if public.is_team_member(v_team.id, v_uid) then
    return v_team;
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, v_uid, 'member');

  return v_team;
end;
$$;

revoke execute on function public.join_team(text) from anon, public;
grant  execute on function public.join_team(text) to authenticated;
