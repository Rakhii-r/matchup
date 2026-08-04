-- 0008: Collapse to a two-tier model — superadmin vs normal user.
--
-- The product only needs superadmins (who manage venues and view users) and everyone
-- else. Rather than drop the 'moderator' enum value (destructive in Postgres and would
-- churn every policy), we redefine is_admin() to mean superadmin only. All existing
-- admin RLS policies call is_admin(), so this single change makes 'moderator' powerless
-- and the model effectively two-tier. The enum value is left in place, unused.

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = uid and r.role = 'superadmin'
  );
$$;
