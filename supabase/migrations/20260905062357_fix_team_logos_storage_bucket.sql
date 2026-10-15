-- ===========================================================================
-- Fix Team Logos Storage Bucket and RLS Policies
-- ===========================================================================

-- 1. Ensure team-logos bucket exists and is public
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do update set public = true;

-- 2. Clean up old policies on storage.objects for team-logos
drop policy if exists "team_logos_public_read" on storage.objects;
drop policy if exists "team_logos_owner_write" on storage.objects;
drop policy if exists "team_logos_owner_insert" on storage.objects;
drop policy if exists "team_logos_owner_update" on storage.objects;
drop policy if exists "team_logos_owner_delete" on storage.objects;
drop policy if exists "team_logos_owner_all" on storage.objects;
drop policy if exists "team_logos_auth_insert" on storage.objects;
drop policy if exists "team_logos_auth_update" on storage.objects;
drop policy if exists "team_logos_auth_delete" on storage.objects;

-- 3. Public read for team logos
create policy "team_logos_public_read" on storage.objects for select
  using (bucket_id = 'team-logos');

-- 4. Authenticated users can insert/upload team logos
create policy "team_logos_auth_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos');

-- 5. Authenticated users can update/upsert team logos
create policy "team_logos_auth_update" on storage.objects for update to authenticated
  using (bucket_id = 'team-logos')
  with check (bucket_id = 'team-logos');

-- 6. Authenticated users can delete team logos
create policy "team_logos_auth_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'team-logos');
