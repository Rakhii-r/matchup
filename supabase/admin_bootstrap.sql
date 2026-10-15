-- ============================================================================
-- Bootstrap the FIRST superadmin.
--
-- user_roles writes are superadmin-only via RLS, so the first one cannot be created
-- from the app. Run this ONCE in the Supabase SQL editor (which uses the service
-- role and bypasses RLS), or via `supabase db` against your local stack.
--
-- After this, that superadmin can access the Admin Portal in-app.
-- ============================================================================

-- 1) Find the target user's id (the person must have signed up + created a profile):
--    select id, full_name, phone from public.profiles where phone = '+91XXXXXXXXXX';

-- 2) Grant superadmin role (replace 'TARGET_USER_UUID' with the actual profile UUID):
insert into public.user_roles (user_id, role_id)
select 
  'TARGET_USER_UUID'::uuid, 
  r.id
from public.roles r
where r.name = 'superadmin'
on conflict (user_id, role_id) do nothing;

-- 3) Verify:
--    select p.full_name, p.phone, r.name as role
--    from public.user_roles ur 
--    join public.roles r on r.id = ur.role_id
--    join public.profiles p on p.id = ur.user_id;
