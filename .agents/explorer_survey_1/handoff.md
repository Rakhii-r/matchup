# Handoff Report: Explorer 1 (Survey: Geo-Targeted Notifications & Deduplication)

## Executive Summary
This investigation analyzes Requirement R1: Geo-Targeted Notifications (`ST_DWithin`) and User Deduplication for push notifications (`challenge_offer`). It maps out the exact creation entry points, PostGIS geospatial targeting mechanics, database tables/columns, the push notification pipeline (Postgres queue → pg_net → `notify-wave` Edge Function → Expo Push API), and the multi-tier deduplication mechanisms ensuring captains owning multiple squads receive at most one notification per match fixture.

---

## 1. Observation

### 1.1 Where Games/Fixtures are Created and Challenges are Posted
Direct codebase inspection reveals two distinct creation pathways in the application:

1. **Frontend Creation Wizard (`app/match/create/details.tsx`)**:
   - Lines 10–27:
     ```typescript
     * TWO CREATION ENGINES, and the match type picks one.
     * Team Vs Team (Challenge)
     *   Team A picker ... submit through `usePostOpenChallenge` → `post_open_challenge`,
     *   then the radar at `create/searching`. Team B is never picked by hand: the
     *   opponent is whichever nearby team accepts.
     * Post a Match (Open for all)
     *   No Team A, no Team B, no opponent ... Submit through `useCreateOpenMatch` →
     *   `create_open_match`, which also seats the organiser as the host...
     ```
   - Lines 142–144:
     ```typescript
     const post = usePostOpenChallenge(teamId ?? '');
     const createOpen = useCreateOpenMatch();
     ```
   - Lines 324–345: Post a Match calls `createOpen.mutateAsync(...)` which invokes `supabase.rpc('create_open_match', ...)` in `src/features/matches/data/matchRepository.ts:281`. It creates an individual public lobby in `public.matches` and confirms the creator as player (`public.match_players`). It does NOT trigger challenge offers.
   - Lines 368–379: Team vs Team calls `post.mutateAsync(...)` which invokes `supabase.rpc('post_open_challenge', ...)` in `src/features/teams/data/challengeRepository.ts:175`.

2. **Frontend Direct Challenge (`app/teams/challenge.tsx`)**:
   - Calls `useCreateChallenge(fromTeamId)` (`src/features/teams/presentation/useChallenges.ts:50`) which calls `supabase.rpc('create_challenge', ...)` (`src/features/teams/data/challengeRepository.ts:130`). This is a directed invite to a specific team by invite code, triggering `challenge_received` rather than `challenge_offer`.

3. **Database Challenge Posting RPC (`supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql`)**:
   - Lines 101–114:
     ```sql
     create or replace function public.post_open_challenge(
       in_from_team_id uuid,
       in_match_name text,
       in_area_name text,
       in_scheduled_at timestamptz,
       in_total_slots integer,
       in_message text default null,
       in_radius_m integer default 25000,
       in_game_type text default 'friendly',
       in_end_time timestamptz default null,
       in_lat double precision default null,
       in_lng double precision default null,
       in_venue_id uuid default null
     )
     returns public.team_challenges
     ```

---

### 1.2 Where Push Notifications (`challenge_offer`) are Sent
Direct observation of all occurrences of `challenge_offer`:

1. **Enqueueing in `post_open_challenge`** (`supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:187–211`):
   ```sql
   -- Rank & offer to nearby teams (deduplicated per team owner)
   for v_cand in
     select * from public.rank_challenge_candidates(v_row.id, in_radius_m, 5)
   loop
     insert into public.challenge_candidates (challenge_id, team_id, rank, distance_m, status)
     values (v_row.id, v_cand.team_id, v_cand.rank, v_cand.distance_m, 'offered')
     on conflict (challenge_id, team_id) do update set
       status = 'offered',
       rank = v_cand.rank,
       distance_m = v_cand.distance_m;

     select owner_id into v_owner_id from public.teams where id = v_cand.team_id;

     -- Enqueue notification strictly once per distinct user/owner
     if v_owner_id is not null and not (v_owner_id = any(v_notified_users)) then
       v_notified_users := array_append(v_notified_users, v_owner_id);

       perform public.enqueue_notification(
         v_owner_id,
         'challenge_offer',
         'Match offer',
         v_from.name || ' wants a game. Tap to accept.',
         jsonb_build_object('route', '/teams/offers', 'challenge_id', v_row.id)
       );
     end if;
   end loop;
   ```

2. **Preference Filtering & Outbound Job Queue (`supabase/migrations/20260831174915_notification_preferences.sql`)**:
   - Lines 19: `when 'challenge_offer' then 'challenges'`
   - Lines 44–50:
     ```sql
     select (p.notif_prefs -> public.notif_group(in_kind)) = 'false'::jsonb
       into v_muted from public.profiles p where p.id = in_user_id;
     if coalesce(v_muted, false) then
       return;
     end if;
     insert into public.notification_jobs (user_id, kind, title, body, data)
     values (in_user_id, in_kind, in_title, in_body, coalesce(in_data, '{}'::jsonb));
     ```

3. **Dispatch to Push Service (`notify-wave` Edge Function & pg_cron)**:
   - `supabase/migrations/20260808084324_push_notifications.sql:433–442`: Scheduled cron job `notify-wave-dispatch` runs every minute via `pg_net` to call `https://<project>.supabase.co/functions/v1/notify-wave`.
   - `supabase/functions/notify-wave/index.ts:21–33`: Drains `public.notification_jobs` in batches of 100 via `claim_notification_jobs()`, resolves push tokens from `public.devices`, and posts to Expo Push API (`https://exp.host/--/api/v2/push/send`).

4. **Client-Side Notification Handling & Routing**:
   - `src/core/notifications/pushNotifications.ts:63–70`: Sets foreground notification presentation options:
     ```typescript
     mod.setNotificationHandler({
       handleNotification: async () => ({
         shouldShowBanner: true,
         shouldShowList: true,
         shouldPlaySound: true,
         shouldSetBadge: false,
       }),
     });
     ```
   - `src/core/notifications/PushRegistrar.tsx:76–79`: Listens for tap responses via `mod.addNotificationResponseReceivedListener` and routes using `routeFromNotification(response)`. For `challenge_offer`, `data.route` is `/teams/offers`.

---

### 1.3 PostGIS Availability, `ST_DWithin` Usage, and Exact Table/Column Names

1. **PostGIS Extension**:
   - `supabase/migrations/20260627063252_phase1_schema.sql:7`:
     `create extension if not exists postgis;`

2. **Exact Tables and Spatial Columns**:
   - **`public.profiles`**:
     - `id uuid primary key references auth.users(id)`
     - `home_lat double precision`, `home_lng double precision`
     - `home_location geography(Point, 4326) generated always as (case when home_lat is not null and home_lng is not null then ST_SetSRID(ST_MakePoint(home_lng, home_lat), 4326)::geography else null end) stored` (`20260627063252_phase1_schema.sql:32–39`)
     - Index: `create index profiles_home_location_gix on public.profiles using gist (home_location);` (`line 49`)
     - `notif_prefs jsonb not null default '{}'::jsonb` (`20260831174915_notification_preferences.sql:5–6`)
     - `is_active boolean not null default true`
   - **`public.venues`**:
     - `id uuid primary key`
     - `lat double precision not null`, `lng double precision not null`
     - `location geography(Point, 4326) generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored` (`20260627063252_phase1_schema.sql:60–61`)
     - Index: `create index venues_location_gix on public.venues using gist (location);` (`line 68`)
   - **`public.teams`** (squads table):
     - `id uuid primary key`
     - `name text not null`
     - `sport text not null` ('box_cricket' | 'badminton')
     - `owner_id uuid not null references public.profiles(id)` (the team captain)
     - `target_size integer` (squad format: players per side, 2..20)
     - Note: `teams` has NO direct location column; squad location is dynamic.
   - **`public.team_members`**:
     - `team_id uuid references public.teams(id)`
     - `user_id uuid references public.profiles(id)`
     - `role text` ('owner' | 'member')
   - **`public.team_challenges`**:
     - `id uuid primary key`
     - `from_team_id uuid not null references public.teams(id)`
     - `to_team_id uuid references public.teams(id)` (null for open challenges)
     - `created_by uuid not null references public.profiles(id)`
     - `venue_id uuid references public.venues(id)`
     - `match_lat double precision`, `match_lng double precision`
     - `search_radius_m integer default 25000`
     - `status text` ('open', 'pending', 'accepted', 'declined', 'cancelled')
     - `scheduled_at timestamptz not null`
     - `total_slots integer not null`
   - **`public.challenge_candidates`**:
     - `id uuid primary key`
     - `challenge_id uuid references public.team_challenges(id)`
     - `team_id uuid references public.teams(id)`
     - `rank integer not null`, `distance_m double precision not null`
     - `status text` ('offered', 'accepted', 'expired', 'interested')

3. **Dynamic Squad Location: `public.team_location(p_team_id uuid)`**:
   - `supabase/migrations/20260813133002_open_challenges.sql:157–170`:
     ```sql
     create or replace function public.team_location(p_team_id uuid)
     returns geography language sql stable security definer set search_path = public as $$
       select ST_Centroid(ST_Collect(p.home_location::geometry))::geography
         from public.team_members tm
         join public.profiles p on p.id = tm.user_id
        where tm.team_id = p_team_id
          and p.home_location is not null
          and p.is_active;
     $$;
     ```

4. **Origin Location Resolution (`origin_location`)**:
   - In `rank_challenge_candidates` (`supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:33–39`):
     ```sql
     coalesce(
       v.location,
       case when ch.match_lng is not null and ch.match_lat is not null
            then ST_SetSRID(ST_MakePoint(ch.match_lng, ch.match_lat), 4326)::geography
            else public.team_location(ch.from_team_id)
       end
     ) as origin_location
     ```

5. **`ST_DWithin` Query Formulation**:
   - `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:73`:
     ```sql
     and ST_DWithin(tl.loc, c.origin_location, in_radius_m)
     ```
   - Because `tl.loc` and `c.origin_location` are both `geography(Point, 4326)`, PostGIS evaluates distances over the spheroid in **meters**. `in_radius_m` (default 25000 = 25 km) is evaluated directly against distance in meters.

---

### 1.4 Captain Association and Deduplication Mechanics

1. **Captain Association**:
   - In MatchUp, a team's captain is stored on `public.teams.owner_id` (referencing `public.profiles.id`), with a corresponding entry in `public.team_members` having `role = 'owner'`.
   - A single user/captain can own multiple squads for the same sport and format.

2. **Deduplication Tier 1: Candidate Selection (`rank_challenge_candidates`)**:
   - `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:47–86`:
     ```sql
     select distinct on (t.owner_id)
            t.id as team_id,
            t.owner_id,
            ST_Distance(tl.loc, c.origin_location) as distance_m
       from public.teams t
       cross join c
       join lateral (select public.team_location(t.id) as loc) tl on tl.loc is not null
      where ...
        and ST_DWithin(tl.loc, c.origin_location, in_radius_m)
        ...
      order by t.owner_id, ST_Distance(tl.loc, c.origin_location) asc
     ```
   - `DISTINCT ON (t.owner_id)` groups all eligible teams by the captain's user ID and selects the single closest team per captain.

3. **Deduplication Tier 2: Notification Dispatch (`post_open_challenge`)**:
   - `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:127, 200–210`:
     ```sql
     v_notified_users uuid[] := '{}';
     ...
     select owner_id into v_owner_id from public.teams where id = v_cand.team_id;
     if v_owner_id is not null and not (v_owner_id = any(v_notified_users)) then
       v_notified_users := array_append(v_notified_users, v_owner_id);
       perform public.enqueue_notification(v_owner_id, 'challenge_offer', ...);
     end if;
     ```
   - Even if multiple candidate entries were returned, `v_notified_users` acts as an in-memory set preventing more than one `challenge_offer` push from being enqueued per captain.

4. **Deduplication Tier 3: Repository & Client Screen (`listMyOffers`)**:
   - `src/features/teams/data/challengeRepository.ts:296–308`:
     ```typescript
     const rawOffers = (data ?? []) as unknown as OpenOffer[];
     const dedupedMap = new Map<string, OpenOffer>();
     for (const offer of rawOffers) {
       if (!offer.challenge_id) continue;
       const existing = dedupedMap.get(offer.challenge_id);
       if (!existing) {
         dedupedMap.set(offer.challenge_id, offer);
       } else if (existing.status !== 'interested' && offer.status === 'interested') {
         dedupedMap.set(offer.challenge_id, offer);
       }
     }
     return Array.from(dedupedMap.values());
     ```
   - `app/teams/offers.tsx:347–360`: Secondary client-side memoized deduplication `dedupedIncomingOffers` on `challenge_id`.

---

## 2. Logic Chain

1. **Premise 1 (Notification Source)**: Per requirement R1, notifications must target captains when a challenge is posted. In the codebase, `app/match/create/details.tsx` posts challenges via `usePostOpenChallenge` → `challengeRepository.postOpen` → `post_open_challenge`. No other entry point creates open challenge offers.
2. **Premise 2 (Recipient Determination)**: `post_open_challenge` delegates the selection of recipient teams to `rank_challenge_candidates(v_row.id, in_radius_m, 5)`.
3. **Premise 3 (Geospatial Targeting)**: PostGIS is enabled (`20260627063252_phase1_schema.sql:7`). Locations are represented as `geography(Point, 4326)`. In `rank_challenge_candidates`:
   - Origin is derived in order: `venue.location` → `ST_SetSRID(ST_MakePoint(match_lng, match_lat), 4326)::geography` → `team_location(from_team_id)`.
   - Candidate team location is dynamically computed as the centroid of its active members' home locations (`public.team_location(t.id)`).
   - `ST_DWithin(tl.loc, c.origin_location, in_radius_m)` strictly restricts candidates to those within `in_radius_m` meters.
4. **Premise 4 (User Deduplication at DB Level)**:
   - When a captain owns multiple squads (e.g. Squad A and Squad B), both might fall within `in_radius_m`.
   - `rank_challenge_candidates` applies `SELECT DISTINCT ON (t.owner_id) ... ORDER BY t.owner_id, ST_Distance(tl.loc, c.origin_location) asc`. For each captain (`owner_id`), only the closest squad is selected.
   - In `post_open_challenge`, the `v_notified_users uuid[]` tracking array enforces that `enqueue_notification` is called strictly once per unique `owner_id`.
5. **Premise 5 (Pipeline Integrity)**: `enqueue_notification` writes to `public.notification_jobs`, which `notify-wave` drains and sends to the Expo Push API. The push payload contains `data: { route: '/teams/offers', challenge_id: ... }`. When tapped, `PushRegistrar.tsx` routes to `/teams/offers`.

---

## 3. Caveats

1. **Origin Location Fallback**: If a challenge has no `venue_id`, no `match_lat`/`match_lng`, AND none of the posting team's members have set a `home_location`, `origin_location` evaluates to NULL. When `origin_location` is NULL, `ST_DWithin` returns NULL, and 0 candidates are ranked. (Recommendation documented below).
2. **Null Radius Handling**: If `in_radius_m` is explicitly passed as `NULL` to `rank_challenge_candidates`, `ST_DWithin(..., NULL)` returns NULL. Wrapping with `coalesce(in_radius_m, 25000)` prevents accidental zero-matches.
3. **Multi-device Captains**: Deduplication is keyed by user ID (`profiles.id`). If a captain has registered multiple physical devices, `notify-wave` will send the push to all registered devices of that single captain, which is expected standard push behavior.
4. **Offline / Expo Go**: In Expo Go or iOS/Android simulators, native push notifications are unavailable by Expo SDK 53 design. The application handles this without crashing via `loadNotifications()` in `pushNotifications.ts`.

---

## 4. Conclusion

The system architecture for Requirement R1 (Geo-Targeted Notifications and User Deduplication) is comprehensively defined across the database migration `20260904124000_deduplicate_offers_and_notifications_per_user.sql`, the notification queue system (`enqueue_notification` + `notify-wave`), and the client frontend (`app/match/create/details.tsx`, `PushRegistrar.tsx`, and `app/teams/offers.tsx`).

### Summary Table of Findings

| Dimension | Implementation Details | Exact File Reference |
|---|---|---|
| **Challenge Creation** | `usePostOpenChallenge` → `challengeRepository.postOpen` → `post_open_challenge` RPC | `app/match/create/details.tsx:368`, `challengeRepository.ts:175`, `20260904124000_...sql:101` |
| **Notification Type** | `challenge_offer` (group `'challenges'`) | `20260831174915_...sql:19`, `20260904124000_...sql:205` |
| **Play Zone Targeting** | PostGIS `ST_DWithin(tl.loc, c.origin_location, in_radius_m)` on `geography(Point, 4326)` | `20260904124000_...sql:73` |
| **Squad Location** | `ST_Centroid(ST_Collect(p.home_location::geometry))::geography` | `20260813133002_...sql:164` |
| **Captain Association** | `public.teams.owner_id` references `public.profiles(id)` | `20260805051906_teams.sql:21` |
| **DB Ranking Deduplication** | `DISTINCT ON (t.owner_id) ... ORDER BY t.owner_id, ST_Distance(...) asc` | `20260904124000_...sql:47–85` |
| **DB Notification Deduplication**| `v_notified_users uuid[]` tracking array in `post_open_challenge` | `20260904124000_...sql:127, 200–210` |
| **Client UI Deduplication** | `dedupedMap` in `listMyOffers()` and `dedupedIncomingOffers` in `offers.tsx` | `challengeRepository.ts:298`, `app/teams/offers.tsx:347` |
| **Push Dispatch Pipeline** | `notification_jobs` table → `pg_net` cron → `notify-wave` edge function → Expo Push API | `20260808084324_...sql`, `supabase/functions/notify-wave/index.ts` |

### Concrete Recommendations for Implementation Team
1. **Migration Verification**: Verify that migration `20260904124000_deduplicate_offers_and_notifications_per_user.sql` is applied to the Supabase target database.
2. **Robust Fallback for Origin Location**: In `rank_challenge_candidates`, add fallback to creator's home location if `team_location(ch.from_team_id)` is null:
   ```sql
   coalesce(
     v.location,
     case when ch.match_lng is not null and ch.match_lat is not null
          then ST_SetSRID(ST_MakePoint(ch.match_lng, ch.match_lat), 4326)::geography
          else coalesce(
            public.team_location(ch.from_team_id),
            (select p.home_location from public.profiles p where p.id = ch.created_by)
          )
     end
   ) as origin_location
   ```
3. **Safe Coalesce on Radius**: In `rank_challenge_candidates`, replace `in_radius_m` with `coalesce(in_radius_m, 25000)` in `ST_DWithin`.
4. **Push Invalidation on Client**: In `src/core/notifications/PushRegistrar.tsx:83–90`, add `void queryClient.invalidateQueries({ queryKey: ['challenges'] });` inside `mod.addNotificationReceivedListener` so foreground notifications immediately refresh offer lists.

---

## 5. Verification Method

To independently verify the implementation:

1. **SQL Spatial & Deduplication Verification**:
   Run the following query pattern against a test Postgres instance with PostGIS:
   ```sql
   -- Create poster user & team
   -- Create recipient captain with 2 teams (Team B1 at 2km, Team B2 at 5km)
   -- Post open challenge with radius 10000m
   -- Verify rank_challenge_candidates returns ONLY Team B1 (closest) and exactly 1 candidate for that owner
   -- Verify notification_jobs contains exactly 1 row for that captain's user_id with kind 'challenge_offer'
   ```
   Reference test suite: `supabase/tests/open_challenges_test.sql:80–118`.

2. **TypeScript Compilation**:
   Run:
   ```bash
   npx tsc --noEmit
   ```
   Ensures zero compilation or type mismatch errors across `src/shared/types/database.types.ts`, `challengeRepository.ts`, and `app/match/create/details.tsx`.

3. **Database Schema & Grants Check**:
   Inspect `pg_proc` to verify `rank_challenge_candidates` and `post_open_challenge` have permissions granted to `authenticated`:
   ```sql
   select routine_name, routine_type from information_schema.routines
   where routine_name in ('rank_challenge_candidates', 'post_open_challenge');
   ```
