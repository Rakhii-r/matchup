-- MOVED OUT OF migrations/ on 27 Oct 2026 and NEVER applied to production.
-- It creates fake logins, players, teams and scored matches; on the live
-- database real users would see them. Run it only against a demo/staging
-- project. Play reviewers get a test phone number + OTP instead.

-- ============================================================================
-- Play Store Release Seed Migration: Real Hyderabad Box-Cricket Venues, Teams,
-- Full Rosters, Scored Matches, and Active Open Match Discovery.
--
-- Ensures Google Play Reviewers encounter rich, functional screens instead of
-- empty states across Venues, Teams, Matchmaking, Live Scorecards, and Profiles.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Real Hyderabad Box-Cricket Venues (8 Venues with Geo-coordinates & Pricing)
-- ---------------------------------------------------------------------------
insert into public.venues (
  id,
  name,
  address,
  lat,
  lng,
  sport_types,
  phone,
  confirm_note,
  price_per_hour,
  rating,
  rating_count,
  facilities,
  status,
  operating_hours_start,
  operating_hours_end,
  slot_duration_minutes,
  courts_count
)
values
  (
    'a0000000-0000-0000-0000-000000000001',
    'Dugout Box Cricket - Madhapur',
    'Near Durgam Cheruvu Metro Station, Madhapur, Hyderabad, Telangana 500081',
    17.4435,
    78.3887,
    array['box_cricket']::text[],
    '+919876500001',
    'Direct slot booking available 24/7. Turf spikes not permitted.',
    1200,
    4.8,
    85,
    array['Floodlights', 'Turf Pitch', 'Parking', 'Drinking Water', 'Dugout', 'Restrooms'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    3
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    'Hitex Box Cricket Arena - Gachibowli',
    'Financial District, Near Wipro Circle, Gachibowli, Hyderabad, Telangana 500032',
    17.4190,
    78.3489,
    array['box_cricket']::text[],
    '+919876500002',
    'Premium turf with digital scoreboard and spectator seating.',
    1500,
    4.9,
    120,
    array['Floodlights', 'FIFA Grade Turf', 'Covered Net', 'Cafeteria', 'Parking', 'Live Streaming Setup'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    4
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    'Powerplay Turf - Jubilee Hills',
    'Road No. 36, Near Peddamma Temple Metro, Jubilee Hills, Hyderabad, Telangana 500033',
    17.4319,
    78.4073,
    array['box_cricket', 'badminton']::text[],
    '+919876500003',
    'Professional box cricket court with high ceiling netting.',
    1600,
    4.7,
    64,
    array['Floodlights', 'Changing Rooms', 'Equipment Rental', 'First Aid', 'Parking'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    2
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    'Striker''s Bay Turf - Kondapur',
    'Near Botanical Garden Road, Kondapur, Hyderabad, Telangana 500084',
    17.4612,
    78.3638,
    array['box_cricket']::text[],
    '+919876500004',
    'Standard size 6v6 & 8v8 box cricket pitch with LED floodlighting.',
    1100,
    4.6,
    48,
    array['Floodlights', 'Turf Pitch', 'Parking', 'Drinking Water'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    3
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    'Sky Turf Sports Arena - Begumpet',
    'Prakash Nagar, Airport Road, Begumpet, Hyderabad, Telangana 500016',
    17.4447,
    78.4682,
    array['box_cricket']::text[],
    '+919876500005',
    'Rooftop box cricket arena with panoramic city view and breeze.',
    1300,
    4.7,
    72,
    array['Rooftop Pitch', 'LED Floodlights', 'Refreshment Lounge', 'Parking'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    2
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    'Spartan Box Cricket - KPHB',
    'Near KPHB Phase 3, Kukatpally, Hyderabad, Telangana 500072',
    17.4932,
    78.3995,
    array['box_cricket']::text[],
    '+919876500006',
    'Popular college and corporate tournament hub in Kukatpally.',
    1000,
    4.8,
    95,
    array['Floodlights', 'Heavy Duty Turf', 'Cricket Gear Available', 'Parking'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    3
  ),
  (
    'a0000000-0000-0000-0000-000000000007',
    'The Arena Box Cricket - Hitec City',
    'Mindspace Junction, Hitec City, Hyderabad, Telangana 500081',
    17.4399,
    78.3806,
    array['box_cricket']::text[],
    '+919876500007',
    'Ultra-modern turf located right in the heart of Cyberabad IT corridor.',
    1400,
    4.9,
    110,
    array['Floodlights', 'High-density AstroTurf', 'Locker Rooms', 'Showers', 'Café'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    4
  ),
  (
    'a0000000-0000-0000-0000-000000000008',
    'Urban Sports Box Cricket - Banjara Hills',
    'Road No. 12, Banjara Hills, Hyderabad, Telangana 500034',
    17.4156,
    78.4350,
    array['box_cricket', 'badminton']::text[],
    '+919876500008',
    'Centrally located premium sports arena with dual indoor and outdoor nets.',
    1500,
    4.7,
    50,
    array['Floodlights', 'Indoor Net', 'Outdoor Turf', 'Valet Parking', 'Pro Shop'],
    'approved',
    '00:00:00',
    '24:00:00',
    60,
    2
  )
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  lat = excluded.lat,
  lng = excluded.lng,
  sport_types = excluded.sport_types,
  phone = excluded.phone,
  confirm_note = excluded.confirm_note,
  price_per_hour = excluded.price_per_hour,
  rating = excluded.rating,
  rating_count = excluded.rating_count,
  facilities = excluded.facilities,
  status = excluded.status,
  operating_hours_start = excluded.operating_hours_start,
  operating_hours_end = excluded.operating_hours_end,
  slot_duration_minutes = excluded.slot_duration_minutes,
  courts_count = excluded.courts_count;

-- ---------------------------------------------------------------------------
-- 2. Auth Users & Profiles (18 Seed Profiles for 3 Full 6v6 Teams)
-- ---------------------------------------------------------------------------
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('11111111-1111-1111-1111-111111111101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rahul.varma@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Rahul Varma"}', now(), now()),
  ('11111111-1111-1111-1111-111111111102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pranay.teja@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Pranay Teja"}', now(), now()),
  ('11111111-1111-1111-1111-111111111103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'abhishek.k@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Abhishek Kumar"}', now(), now()),
  ('11111111-1111-1111-1111-111111111104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'karthik.rao@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Karthik Rao"}', now(), now()),
  ('11111111-1111-1111-1111-111111111105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sandeep.g@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sandeep Goud"}', now(), now()),
  ('11111111-1111-1111-1111-111111111106', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nikhil.c@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Nikhil Chowdary"}', now(), now()),

  ('11111111-1111-1111-1111-111111111107', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vikram.reddy@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Vikram Reddy"}', now(), now()),
  ('11111111-1111-1111-1111-111111111108', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rohit.s@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Rohit Sharma"}', now(), now()),
  ('11111111-1111-1111-1111-111111111109', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'varun.tej@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Varun Tej"}', now(), now()),
  ('11111111-1111-1111-1111-111111111110', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'aditya.j@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Aditya Joshi"}', now(), now()),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tarun.n@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Tarun Naidu"}', now(), now()),
  ('11111111-1111-1111-1111-111111111112', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manish.v@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Manish Varma"}', now(), now()),

  ('11111111-1111-1111-1111-111111111113', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sai.kiran@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sai Kiran"}', now(), now()),
  ('11111111-1111-1111-1111-111111111114', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'harsh.v@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Harsh Vardhan"}', now(), now()),
  ('11111111-1111-1111-1111-111111111115', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'akhil.a@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Akhil Akkineni"}', now(), now()),
  ('11111111-1111-1111-1111-111111111116', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'naveen.p@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Naveen Polishetty"}', now(), now()),
  ('11111111-1111-1111-1111-111111111117', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vijay.d@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Vijay Devarakonda"}', now(), now()),
  ('11111111-1111-1111-1111-111111111118', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'suresh.b@matchup.local', crypt('Password@123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Suresh Babu"}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (
  id,
  full_name,
  phone,
  area_name,
  sport_pref,
  home_lat,
  home_lng,
  avatar_url,
  reliability_score,
  is_active
)
values
  ('11111111-1111-1111-1111-111111111101', 'Rahul Varma', '+919876543201', 'Madhapur', array['box_cricket']::text[], 17.4435, 78.3887, 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 98, true),
  ('11111111-1111-1111-1111-111111111102', 'Pranay Teja', '+919876543202', 'Madhapur', array['box_cricket']::text[], 17.4420, 78.3870, 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150', 95, true),
  ('11111111-1111-1111-1111-111111111103', 'Abhishek Kumar', '+919876543203', 'Hitec City', array['box_cricket']::text[], 17.4400, 78.3810, 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=150', 92, true),
  ('11111111-1111-1111-1111-111111111104', 'Karthik Rao', '+919876543204', 'Kondapur', array['box_cricket']::text[], 17.4610, 78.3640, 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150', 96, true),
  ('11111111-1111-1111-1111-111111111105', 'Sandeep Goud', '+919876543205', 'Jubilee Hills', array['box_cricket']::text[], 17.4320, 78.4070, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 90, true),
  ('11111111-1111-1111-1111-111111111106', 'Nikhil Chowdary', '+919876543206', 'Gachibowli', array['box_cricket']::text[], 17.4200, 78.3500, 'https://images.unsplash.com/photo-1628157582853-a796fa650a6a?w=150', 94, true),

  ('11111111-1111-1111-1111-111111111107', 'Vikram Reddy', '+919876543207', 'Gachibowli', array['box_cricket']::text[], 17.4190, 78.3489, 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 97, true),
  ('11111111-1111-1111-1111-111111111108', 'Rohit Sharma', '+919876543208', 'Financial District', array['box_cricket']::text[], 17.4150, 78.3420, 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150', 94, true),
  ('11111111-1111-1111-1111-111111111109', 'Varun Tej', '+919876543209', 'Kondapur', array['box_cricket']::text[], 17.4600, 78.3650, 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150', 91, true),
  ('11111111-1111-1111-1111-111111111110', 'Aditya Joshi', '+919876543210', 'Madhapur', array['box_cricket']::text[], 17.4450, 78.3890, 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150', 95, true),
  ('11111111-1111-1111-1111-111111111111', 'Tarun Naidu', '+919876543211', 'Manikonda', array['box_cricket']::text[], 17.4000, 78.3800, 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150', 89, true),
  ('11111111-1111-1111-1111-111111111112', 'Manish Varma', '+919876543212', 'Gachibowli', array['box_cricket']::text[], 17.4220, 78.3510, 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150', 93, true),

  ('11111111-1111-1111-1111-111111111113', 'Sai Kiran', '+919876543213', 'Hitec City', array['box_cricket']::text[], 17.4399, 78.3806, 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150', 96, true),
  ('11111111-1111-1111-1111-111111111114', 'Harsh Vardhan', '+919876543214', 'Kondapur', array['box_cricket']::text[], 17.4620, 78.3620, 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150', 92, true),
  ('11111111-1111-1111-1111-111111111115', 'Akhil Akkineni', '+919876543215', 'Jubilee Hills', array['box_cricket']::text[], 17.4300, 78.4050, 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150', 95, true),
  ('11111111-1111-1111-1111-111111111116', 'Naveen Polishetty', '+919876543216', 'Banjara Hills', array['box_cricket']::text[], 17.4160, 78.4340, 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150', 90, true),
  ('11111111-1111-1111-1111-111111111117', 'Vijay Devarakonda', '+919876543217', 'Madhapur', array['box_cricket']::text[], 17.4440, 78.3860, 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=150', 94, true),
  ('11111111-1111-1111-1111-111111111118', 'Suresh Babu', '+919876543218', 'Begumpet', array['box_cricket']::text[], 17.4450, 78.4670, 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150', 91, true)
on conflict (id) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  area_name = excluded.area_name,
  sport_pref = excluded.sport_pref,
  home_lat = excluded.home_lat,
  home_lng = excluded.home_lng,
  avatar_url = excluded.avatar_url,
  reliability_score = excluded.reliability_score,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- 3. Teams with Declared Formats (target_size = 6) & Full Squad Rosters
-- ---------------------------------------------------------------------------
insert into public.teams (
  id,
  name,
  sport,
  owner_id,
  invite_code,
  target_size,
  description,
  home_ground,
  logo_url
)
values
  (
    '22222222-2222-2222-2222-222222222201',
    'ASR Warriors',
    'box_cricket',
    '11111111-1111-1111-1111-111111111101',
    'ASRWAR',
    6,
    'Premier Madhapur box cricket squad. Competitive 6v6 fixtures on weeknights.',
    'Dugout Box Cricket - Madhapur',
    'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=200'
  ),
  (
    '22222222-2222-2222-2222-222222222202',
    'Deccan Strikers',
    'box_cricket',
    '11111111-1111-1111-1111-111111111107',
    'DECSTR',
    6,
    'High energy corporate and club squad from Gachibowli. Fast bowling and aggressive batting.',
    'Hitex Box Cricket Arena - Gachibowli',
    'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=200'
  ),
  (
    '22222222-2222-2222-2222-222222222203',
    'Cyberabad Royals',
    'box_cricket',
    '11111111-1111-1111-1111-111111111113',
    'CYBROY',
    6,
    'Hitec City based turf champions. Always open for friendly & tournament matches.',
    'The Arena Box Cricket - Hitec City',
    'https://images.unsplash.com/photo-1511886929837-354d827aae26?w=200'
  )
on conflict (id) do update set
  name = excluded.name,
  sport = excluded.sport,
  owner_id = excluded.owner_id,
  invite_code = excluded.invite_code,
  target_size = excluded.target_size,
  description = excluded.description,
  home_ground = excluded.home_ground,
  logo_url = excluded.logo_url;

-- Team 1 Members (ASR Warriors)
insert into public.team_members (id, team_id, user_id, role, joined_at)
values
  ('55555555-5555-5555-5555-555555555501', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111101', 'owner', now() - interval '30 days'),
  ('55555555-5555-5555-5555-555555555502', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111102', 'member', now() - interval '28 days'),
  ('55555555-5555-5555-5555-555555555503', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111103', 'member', now() - interval '25 days'),
  ('55555555-5555-5555-5555-555555555504', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111104', 'member', now() - interval '20 days'),
  ('55555555-5555-5555-5555-555555555505', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111105', 'member', now() - interval '15 days'),
  ('55555555-5555-5555-5555-555555555506', '22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111106', 'member', now() - interval '10 days')
on conflict (id) do nothing;

-- Team 2 Members (Deccan Strikers)
insert into public.team_members (id, team_id, user_id, role, joined_at)
values
  ('55555555-5555-5555-5555-555555555507', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111107', 'owner', now() - interval '30 days'),
  ('55555555-5555-5555-5555-555555555508', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111108', 'member', now() - interval '28 days'),
  ('55555555-5555-5555-5555-555555555509', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111109', 'member', now() - interval '25 days'),
  ('55555555-5555-5555-5555-555555555510', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111110', 'member', now() - interval '20 days'),
  ('55555555-5555-5555-5555-555555555511', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111', 'member', now() - interval '15 days'),
  ('55555555-5555-5555-5555-555555555512', '22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111112', 'member', now() - interval '10 days')
on conflict (id) do nothing;

-- Team 3 Members (Cyberabad Royals)
insert into public.team_members (id, team_id, user_id, role, joined_at)
values
  ('55555555-5555-5555-5555-555555555513', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111113', 'owner', now() - interval '30 days'),
  ('55555555-5555-5555-5555-555555555514', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111114', 'member', now() - interval '28 days'),
  ('55555555-5555-5555-5555-555555555515', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111115', 'member', now() - interval '25 days'),
  ('55555555-5555-5555-5555-555555555516', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111116', 'member', now() - interval '20 days'),
  ('55555555-5555-5555-5555-555555555517', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111117', 'member', now() - interval '15 days'),
  ('55555555-5555-5555-5555-555555555518', '22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111118', 'member', now() - interval '10 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Completed Match with Full Roster, Toss, and Ball-by-Ball Scorecard
-- ---------------------------------------------------------------------------
insert into public.matches (
  id,
  creator_id,
  match_name,
  sport,
  venue_id,
  venue_text,
  area_name,
  scheduled_at,
  end_time,
  total_slots,
  filled_slots,
  missing_count,
  status,
  share_code,
  lat,
  lng,
  match_lat,
  match_lng,
  team_a_id,
  team_b_id,
  overs,
  scorer_id,
  motm_user_id,
  result_text,
  game_type,
  match_type,
  created_at
)
values
  (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111101',
    'ASR Warriors vs Deccan Strikers - Season Opener',
    'box_cricket',
    'a0000000-0000-0000-0000-000000000001',
    'Dugout Box Cricket - Madhapur',
    'Madhapur',
    now() - interval '2 days',
    now() - interval '2 days' + interval '2 hours',
    12,
    12,
    0,
    'completed',
    'WARSTK01',
    17.4435,
    78.3887,
    17.4435,
    78.3887,
    '22222222-2222-2222-2222-222222222201',
    '22222222-2222-2222-2222-222222222202',
    6,
    '11111111-1111-1111-1111-111111111101',
    '11111111-1111-1111-1111-111111111101',
    'ASR Warriors won by 8 runs',
    'competitive',
    'team_vs_team',
    now() - interval '3 days'
  )
on conflict (id) do update set
  status = excluded.status,
  result_text = excluded.result_text,
  motm_user_id = excluded.motm_user_id,
  scorer_id = excluded.scorer_id;

-- Match Lineup Players for both squads
insert into public.match_players (id, match_id, user_id, team_id, status, joined_via, role)
values
  -- Team A (ASR Warriors)
  ('66666666-6666-6666-6666-666666666601', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111101', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666602', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111102', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666603', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111103', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666604', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111104', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666605', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111105', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666606', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111106', '22222222-2222-2222-2222-222222222201', 'confirmed', 'challenge', 'player'),

  -- Team B (Deccan Strikers)
  ('66666666-6666-6666-6666-666666666607', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111107', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666608', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111108', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666609', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111109', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666610', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111110', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666611', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player'),
  ('66666666-6666-6666-6666-666666666612', '33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111112', '22222222-2222-2222-2222-222222222202', 'confirmed', 'challenge', 'player')
on conflict (id) do nothing;

-- Match Toss
insert into public.match_toss (match_id, called_by, winner_team_id, outcome, decision, created_at, decided_at)
values (
  '33333333-3333-3333-3333-333333333301',
  '11111111-1111-1111-1111-111111111101',
  '22222222-2222-2222-2222-222222222201',
  'heads',
  'bat',
  now() - interval '2 days',
  now() - interval '2 days'
)
on conflict (match_id) do update set
  decision = excluded.decision,
  winner_team_id = excluded.winner_team_id;

-- Innings 1 (ASR Warriors Batting, Deccan Strikers Bowling)
insert into public.innings (
  id,
  match_id,
  number,
  batting_team_id,
  bowling_team_id,
  target,
  status,
  runs,
  wickets,
  legal_balls,
  created_at,
  ended_at
)
values (
  '77777777-7777-7777-7777-777777777701',
  '33333333-3333-3333-3333-333333333301',
  1,
  '22222222-2222-2222-2222-222222222201',
  '22222222-2222-2222-2222-222222222202',
  null,
  'completed',
  58,
  3,
  36,
  now() - interval '2 days',
  now() - interval '2 days' + interval '45 minutes'
)
on conflict (match_id, number) do update set
  status = excluded.status,
  runs = excluded.runs,
  wickets = excluded.wickets,
  legal_balls = excluded.legal_balls;

-- Innings 2 (Deccan Strikers Batting, ASR Warriors Bowling - Target 59)
insert into public.innings (
  id,
  match_id,
  number,
  batting_team_id,
  bowling_team_id,
  target,
  status,
  runs,
  wickets,
  legal_balls,
  created_at,
  ended_at
)
values (
  '77777777-7777-7777-7777-777777777702',
  '33333333-3333-3333-3333-333333333301',
  2,
  '22222222-2222-2222-2222-222222222202',
  '22222222-2222-2222-2222-222222222201',
  59,
  'completed',
  50,
  5,
  36,
  now() - interval '2 days' + interval '50 minutes',
  now() - interval '2 days' + interval '95 minutes'
)
on conflict (match_id, number) do update set
  status = excluded.status,
  runs = excluded.runs,
  wickets = excluded.wickets,
  legal_balls = excluded.legal_balls;

-- Ball-by-ball deliveries for Innings 1 (36 balls = 6 overs)
insert into public.deliveries (innings_id, seq, over_number, ball_in_over, striker_id, non_striker_id, bowler_id, runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id)
values
  -- Over 1 (Bowler: Vikram Reddy)
  ('77777777-7777-7777-7777-777777777701', 1, 0, 1, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111107', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 2, 0, 2, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 3, 0, 3, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 4, 0, 4, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 5, 0, 5, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 6, 0, 6, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111107', 6, null, 0, null, null),

  -- Over 2 (Bowler: Rohit Sharma)
  ('77777777-7777-7777-7777-777777777701', 7, 1, 1, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111108', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 8, 1, 2, '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111108', 0, null, 0, 'caught', '11111111-1111-1111-1111-111111111102'),
  ('77777777-7777-7777-7777-777777777701', 9, 1, 3, '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111108', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 10, 1, 4, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111108', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 11, 1, 5, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111108', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 12, 1, 6, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111108', 1, null, 0, null, null),

  -- Over 3 (Bowler: Varun Tej)
  ('77777777-7777-7777-7777-777777777701', 13, 2, 1, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111109', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 14, 2, 2, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111109', 6, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 15, 2, 3, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111109', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 16, 2, 4, '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111109', 0, null, 0, 'bowled', '11111111-1111-1111-1111-111111111103'),
  ('77777777-7777-7777-7777-777777777701', 17, 2, 5, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111109', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 18, 2, 6, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111109', 1, null, 0, null, null),

  -- Over 4 (Bowler: Aditya Joshi)
  ('77777777-7777-7777-7777-777777777701', 19, 3, 1, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 20, 3, 2, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111110', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 21, 3, 3, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 22, 3, 4, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 23, 3, 5, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 24, 3, 6, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111110', 1, null, 0, null, null),

  -- Over 5 (Bowler: Tarun Naidu)
  ('77777777-7777-7777-7777-777777777701', 25, 4, 1, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', 6, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 26, 4, 2, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 27, 4, 3, '11111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', 0, null, 0, 'run_out', '11111111-1111-1111-1111-111111111104'),
  ('77777777-7777-7777-7777-777777777701', 28, 4, 4, '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 29, 4, 5, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111111', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 30, 4, 6, '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', 2, null, 0, null, null),

  -- Over 6 (Bowler: Vikram Reddy)
  ('77777777-7777-7777-7777-777777777701', 31, 5, 1, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111107', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 32, 5, 2, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111107', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 33, 5, 3, '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 34, 5, 4, '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111107', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 35, 5, 5, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111107', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777701', 36, 5, 6, '11111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111105', '11111111-1111-1111-1111-111111111107', 1, null, 0, null, null)
on conflict (innings_id, seq) do nothing;

-- Ball-by-ball deliveries for Innings 2 (36 balls = 6 overs)
insert into public.deliveries (innings_id, seq, over_number, ball_in_over, striker_id, non_striker_id, bowler_id, runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id)
values
  -- Over 1 (Bowler: Rahul Varma)
  ('77777777-7777-7777-7777-777777777702', 1, 0, 1, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111101', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 2, 0, 2, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111101', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 3, 0, 3, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111101', 0, null, 0, 'bowled', '11111111-1111-1111-1111-111111111107'),
  ('77777777-7777-7777-7777-777777777702', 4, 0, 4, '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111101', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 5, 0, 5, '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111101', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 6, 0, 6, '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111101', 1, null, 0, null, null),

  -- Over 2 (Bowler: Pranay Teja)
  ('77777777-7777-7777-7777-777777777702', 7, 1, 1, '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111102', 6, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 8, 1, 2, '11111111-1111-1111-1111-111111111108', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111102', 0, null, 0, 'caught', '11111111-1111-1111-1111-111111111108'),
  ('77777777-7777-7777-7777-777777777702', 9, 1, 3, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111102', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 10, 1, 4, '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111102', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 11, 1, 5, '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111102', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 12, 1, 6, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111102', 2, null, 0, null, null),

  -- Over 3 (Bowler: Abhishek Kumar)
  ('77777777-7777-7777-7777-777777777702', 13, 2, 1, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111103', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 14, 2, 2, '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111103', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 15, 2, 3, '11111111-1111-1111-1111-111111111109', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111103', 0, null, 0, 'lbw', '11111111-1111-1111-1111-111111111109'),
  ('77777777-7777-7777-7777-777777777702', 16, 2, 4, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111103', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 17, 2, 5, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111103', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 18, 2, 6, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111103', 1, null, 0, null, null),

  -- Over 4 (Bowler: Karthik Rao)
  ('77777777-7777-7777-7777-777777777702', 19, 3, 1, '11111111-1111-1111-1111-111111111110', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111104', 0, null, 0, 'caught', '11111111-1111-1111-1111-111111111110'),
  ('77777777-7777-7777-7777-777777777702', 20, 3, 2, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111104', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 21, 3, 3, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111104', 4, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 22, 3, 4, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111104', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 23, 3, 5, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111104', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 24, 3, 6, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111104', 2, null, 0, null, null),

  -- Over 5 (Bowler: Sandeep Goud)
  ('77777777-7777-7777-7777-777777777702', 25, 4, 1, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111105', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 26, 4, 2, '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111105', 0, null, 0, 'bowled', '11111111-1111-1111-1111-111111111111'),
  ('77777777-7777-7777-7777-777777777702', 27, 4, 3, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111105', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 28, 4, 4, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111105', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 29, 4, 5, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111105', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 30, 4, 6, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111105', 4, null, 0, null, null),

  -- Over 6 (Bowler: Rahul Varma)
  ('77777777-7777-7777-7777-777777777702', 31, 5, 1, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111101', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 32, 5, 2, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111101', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 33, 5, 3, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111101', 0, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 34, 5, 4, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111101', 2, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 35, 5, 5, '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111101', 1, null, 0, null, null),
  ('77777777-7777-7777-7777-777777777702', 36, 5, 6, '11111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111107', '11111111-1111-1111-1111-111111111101', 0, null, 0, null, null)
on conflict (innings_id, seq) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Upcoming Open Matches & Challenges (for Matchmaking Discovery & Radar)
-- ---------------------------------------------------------------------------
insert into public.matches (
  id,
  creator_id,
  match_name,
  sport,
  venue_id,
  venue_text,
  area_name,
  scheduled_at,
  end_time,
  total_slots,
  filled_slots,
  missing_count,
  status,
  share_code,
  lat,
  lng,
  match_lat,
  match_lng,
  game_type,
  match_type,
  created_at
)
values
  (
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111101',
    'Friday Night Box Cricket Open',
    'box_cricket',
    'a0000000-0000-0000-0000-000000000001',
    'Dugout Box Cricket - Madhapur',
    'Madhapur',
    now() + interval '1 day' + interval '8 hours',
    now() + interval '1 day' + interval '10 hours',
    12,
    4,
    0,
    'open',
    'MADHAP01',
    17.4435,
    78.3887,
    17.4435,
    78.3887,
    'friendly',
    'open',
    now()
  )
on conflict (id) do update set
  scheduled_at = excluded.scheduled_at,
  end_time = excluded.end_time,
  status = excluded.status;

insert into public.match_players (id, match_id, user_id, status, joined_via, role)
values
  ('66666666-6666-6666-6666-666666666621', '33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111101', 'confirmed', 'browse', 'creator'),
  ('66666666-6666-6666-6666-666666666622', '33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111102', 'confirmed', 'browse', 'player'),
  ('66666666-6666-6666-6666-666666666623', '33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111103', 'confirmed', 'browse', 'player'),
  ('66666666-6666-6666-6666-666666666624', '33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111104', 'confirmed', 'browse', 'player')
on conflict (id) do nothing;

-- Open Challenge by Deccan Strikers (Hitex Arena)
insert into public.team_challenges (
  id,
  from_team_id,
  to_team_id,
  created_by,
  match_name,
  venue_id,
  scheduled_at,
  end_time,
  total_slots,
  status,
  game_type,
  search_radius_m,
  created_at
)
values
  (
    '44444444-4444-4444-4444-444444444401',
    '22222222-2222-2222-2222-222222222202',
    null,
    '11111111-1111-1111-1111-111111111107',
    'Weekend Box Cricket Derby - Open Challenge',
    'a0000000-0000-0000-0000-000000000002',
    now() + interval '2 days',
    now() + interval '2 days' + interval '2 hours',
    12,
    'open',
    'competitive',
    25000,
    now()
  )
on conflict (id) do update set
  scheduled_at = excluded.scheduled_at,
  end_time = excluded.end_time,
  status = excluded.status;
