-- ============================================================================
-- MatchUp — Phase 1 schema
-- Tables, PostGIS geography (generated from lat/lng), indexes, helpers, RPC.
-- RLS policies live in 0002_phase1_rls.sql.
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null,
  phone             text,
  area_name         text,
  sport_pref        text[] not null default '{}',
  home_lat          double precision,
  home_lng          double precision,
  home_location     geography(Point, 4326)
                      generated always as (
                        case
                          when home_lat is not null and home_lng is not null
                          then ST_SetSRID(ST_MakePoint(home_lng, home_lat), 4326)::geography
                          else null
                        end
                      ) stored,
  avatar_url        text,
  reliability_score numeric,             -- Phase 2 (computed server-side); null in Phase 1
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sport_pref_valid check (sport_pref <@ array['box_cricket','badminton']::text[])
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create index profiles_home_location_gix on public.profiles using gist (home_location);

-- ---------------------------------------------------------------------------
-- venues  (static directory; "call to confirm" in Phase 1)
-- ---------------------------------------------------------------------------
create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  location      geography(Point, 4326)
                  generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  sport_types   text[] not null default '{}',
  phone         text,
  confirm_note  text not null default 'Call to confirm availability',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index venues_location_gix on public.venues using gist (location);

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.profiles (id) on delete cascade,
  sport         text not null check (sport in ('box_cricket','badminton')),
  venue_id      uuid references public.venues (id) on delete set null,
  venue_text    text,
  scheduled_at  timestamptz not null,
  total_slots   integer not null check (total_slots > 0),
  filled_slots  integer not null default 1 check (filled_slots >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  status        text not null default 'open' check (status in ('open','locked','completed','cancelled')),
  share_code    text not null unique,
  lat           double precision not null,
  lng           double precision not null,
  location      geography(Point, 4326)
                  generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint filled_not_over check (filled_slots <= total_slots)
);
create index matches_location_gix on public.matches using gist (location);
create index matches_status_idx on public.matches (status);
create index matches_creator_idx on public.matches (creator_id);

-- ---------------------------------------------------------------------------
-- match_players  (join + approval state)
-- ---------------------------------------------------------------------------
create table public.match_players (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'interested' check (status in ('interested','approved','rejected','confirmed')),
  joined_via  text not null default 'browse' check (joined_via in ('code','browse','alert')),
  created_at  timestamptz not null default now(),
  unique (match_id, user_id)
);
create index match_players_match_idx on public.match_players (match_id);
create index match_players_user_idx on public.match_players (user_id);

-- ---------------------------------------------------------------------------
-- attendance  (core trust signal)
-- ---------------------------------------------------------------------------
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  attended    boolean not null,
  marked_by   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (match_id, user_id)
);

-- ---------------------------------------------------------------------------
-- availability  ("I'm available today")
-- ---------------------------------------------------------------------------
create table public.availability (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  sport           text not null check (sport in ('box_cricket','badminton')),
  available_date  date not null,
  lat             double precision not null,
  lng             double precision not null,
  location        geography(Point, 4326)
                    generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  note            text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  unique (user_id, sport, available_date)
);
create index availability_location_gix on public.availability using gist (location);
create index availability_date_idx on public.availability (available_date);

-- ---------------------------------------------------------------------------
-- devices  (FCM push tokens)
-- ---------------------------------------------------------------------------
create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  fcm_token   text not null unique,
  platform    text not null check (platform in ('ios','android')),
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- reports  (safety / moderation)
-- ---------------------------------------------------------------------------
create table public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.profiles (id) on delete cascade,
  reported_user_id  uuid not null references public.profiles (id) on delete cascade,
  match_id          uuid references public.matches (id) on delete set null,
  reason            text not null,
  details           text,
  status            text not null default 'open' check (status in ('open','reviewed','actioned','dismissed')),
  created_at        timestamptz not null default now(),
  constraint no_self_report check (reporter_id <> reported_user_id)
);

-- ---------------------------------------------------------------------------
-- blocks  (user block list)
-- ---------------------------------------------------------------------------
create table public.blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------------
-- Helper: is there a block in either direction between two users?
-- Used by RLS and the nearby RPC to keep blocked users out of each other's view.
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: nearby_matches — open matches within radius, sport-filtered, block-aware.
-- Always paginated (limit 50). Distance-ordered.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_matches(
  in_lat       double precision,
  in_lng       double precision,
  in_radius_m  integer default 5000,
  in_sport     text default null
)
returns setof public.matches
language sql stable security definer set search_path = public as $$
  select m.*
  from public.matches m
  where m.status = 'open'
    and (in_sport is null or m.sport = in_sport)
    and ST_DWithin(
          m.location,
          ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
          in_radius_m)
    and not public.is_blocked_between(auth.uid(), m.creator_id)
  order by m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
  limit 50;
$$;
