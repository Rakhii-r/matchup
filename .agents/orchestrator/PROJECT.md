# Project: MatchUp Geospatial Play-Zone Targeting, Public Discovery & Offers Deduplication

## Architecture
- **Backend (Postgres & PostGIS on Supabase)**:
  - Spatial storage: `public.profiles.home_location`, `public.venues.location`, `public.matches.location` (`geography(Point, 4326)`).
  - Spatial functions: `public.team_location(team_id)` (centroid of squad members' home locations).
  - RPCs:
    - `public.rank_challenge_candidates`: Geospatial selection via `ST_DWithin(tl.loc, c.origin_location, in_radius_m)` with captain deduplication via `DISTINCT ON (t.owner_id)`.
    - `public.post_open_challenge`: Enqueues `challenge_offer` notifications strictly once per unique captain using `v_notified_users uuid[]`.
    - `public.nearby_matches`: Supports optional coordinates/radius for global discovery and distance-based browsing without creator-radius lockout.
    - `public.list_open_challenges_nearby`: Supports optional team size and coordinates for global fixture browsing.
    - `public.decline_open_challenge`: Cascades decline across all candidate rows owned by the captain for that fixture.
  - Push pipeline: `notification_jobs` table drained by `notify-wave` Edge Function to Expo Push API.
- **Data & Hooks Layer (`src/features/`)**:
  - `matchRepository.ts` & `useMatches.ts`: Global and nearby match queries without blocking on missing GPS.
  - `challengeRepository.ts` & `useChallenges.ts`: Open challenge retrieval and user-level offer deduplication by `challenge_id`.
- **UI & Presentation Layer (`app/`)**:
  - `app/(tabs)/matches.tsx`: Games tab with unblocked public match list, open challenges carousel, and "All" distance chip.
  - `app/(tabs)/index.tsx`: Home feed with global match discovery and open challenges rails.
  - `app/teams/offers.tsx`: Game offers screen rendering exactly one card per match fixture, keyed by `challenge_id`.
  - `src/core/notifications/PushRegistrar.tsx`: Push listener and routing to `/teams/offers`.

## Feature Inventory
Every feature from the Survey phase is mapped and completed:
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | Geo-Targeted Challenge Notifications | Push notifications (`challenge_offer`) strictly target nearby captains within `ST_DWithin` radius | M1 | Survey / R1 | DONE |
| 2 | Notification Captain Deduplication | Captains owning multiple squads receive at most one notification per match fixture | M1 | Survey / R1 | DONE |
| 3 | Origin Location Fallback Hardening | Robust fallback to creator's home location if squad centroid is null | M1 | Survey / R1 | DONE |
| 4 | Global Match Discovery RPC | `nearby_matches` RPC supports nullable coords/radius and omits creator radius lockout | M1 | Survey / R2 | DONE |
| 5 | Global Open Fixtures Discovery RPC | `list_open_challenges_nearby` RPC supports nullable team size and radius | M1 | Survey / R2 | DONE |
| 6 | Decline Offer Cascade | Declining an offer cascades across all candidate rows owned by the user for that fixture | M1 | Survey / R3 | DONE |
| 7 | Non-blocking Match Query Hook | `useNearbyMatches` is unconditionally enabled; repository accepts nullable coords | M2 | Survey / R2 | DONE |
| 8 | Non-blocking Open Challenges Hook | `useNearbyOpenChallenges` and `challengeRepository` support browsing without team size | M2 | Survey / R2 | DONE |
| 9 | Repository Offer Deduplication | `challengeRepository.listMyOffers` deduplicates by `challenge_id` and filters non-open fixtures | M2 | Survey / R3 | DONE |
| 10 | Unblocked Games Tab Feed | `matches.tsx` renders matches even without GPS coordinates, with non-blocking notice | M3 | Survey / R2 | DONE |
| 11 | Unblocked Open Challenges Rail | `matches.tsx` renders open challenges for squad-less users with create-team guidance | M3 | Survey / R2 | DONE |
| 12 | "All" Distance Chip | `matches.tsx` allows browsing all distances / globally | M3 | Survey / R2 | DONE |
| 13 | Unblocked Home Feed Rails | `index.tsx` renders global matches and open challenges when coords or squads are absent | M3 | Survey / R2 | DONE |
| 14 | Single Offer Card per Fixture | `offers.tsx` uses `item.challenge_id` as keyExtractor and renders exactly 1 card per fixture | M3 | Survey / R3 | DONE |
| 15 | Push Notification Invalidation | `PushRegistrar.tsx` invalidates challenge queries on notification receipt | M3 | Survey / R1 | DONE |
| 16 | TypeScript Zero-Error Gate | Full project compiles with `npx tsc --noEmit` with 0 errors | M4 | Survey / Acceptance | DONE |
| 17 | Multi-Squad & Geospatial Verification | Verify notification filtering, offer deduplication, and discovery end-to-end | M4 | Survey / Acceptance | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Backend Migrations & Database RPCs | PostGIS geo-targeting, captain deduplication, global RPCs, decline cascade | none | DONE |
| 2 | Data Repositories & Hooks Layer | `matchRepository`, `challengeRepository`, `useMatches`, `useChallenges` | M1 | DONE |
| 3 | Presentation & UI Experience | `matches.tsx`, `index.tsx`, `offers.tsx`, `PushRegistrar.tsx` | M2 | DONE |
| 4 | Verification & Acceptance Gate | `npx tsc --noEmit`, test coverage, audit verification | M3 | DONE |

## Interface Contracts
### `public.nearby_matches`
- Parameters: `in_lat double precision default null, in_lng double precision default null, in_radius_m integer default null, in_sport text default null`
- Returns: `setof public.matches`
- Behavior: When coordinates or radius are null, returns all open matches sorted by `scheduled_at asc`. When coordinates and radius are provided, filters by `ST_DWithin` and sorts by distance.

### `public.list_open_challenges_nearby`
- Parameters: `in_lat double precision default null, in_lng double precision default null, in_radius_m integer default null, in_sport text default null, in_team_size integer default null`
- Returns: `table (...)`
- Behavior: When `in_team_size` is null, returns all open challenges without format restriction. When radius/coords are null, returns all open challenges globally.

### `public.rank_challenge_candidates`
- Parameters: `in_challenge_id uuid, in_radius_m integer default 25000, in_limit integer default 5`
- Returns: `table (team_id uuid, owner_id uuid, distance_m double precision, rank bigint)`
- Behavior: `DISTINCT ON (t.owner_id)` ensures at most one candidate team per captain within `ST_DWithin`.

### `challengeRepository.listMyOffers`
- Signature: `listMyOffers(): Promise<OpenOffer[]>`
- Behavior: Deduplicates raw candidate rows by `challenge_id`, prioritizing `'interested'` status over `'offered'`. Drops fixtures where `challenge.status !== 'open'`.

## Code Layout
- `supabase/migrations/`: Database schema, PostGIS functions, and RPCs.
- `src/features/matches/data/matchRepository.ts`: Matches data repository.
- `src/features/matches/presentation/useMatches.ts`: Matches query hooks.
- `src/features/teams/data/challengeRepository.ts`: Challenges and offers data repository.
- `src/features/teams/presentation/useChallenges.ts`: Challenges and offers query hooks.
- `app/(tabs)/matches.tsx`: Games tab screen.
- `app/(tabs)/index.tsx`: Home screen feed rails.
- `app/teams/offers.tsx`: Game offers screen.
- `src/core/notifications/PushRegistrar.tsx`: Push notification registration and handling.
