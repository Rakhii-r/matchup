-- 0007: Profile avatar storage.
-- Public-read bucket so avatar_url resolves without signed URLs. Writes are locked to
-- the owning user via RLS: a user may only touch objects under their own uid/ folder.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can read avatars (bucket is public; explicit policy documents intent).
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- A user may only write to files namespaced under their own uid: "<uid>/avatar.jpg".
create policy "avatars_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
