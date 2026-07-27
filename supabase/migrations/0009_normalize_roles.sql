-- 0009: Normalize roles into a lookup table.
--
-- Previously user_roles stored the role as an app_role enum value directly. This adds a
-- proper roles(id, name) lookup and points user_roles at it via role_id, so roles are
-- referenced by UUID. The app_role enum is kept as the TYPE of roles.name (constrains the
-- allowed values and keeps the generated AppRole type valid) — we do NOT drop it.
--
-- Data is backfilled before the old column is dropped, so existing grants are preserved.

-- 1. Lookup table. name is the enum so only known roles can exist; unique so it's a key.
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        public.app_role not null unique,
  description text,
  created_at  timestamptz not null default now()
);

insert into public.roles (name, description) values
  ('superadmin', 'Full admin: manage venues, view all users'),
  ('moderator',  'Legacy moderator (unused in the two-tier model)');

alter table public.roles enable row level security;

-- Roles are a public lookup; any signed-in user may read them. No write policy => only
-- the service role can change the catalogue.
create policy "roles_select_all" on public.roles for select to authenticated using (true);

-- 2. Point user_roles at roles(id). Backfill from the existing enum column, then drop it.
alter table public.user_roles add column role_id uuid references public.roles (id) on delete cascade;

update public.user_roles ur
set role_id = r.id
from public.roles r
where r.name = ur.role;

alter table public.user_roles alter column role_id set not null;

-- Dropping the column also drops the old unique(user_id, role) constraint.
alter table public.user_roles drop column role;

alter table public.user_roles
  add constraint user_roles_user_role_unique unique (user_id, role_id);
create index if not exists user_roles_role_id_idx on public.user_roles (role_id);

-- 3. Rewrite the authorization helpers to resolve the role via the lookup join.
create or replace function public.has_role(in_role public.app_role, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.name = in_role
  );
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.name = 'superadmin'
  );
$$;

create or replace function public.is_superadmin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = uid and r.name = 'superadmin'
  );
$$;

-- 4. Convenience view so the client can read a user's role NAMES without a manual join.
-- security_invoker => the underlying user_roles/roles RLS applies to the caller, so a user
-- only ever sees their own roles.
create view public.user_role_names
  with (security_invoker = true) as
  select ur.user_id, r.name as role
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id;

grant select on public.user_role_names to authenticated;
