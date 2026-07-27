-- ============================================================================
-- MatchUp — Roles & Admin (superadmin / moderator)
--
-- Roles live in a SEPARATE table, never on profiles: profiles has a self-update
-- policy, so a role column there would allow self-promotion. user_roles writes are
-- gated to superadmins only, closing that escalation.
--
-- All checks run through SECURITY DEFINER functions that bypass RLS (no recursion),
-- and admin powers are granted via ADDITIVE permissive policies — the Phase 1
-- policies in 0002 are left untouched and OR-combined with these.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role enum + table
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('moderator', 'superadmin');

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------------
-- Authorisation helpers (SECURITY DEFINER => run as owner, bypass RLS).
-- Default to the calling user so policies can call them with no arguments.
-- ---------------------------------------------------------------------------
create or replace function public.has_role(in_role public.app_role, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r where r.user_id = uid and r.role = in_role
  );
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = uid and r.role in ('moderator', 'superadmin')
  );
$$;

create or replace function public.is_superadmin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r where r.user_id = uid and r.role = 'superadmin'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS on user_roles: read your own (or any if admin); only superadmins write.
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;

create policy "user_roles_select" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "user_roles_write_superadmin" on public.user_roles for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- Additive admin powers on existing tables (OR-combined with Phase 1 policies).
-- ---------------------------------------------------------------------------

-- Reports: admins triage the full queue and update status.
create policy "reports_admin_select" on public.reports for select to authenticated
  using (public.is_admin());
create policy "reports_admin_update" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Profiles: admins read everyone and may deactivate (set is_active = false).
create policy "profiles_admin_select" on public.profiles for select to authenticated
  using (public.is_admin());
create policy "profiles_admin_update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Matches: admins can read all and cancel/remove any match.
create policy "matches_admin_all" on public.matches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Venues: admins manage the directory.
create policy "venues_admin_all" on public.venues for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
