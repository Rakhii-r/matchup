-- 0010: Venues are admin-managed (Phase 1 spec).
--
-- Previously any authenticated user could insert a venue (and update/delete their own).
-- Remove those non-admin write policies. Admin writes remain via venues_admin_all
-- (is_admin() = superadmin) and reads stay open via venues_select.

drop policy if exists venues_insert on public.venues;
drop policy if exists venues_update_owner on public.venues;
drop policy if exists venues_delete_owner on public.venues;
