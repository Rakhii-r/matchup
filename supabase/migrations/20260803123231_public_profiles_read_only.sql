-- ============================================================================
-- public_profiles: read-only for signed-in users.
--
-- Shipped as a follow-up to security_hardening after prod verification showed
-- `authenticated` still held INSERT/UPDATE/DELETE on the new view.
--
-- Why that mattered: public_profiles is a single-table projection, so Postgres
-- makes it auto-updatable, and it runs with the owner's rights
-- (security_invoker = off) so it can read the self-only base table. Those two
-- facts together mean ANY write privilege on the view bypasses RLS on profiles
-- entirely — a signed-in user could have renamed or deleted another user's
-- profile row. Supabase's default privileges grant ALL on new objects in the
-- public schema to `authenticated`, and the original revoke named only
-- anon and PUBLIC, so the grant survived.
--
-- security_hardening now carries the corrected revoke as well. Both statements
-- are idempotent, so the two files can run in either order or twice over.
-- ============================================================================

revoke all    on public.public_profiles from authenticated, anon, public;
grant  select on public.public_profiles to authenticated;

-- Belt and braces: refuse writes even if a privilege is re-granted by accident.
create or replace rule public_profiles_no_insert as
  on insert to public.public_profiles do instead nothing;
create or replace rule public_profiles_no_update as
  on update to public.public_profiles do instead nothing;
create or replace rule public_profiles_no_delete as
  on delete to public.public_profiles do instead nothing;
