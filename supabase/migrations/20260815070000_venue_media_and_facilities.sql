-- Venue cards in the redesign show a photo, a rating, an hourly price and a
-- facilities list. None of that existed, so the app was substituting two
-- bundled images keyed by sport. These are the real columns behind those cards.
-- All nullable: an unpopulated venue renders its empty state rather than a zero.
alter table public.venues add column if not exists image_url text;
alter table public.venues add column if not exists rating numeric(2,1)
  check (rating is null or (rating >= 0 and rating <= 5));
alter table public.venues add column if not exists rating_count integer not null default 0
  check (rating_count >= 0);
alter table public.venues add column if not exists price_per_hour integer
  check (price_per_hour is null or price_per_hour >= 0);
alter table public.venues add column if not exists facilities text[] not null default '{}';

-- Public read so venue photos render for signed-out splash/preview surfaces too;
-- writes stay admin-only, matching the venues table's own policy.
insert into storage.buckets (id, name, public)
values ('venue-images', 'venue-images', true)
on conflict (id) do nothing;

drop policy if exists "venue_images_public_read" on storage.objects;
create policy "venue_images_public_read" on storage.objects for select
  using (bucket_id = 'venue-images');

drop policy if exists "venue_images_admin_write" on storage.objects;
create policy "venue_images_admin_write" on storage.objects for all to authenticated
  using (bucket_id = 'venue-images' and public.is_admin())
  with check (bucket_id = 'venue-images' and public.is_admin());
