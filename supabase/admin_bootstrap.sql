-- ============================================================================
-- Bootstrap the FIRST superadmin.
--
-- user_roles writes are superadmin-only via RLS, so the first one cannot be created
-- from the app. Run this ONCE in the Supabase SQL editor (which uses the service
-- role and bypasses RLS), or via `supabase db` against your local stack.
--
-- After this, that superadmin can grant/revoke roles in-app.
-- ============================================================================

-- 1) Find the target user's id (the person must have signed up + created a profile):
--    select id, full_name, phone from public.profiles where phone = '+9198XXXXXXXX';

-- 2) Grant superadmin (replace the UUID):
insert into public.user_roles (user_id, role)
values ('00000000-0000-0000-0000-000000000000', 'superadmin')
on conflict (user_id, role) do nothing;

-- 3) Verify:
--    select ur.role, p.full_name, p.phone
--    from public.user_roles ur join public.profiles p on p.id = ur.user_id;
