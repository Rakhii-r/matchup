# Survey Report: Global In-App Match Viewing (Requirement R2)

**Explorer**: Explorer 2 (Survey Phase)  
**Target Milestone**: Survey / Requirement R2 (Global In-App Match Discovery)  
**Date**: 2026-09-04  
**Workspace**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`

---

## 1. Observation

### 1.1 Match & Fixture Discovery Entry Points
1. **Games Tab / Matches Screen (`app/(tabs)/matches.tsx`)**:
   - Registered as tab route `matches` in `app/(tabs)/_layout.tsx` (lines 49–55) with title `'Games'`. Also aliased via top-level redirect `app/matches.tsx` (lines 1–9) which points to `/(tabs)/matches`. In documentation and user stories this is referred to as the Games tab, Matches tab, or Explore tab.
   - Component: `NearbyScreen` (`app/(tabs)/matches.tsx:207`).
   - Hooks invoked:
     - `useNearbyMatches(coords, sport, radiusM)` (`app/(tabs)/matches.tsx:265`) from `@features/matches/presentation/useMatches`.
     - `useNearbyOpenChallenges(coords, sport, radiusM, activeFormat.format)` (`app/(tabs)/matches.tsx:277`) from `@features/teams/presentation/useChallenges`.
     - `useActiveTeamFormat(sport)` (`app/(tabs)/matches.tsx:276`) from `@features/teams/presentation/useActiveTeamFormat`.
     - `useJoinedMatches()` (`app/(tabs)/matches.tsx:287`) from `@features/matches/presentation/useMatches`.
     - `useMyChallenges()` (`app/(tabs)/matches.tsx:214`) from `@features/teams/presentation/useChallenges`.
   - UI Sections rendered:
     - Title: "Games near you" (`app/(tabs)/matches.tsx:540–542`).
     - Sport Filter Rail (`app/(tabs)/matches.tsx:560–608`).
     - Search Distance Chips (`app/(tabs)/matches.tsx:610–632`): `SEARCH_RADII_M` = `[2000, 5000, 10000, 25000, 50000]`.
     - Live Radar Banner (`app/(tabs)/matches.tsx:661–689`).
     - Open Team Challenges Horizontal Rail (`app/(tabs)/matches.tsx:699–834`): displays `openChallenges.data` cards. Tapping card opens `MatchOfferDetailModal`.
     - Matches List (`app/(tabs)/matches.tsx:444–528`): displays `data` (`nearby.data`) with sport thumbnail, title, status badge, scheduled time, venue/area, slot progress, and join button. Tapping routes to `/match/[id]` or `/match/[id]/result`.

2. **Home Screen Feed (`app/(tabs)/index.tsx`)**:
   - Component: `HomeScreen` (`app/(tabs)/index.tsx:417`).
   - Hooks invoked:
     - `coords = profile?.home_lat != null && profile?.home_lng != null ? { lat: profile.home_lat, lng: profile.home_lng } : null;` (`app/(tabs)/index.tsx:426–429`).
     - `useNearbyMatches(coords, sport)` (`app/(tabs)/index.tsx:434`).
     - `useNearbyOpenChallenges(coords, sport, undefined, activeFormat.format)` (`app/(tabs)/index.tsx:445`).
   - UI Rails rendered:
     - "GAME OFFERS (LOOKING FOR OPPONENTS)" rail (`app/(tabs)/index.tsx:926–1065`): horizontal scroll of open challenge cards. "See All" button redirects to `/(tabs)/matches`.
     - "GAMES NEAR YOU" rail (`app/(tabs)/index.tsx:1068–1150`): horizontal scroll of match cards. "See All" button redirects to `/(tabs)/matches`.

3. **Match Detail Screen (`app/match/[id]/index.tsx`)**:
   - Fetches individual match details via `useMatch(matchId)` (`app/match/[id]/index.tsx:82`) calling `matchRepository.getById(matchId)` (`src/features/matches/data/matchRepository.ts:365–373`).
   - Fetches player roster via `useMatchPlayers(matchId)` (`app/match/[id]/index.tsx:83`) calling `matchRepository.listPlayers(matchId)` which invokes the `list_match_players` RPC.

---

### 1.2 Restrictive Filters & Barriers Currently Enforced

#### Barrier 1: Missing GPS / Location Coordinates Blocks Browsing
- **In `src/features/matches/presentation/useMatches.ts:214`**:
  ```ts
  export function useNearbyMatches(
    coords: Coords | null,
    sport: Sport | null,
    radiusM: number = DEFAULT_SEARCH_RADIUS_M,
  ) {
    return useQuery({
      queryKey: [
        'matches',
        'nearby',
        coords?.lat ?? 0,
        coords?.lng ?? 0,
        sport ?? 'all',
        radiusM,
      ] as const,
      queryFn: () =>
        matchRepository.nearby({
          lat: (coords as Coords).lat,
          lng: (coords as Coords).lng,
          radiusM,
          sport,
        }),
      enabled: coords != null,
    });
  }
  ```
  `enabled: coords != null` prevents the query from running if the device has not acquired GPS coordinates or permission is denied.
- **In `app/(tabs)/matches.tsx:846–851`**:
  ```tsx
  ) : !coords ? (
    <View style={styles.notice}>
      <AppText color={M.muted} center>
        Turn on location to see games near you. You can still create or join with a code.
      </AppText>
    </View>
  )
  ```
  If `coords == null`, the Games tab completely blocks rendering the match list and presents only a static notice.
- **In `app/(tabs)/index.tsx:1075–1095`**:
  If `coords == null`, the Home screen replaces the match rail with a placeholder card: *"No location saved. Capture your location once and nearby games appear here."*

#### Barrier 2: Geospatial `ST_DWithin` & Creator `search_radius_m` Restrictions
- **In `supabase/migrations/20260818090000_open_matches.sql:478–509` (`nearby_matches` RPC)**:
  ```sql
  create or replace function public.nearby_matches(
    in_lat      double precision,
    in_lng      double precision,
    in_radius_m integer default 5000,
    in_sport    text default null
  )
  returns setof public.matches
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select m.*
    from public.matches m
    where m.status = 'open'
      and m.scheduled_at > now() - interval '6 hours'
      and (in_sport is null or m.sport = in_sport)
      and ST_DWithin(
            m.location,
            ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
            in_radius_m)
      and (
        m.search_radius_m is null
        or ST_DWithin(
             m.location,
             ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
             m.search_radius_m)
      )
      and not public.is_blocked_between(auth.uid(), m.creator_id)
    order by m.location <-> ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
    limit 50;
  $$;
  ```
  - `in_lat` and `in_lng` are non-optional `double precision`. Passing `null` fails `ST_MakePoint(in_lng, in_lat)` or returns empty results.
  - `ST_DWithin(m.location, ..., in_radius_m)` strictly drops all open matches outside the viewer's current radius chip (default 5 km, max 50 km).
  - `m.search_radius_m` drops the match if the viewer is outside the creator's designated creation radius, even if the viewer chooses 50 km or wants to browse globally.
  - `SEARCH_RADII_M` in `src/features/matches/presentation/useMatches.ts:184` has options `[2000, 5000, 10000, 25000, 50000]`. There is no "All / Global" option.

#### Barrier 3: Squad Ownership & Format Lock on Open Challenges
- **In `src/features/teams/presentation/useActiveTeamFormat.ts:53–55`**:
  ```ts
  if (owned.length === 0) {
    return { format: null, teamId: null, teamName: null, ownedTeams: owned, reason: 'no_team', isLoading: false };
  }
  ```
  If a user does not own a team for that sport, `format` is `null` and `reason` is `'no_team'`.
- **In `src/features/teams/presentation/useChallenges.ts:271` (`useNearbyOpenChallenges`)**:
  ```ts
  enabled: teamSize != null,
  ```
  If the user does not own a squad, `teamSize` is null and this query is disabled.
- **In `src/features/teams/data/challengeRepository.ts:227`**:
  ```ts
  if (input?.teamSize == null) return [];
  ```
  Hardcoded client-side early return: returns `[]` without even querying the backend.
- **In `supabase/migrations/20260903090000_squad_only_matchmaking.sql:288–290, 344` (`list_open_challenges_nearby` RPC)**:
  ```sql
  if in_team_size is null then
    return;
  end if;
  ...
  and public.challenge_format(r.total_slots) = in_team_size
  ```
  Backend RPC immediately exits with empty set if `in_team_size` is null, and strictly excludes all fixtures whose format does not match `in_team_size`.
- **In `app/(tabs)/matches.tsx:699`**:
  ```tsx
  {activeFormat.reason === 'no_team' ? null : ...}
  ```
  If `activeFormat.reason === 'no_team'`, the entire open challenges UI section is completely suppressed (`null`).
- **In `app/(tabs)/index.tsx:937–947`**:
  If `activeFormat.reason === 'no_team'`, the Home feed suppresses open offers and displays a blocking card: *"Create a team to see opponents. Fixtures are squad against squad..."*.

#### Barrier 4: Self-Ownership & Membership Exclusion on Challenges
- In `list_open_challenges_nearby` (`20260903090000_squad_only_matchmaking.sql:346–350`):
  ```sql
  and r.t_owner <> coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid)
  and not exists (
    select 1 from public.team_members tm
     where tm.team_id = r.from_team_id and tm.user_id = v_uid
  )
  ```
  The host team's captain and members cannot see their own fixture in the open challenges list.

---

## 2. Logic Chain

1. **Premise 1 (Requirement R1 vs R2 Distinction)**:
   - Requirement R1 specifies that push notifications / popups (`challenge_offer`) must strictly target nearby captains within the designated play zone radius (`ST_DWithin(team_location, origin_location, radius_m)`).
   - Requirement R2 specifies that matches and open fixtures in the app feed / Games tab must be discoverable and viewable by all users across the app without restricting browse visibility.
   - Therefore, geospatial radius gating (`ST_DWithin`) belongs in the notification enqueueing logic, NOT as an insurmountable barrier in public in-app browsing.

2. **Premise 2 (Database RLS Supports Global Reading)**:
   - As observed in `supabase/migrations/20260803123152_security_hardening.sql:128–136`:
     The RLS policy on `public.matches` (`matches_select`) already allows ANY authenticated user to read all matches where `status = 'open'`:
     `using (not public.is_blocked_between(auth.uid(), creator_id) and (status = 'open' or creator_id = auth.uid() or is_match_player(...)))`.
   - The restriction preventing global viewing comes strictly from the `nearby_matches` RPC parameters and queries, plus the frontend hooks gating on `coords != null`.

3. **Premise 3 (Location Availability & Empty State)**:
   - Many users browse the app without GPS permissions granted, or when location services are turned off, or while in an area with zero matches within 5 km.
   - Currently, `coords == null` causes `useNearbyMatches` to be disabled (`enabled: false`) and `app/(tabs)/matches.tsx` renders a blocking notice instead of games.
   - Therefore, `useNearbyMatches` must execute even when `coords == null` (fetching all open matches globally, sorted by `scheduled_at asc`), and `app/(tabs)/matches.tsx` must render the match cards instead of blocking on `!coords`.

4. **Premise 4 (Creator Radius `m.search_radius_m` Conflict)**:
   - In `nearby_matches` RPC (`20260818090000_open_matches.sql:501–505`), `m.search_radius_m` is evaluated against the viewer's location. If the creator chose 5 km, a viewer 6 km away cannot browse or discover the match even if the viewer chooses 50 km or all.
   - This directly restricts browse visibility. For in-app browsing, `m.search_radius_m` should not hide the match from public viewing.

5. **Premise 5 (Open Fixture Discovery Without a Squad)**:
   - A player who does not own a squad (`reason: 'no_team'`) is currently completely locked out of seeing open fixtures (`openChallenges`) in both `app/(tabs)/matches.tsx` and `app/(tabs)/index.tsx`.
   - However, in-app discovery should allow all players to browse what teams are looking for games, check team stats via `MatchOfferDetailModal`, and view open fixtures.
   - Gating should only occur on the write mutation (`onChallengeTeam`): if a user taps "Challenge Team" without a squad, prompt them to create a squad.

---

## 3. Caveats

1. **Performance & Pagination**:
   - `nearby_matches` currently limits to 50 rows (`limit 50`). When browsing globally without a radius filter, returning the earliest upcoming 50 open matches (`order by scheduled_at asc limit 50`) prevents large payload overhead.
2. **Sorting Strategy**:
   - When coordinates are present, sorting by distance (`m.location <-> user_loc asc`) places local games at the top of the feed while still allowing distant games to be discovered further down. When coordinates are absent (`coords == null`), sorting by `scheduled_at asc` provides a clean chronological schedule.
3. **No Code Modification During Survey**:
   - In accordance with the Explorer protocol, no modifications were made to the codebase during this survey. Proposed edits are documented below.

---

## 4. Conclusion & Recommendations

To deliver **Global In-App Match Viewing (Requirement R2)** across the MatchUp app and backend:

### 4.1 Backend RPC Recommendations (`supabase/migrations/`)
Create a new migration (e.g., `20260904130000_global_in_app_match_viewing.sql`):
1. **Redefine `public.nearby_matches`**:
   - Make `in_lat` and `in_lng` optional (`default null`), and `in_radius_m` optional (`default null`).
   - If `in_lat is not null and in_lng is not null and in_radius_m is not null and in_radius_m > 0`:
     - Apply `ST_DWithin(m.location, user_loc, in_radius_m)` when the user explicitly selects a distance filter.
     - OMIT `m.search_radius_m` from in-app feed queries so creator play zones do not hide matches from public discovery.
     - Order by `m.location <-> user_loc asc, m.scheduled_at asc`.
   - If `in_lat is null or in_lng is null or in_radius_m is null`:
     - Do NOT filter by distance. Return all open matches (`where m.status = 'open' and m.scheduled_at > now() - interval '6 hours'`).
     - Order by `m.scheduled_at asc`.
   - Keep `limit 50`.
2. **Redefine `public.list_open_challenges_nearby`**:
   - Make `in_team_size` optional (`default null`). Remove `if in_team_size is null then return; end if;`.
   - Change format clause to `(in_team_size is null or public.challenge_format(r.total_slots) = in_team_size)`.
   - Make radius filter optional: `(in_radius_m is null or in_radius_m <= 0 or v_user_loc is null or r.loc is null or ST_DWithin(v_user_loc, r.loc, in_radius_m))`.
   - This allows any user (with or without a team) to browse open fixtures globally.

### 4.2 Data Layer & Hook Recommendations
1. **`src/features/matches/data/matchRepository.ts`**:
   - In `matchRepository.nearby`, update the parameter signature to allow `lat?: number | null`, `lng?: number | null`, `radiusM?: number | null`. Pass `in_lat: input.lat ?? null`, `in_lng: input.lng ?? null`, `in_radius_m: input.radiusM ?? null`.
2. **`src/features/matches/presentation/useMatches.ts`**:
   - In `useNearbyMatches`: remove `enabled: coords != null`. Make it unconditionally `enabled: true`.
   - In `SEARCH_RADII_M`: add an `"All"` / global option (e.g. `null` or `0` with `formatRadius` mapping to `"All"` / `"Everywhere"`).
3. **`src/features/teams/data/challengeRepository.ts`**:
   - In `challengeRepository.listNearbyOpenChallenges`: remove `if (input?.teamSize == null) return [];`. Allow `teamSize` to be optional/null.
4. **`src/features/teams/presentation/useChallenges.ts`**:
   - In `useNearbyOpenChallenges`: remove `enabled: teamSize != null`. Make it unconditionally `enabled: true`.

### 4.3 UI Presentation Recommendations
1. **Games Tab Screen (`app/(tabs)/matches.tsx`)**:
   - Replace the blocking `!coords` notice (`lines 846–851`) with a non-blocking informational chip/banner in the list header (e.g., *"Showing all games • Enable location to sort by distance"*). Match cards render regardless of location status.
   - In open challenges section (`lines 699–740`), remove `{activeFormat.reason === 'no_team' ? null : ...}`. Render the open challenges carousel for all users.
   - When a user without a squad taps "⚡ Challenge Team", display an alert/sheet guiding them to create a squad (`/teams/create`), while still allowing them to tap the card and view the full fixture details in `MatchOfferDetailModal`.
   - Add an `"All"` chip to the search distance row.
2. **Home Screen Feed (`app/(tabs)/index.tsx`)**:
   - In "GAMES NEAR YOU" (`lines 1075–1095`), when `!coords`, fetch and render open games globally instead of rendering the blocking *"No location saved"* card.
   - In "GAME OFFERS" (`lines 937–947`), when `activeFormat.reason === 'no_team'`, render the open challenge offers cards rather than the blocking placeholder.

---

## 5. Verification Method

### 5.1 Manual UI Verification Steps
1. **No-Location Match Discovery**:
   - Launch app with location services disabled or location permissions set to "Never".
   - Open the "Games" tab (`app/(tabs)/matches.tsx`).
   - Verify that open matches are fetched and displayed in the feed rather than showing the blocking "Turn on location" notice.
2. **Global Distance Browsing**:
   - Create a match with a specific location in City A.
   - On another account located in City B (> 50 km away), open the Games tab.
   - Select the "All" distance chip (or verify global feed).
   - Verify that the match in City A appears in the feed and can be tapped to view details (`/match/[id]`).
3. **Squad-Less Fixture Discovery**:
   - Log in with a user who owns no squads.
   - Open the "Games" tab and the "Home" tab.
   - Verify that the "TEAMS LOOKING FOR OPPONENTS" / "GAME OFFERS" section displays open fixtures.
   - Tap a fixture card and verify that `MatchOfferDetailModal` opens with venue, time, and team stats.
   - Tap "Challenge Team" and verify that a helpful prompt directs the user to create a squad.

### 5.2 Code & TypeScript Verification
- Run TypeScript compiler check:
  ```powershell
  npx tsc --noEmit
  ```
  Must compile with 0 errors.
- Ensure all repository methods, hooks, and schemas conform to the updated nullable/optional signatures.
