-- Ensure team-logos bucket exists and is public
insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do update set public = true;

-- Drop any previous policies on storage.objects for team-logos
drop policy if exists "team_logos_public_read" on storage.objects;
drop policy if exists "team_logos_owner_write" on storage.objects;
drop policy if exists "team_logos_owner_insert" on storage.objects;
drop policy if exists "team_logos_owner_update" on storage.objects;
drop policy if exists "team_logos_owner_delete" on storage.objects;
drop policy if exists "team_logos_owner_all" on storage.objects;

-- Public read for team logos
create policy "team_logos_public_read" on storage.objects for select
  using (bucket_id = 'team-logos');

-- Team owner insert policy
create policy "team_logos_owner_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'team-logos'
    and exists (
      select 1 from public.teams t
      where t.id::text = (storage.foldername(name))[1]
        and t.owner_id = (select auth.uid())
    )
  );

-- Team owner update policy (needed for upsert: true and updating logos)
create policy "team_logos_owner_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'team-logos'
    and exists (
      select 1 from public.teams t
      where t.id::text = (storage.foldername(name))[1]
        and t.owner_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'team-logos'
    and exists (
      select 1 from public.teams t
      where t.id::text = (storage.foldername(name))[1]
        and t.owner_id = (select auth.uid())
    )
  );

-- Team owner delete policy
create policy "team_logos_owner_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'team-logos'
    and exists (
      select 1 from public.teams t
      where t.id::text = (storage.foldername(name))[1]
        and t.owner_id = (select auth.uid())
    )
  );
