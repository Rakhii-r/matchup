-- Local development seed data. Loaded by `supabase db reset`.
-- Venues for one locality (example: Pune) so the directory and nearby queries
-- have something to show. created_by is null (system-seeded).

insert into public.venues (name, address, lat, lng, sport_types, phone, confirm_note) values
  ('Smash Arena Badminton',  'Kothrud, Pune',       18.5074, 73.8077, array['badminton'],            '+919000000001', 'Call to confirm availability'),
  ('BoxOut Cricket Turf',    'Baner, Pune',         18.5590, 73.7868, array['box_cricket'],          '+919000000002', 'Call to confirm availability'),
  ('Game Point Sports Club', 'Aundh, Pune',         18.5590, 73.8074, array['badminton','box_cricket'], '+919000000003', 'Call to confirm availability'),
  ('Rally Shuttle Court',    'Viman Nagar, Pune',   18.5679, 73.9143, array['badminton'],            '+919000000004', 'Call to confirm availability');
