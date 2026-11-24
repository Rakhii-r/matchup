# Survey Report: User-Level Match Offers Deduplication (Requirement R3)

**Explorer**: Explorer 3 (Survey Phase)  
**Target Milestone**: Survey / Requirement R3 (User-Level Match Offers Deduplication)  
**Date**: 2026-09-04  
**Workspace**: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`  

---

## 1. Observation

### 1.1 "Game Offers" Screen Implementation & Entry Points
1. **Screen Implementation (`app/teams/offers.tsx`)**:
   - File: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\app\teams\offers.tsx` (986 lines).
   - Component: `OffersScreen` (`app/teams/offers.tsx:299–868`).
   - Route: `/teams/offers`.
   - Screen Title: `<Stack.Screen options={{ title: 'Game offers' }} />` (`app/teams/offers.tsx:775`).
   - Two Operational Modes:
     - **INCOMING Mode** (`outgoing = false`, when `challengeId == null`):
       - Triggered when opening Game Offers without URL query parameters (default view).
       - Displays fixtures posted by opponent teams that were offered to squads belonging to the logged-in user.
       - Data source: `offers = useMyOffers()` (`app/teams/offers.tsx:308`).
       - Deduplicated list: `dedupedIncomingOffers` (`app/teams/offers.tsx:347–360`).
       - FlatList rendering: lines 844–862 with `renderIncoming` (`app/teams/offers.tsx:492–655`).
     - **OUTGOING Mode** (`outgoing = true`, when `?challengeId=` is passed):
       - Triggered by host captain reviewing who their posted fixture reached (e.g. from Live Radar dish).
       - Data source: `candidates = useChallengeCandidatesFull(challengeId)` (`app/teams/offers.tsx:311`).
       - Filtered list: `filteredCandidates` (`app/teams/offers.tsx:340–344`), which strips any squads owned by the user.
       - FlatList rendering: lines 793–842 with `renderCandidate` (`app/teams/offers.tsx:657–762`).

2. **Navigation Entry Points**:
   - **Teams Tab (`app/(tabs)/teams.tsx:154–164`)**:
     - Action button labeled `"Game offers"`:
       ```tsx
       <Pressable
         style={styles.ctaGhost}
         onPress={() => router.push('/teams/offers')}
         accessibilityRole="button"
         accessibilityLabel="Game offers"
       >
         <AppText variant="caption" color={M.text}>Game offers</AppText>
       </Pressable>
       ```
   - **Match Search Screen (`app/match/create/searching.tsx:1102–1110`)**:
     - Section link:
       ```tsx
       <Pressable
         onPress={() => router.push('/teams/offers')}
         accessibilityRole="button"
         accessibilityLabel="View all game offers"
       >
         <AppText variant="caption" color={M.green} style={{ fontWeight: '700' }}>
           View All Offers ({myOffers.data?.length ?? 0}) →
         </AppText>
       </Pressable>
       ```
   - **Push Notification Route**:
     - When `post_open_challenge` enqueues a `challenge_offer` notification (`supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:208`), its payload routes directly to `/teams/offers`:
       `jsonb_build_object('route', '/teams/offers', 'challenge_id', v_row.id)`

---

### 1.2 Data Retrieval & Backend Queries for Challenge Offers

1. **Presentation Layer Hook (`src/features/teams/presentation/useChallenges.ts:134–141`)**:
   ```ts
   /** Fixtures offered to my teams, still unanswered. Drives the Offers screen. */
   export function useMyOffers() {
     const userId = useAuthStore((s) => s.session?.user.id);
     return useQuery({
       queryKey: ['challenges', 'offers', userId ?? 'anon'] as const,
       queryFn: () => challengeRepository.listMyOffers(),
       enabled: Boolean(userId),
     });
   }
   ```

2. **Data Repository Query (`src/features/teams/data/challengeRepository.ts:276–309`)**:
   ```ts
   async listMyOffers(): Promise<OpenOffer[]> {
     const myTeamIds = (await teamRepository.listMine()).map((team) => team.id);
     if (myTeamIds.length === 0) return [];

     const { data, error } = await supabase
       .from('challenge_candidates')
       .select(
         'id, challenge_id, team_id, rank, distance_m, status, created_at, ' +
           'team:teams!challenge_candidates_team_id_fkey(name), ' +
           'challenge:team_challenges(id, match_name, scheduled_at, total_slots, message, status, from_team_id)',
       )
       .in('status', ['offered', 'interested'])
       .in('team_id', myTeamIds)
       .order('created_at', { ascending: false })
       .limit(50);
     if (error) throw challengeError(error);

     // Deduplicate by challenge_id so a user receives ONE offer card per fixture
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
   }
   ```

3. **Database Schema & RPCs**:
   - `team_challenges`: Table storing open and directed challenges (columns: `id`, `from_team_id`, `created_by`, `match_name`, `scheduled_at`, `total_slots`, `status`, `search_radius_m`).
   - `challenge_candidates`: Table storing match candidate records linking challenges to recipient squads (columns: `id`, `challenge_id`, `team_id`, `rank`, `distance_m`, `status`, `created_at`, `responded_at`). Constraints enforce `status in ('offered', 'interested', 'accepted', 'declined', 'expired')`.
   - `rank_challenge_candidates(in_challenge_id, in_radius_m, in_limit)`:
     - In `supabase/migrations/20260903090000_squad_only_matchmaking.sql:170–247`: Ranks candidate teams strictly by distance and target size, but **lacked** captain deduplication.
     - In `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:15–93`: Updated with `select distinct on (t.owner_id)` to select at most ONE closest squad per captain/owner.
   - `post_open_challenge(...)`:
     - In `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql:101–215`: Loops over `rank_challenge_candidates` to insert candidate rows and dispatches `challenge_offer` push notifications strictly once per distinct owner using `v_notified_users uuid[]`.

---

### 1.3 Card Rendering & Action Logic in `app/teams/offers.tsx`

1. **Card Component (`renderIncoming` in `app/teams/offers.tsx:492–655`)**:
   - **Header Block**:
     - `item.challenge.match_name` (line 502)
     - `formatWhen(item.challenge.scheduled_at)` (line 505)
     - Distance and Format: `${formatDistance(item.distance_m)} · ${format} v ${format}` (line 511)
   - **Recipient Team Block** (lines 514–538):
     - Displays `TeamBlock` with the user's squad name (`team.name`), logo, player count, matches played, wins, and win rate.
   - **Message Block** (lines 540–544):
     - `item.challenge.message`
   - **Status Banner** (lines 546–552):
     - If `item.status === 'interested'`, renders:
       `⚡ Game Request Sent · Waiting for opponent captain to accept`
   - **Action Buttons**:
     1. **💬 Chat** (lines 555–572):
        - Navigates to `/chat/[id]` passing `id: item.challenge_id`, `challengeId: item.challenge_id`, and `teamName: item.challenge?.match_name`.
     2. **Details** (lines 573–584):
        - Navigates to `/teams/${item.challenge?.from_team_id || item.team_id}` to view opponent team profile.
     3. **Send Request** (lines 586–602):
        - Rendered only if `!isInterested` (`status === 'offered'`).
        - Triggers `onSendRequest(item)` (`app/teams/offers.tsx:362–412`).
        - Validates format compatibility: `myTeam.target_size === fixtureFormat`.
        - Calls mutation: `applyToChallenge.mutate({ challengeId: offer.challenge_id, teamId: offer.team_id })`.
        - Updates candidate row status in Postgres to `'interested'`, enqueues `challenge_interest` notification to host captain, and calls `offers.refetch()`.
     4. **Decline / Withdraw** (lines 605–638):
        - Prompts confirmation dialog:
          - If `isInterested`: "Withdraw request? Your game request will be cancelled." (button: "Withdraw").
          - If not `isInterested`: "Decline offer? This offer will no longer be available to your team." (button: "Decline").
        - Triggers mutation: `decline.mutate({ challengeId: item.challenge_id, teamId: item.team_id })`.
        - Invokes RPC `decline_open_challenge(in_challenge_id, in_team_id)`, updates status to `'declined'`, and refetches `offers.refetch()`.

2. **Incoming List FlatList Configuration (`app/teams/offers.tsx:844–862`)**:
   ```tsx
   <FlatList
     data={dedupedIncomingOffers}
     keyExtractor={(item) => item.id}
     renderItem={renderIncoming}
     refreshing={offers.isRefetching}
     onRefresh={() => void offers.refetch()}
     contentContainerStyle={styles.list}
     ListEmptyComponent={...}
   />
   ```

---

## 2. Logic Chain

### 2.1 Root Cause of Duplicate Offer Cards
1. **Multi-Squad Captain Ownership**:
   Users on MatchUp frequently create and captain multiple squads (e.g., a Box Cricket 4v4 squad, a 6v6 squad, a weekend casual squad, and a league squad).
2. **Matcher Broad-Candidate Expansion**:
   In `supabase/migrations/20260903090000_squad_only_matchmaking.sql`, `rank_challenge_candidates` selected all teams within radius matching the format. If a user owned multiple eligible squads (or squads in the same area), the query returned all of them.
3. **Database Insertion of N Candidates**:
   `post_open_challenge` iterated through all candidate rows and inserted them into `challenge_candidates`:
   - Candidate 1: `(challenge_id: C1, team_id: Squad_A_ID)`
   - Candidate 2: `(challenge_id: C1, team_id: Squad_B_ID)`
4. **User-Level Query Multi-Row Retrieval**:
   When the captain visited `/teams/offers`, `challengeRepository.listMyOffers()` queried:
   `from('challenge_candidates').in('team_id', myTeamIds)` where `myTeamIds = [Squad_A_ID, Squad_B_ID]`.
   PostgREST returned both Candidate 1 and Candidate 2 because both squad IDs belong to the caller.
5. **Card Explosion in the UI**:
   Without deduplication, the FlatList rendered each candidate row as a separate card. The captain saw identical cards for fixture `C1` duplicated across all their squads, creating visual clutter and confusing actions.

---

### 2.2 Deduplication Strategy & Architecture (Defense-in-Depth)

To ensure that each match fixture renders as **exactly one card** in the Game Offers screen, a 3-tier defense-in-depth architecture is employed:

```
[ Tier 1: Database (Creation) ]
  rank_challenge_candidates() with DISTINCT ON (t.owner_id)
  └── Guarantees only 1 squad per captain is selected as a candidate per challenge.
        │
[ Tier 2: Repository (Query Layer) ]
  challengeRepository.listMyOffers()
  └── Indexes query results in Map<string, OpenOffer> keyed by challenge_id.
  └── Filters duplicates; prioritizes 'interested' status over 'offered'.
        │
[ Tier 3: Presentation UI (Render Layer) ]
  app/teams/offers.tsx (dedupedIncomingOffers useMemo)
  └── Ensures FlatList data is strictly deduplicated by challenge_id before rendering.
```

1. **Why Deduplicate by `challenge_id`**:
   The match fixture itself is uniquely identified by `challenge_id` (from `team_challenges.id`). A single game fixture represents one event at one venue/time. Displaying one card per `challenge_id` provides a clean, 1:1 mental model for the captain.

2. **Status Resolution Rules**:
   If candidate rows exist in different states for the same user:
   - Status `'interested'` **must always take precedence** over `'offered'`. If the captain already applied with one squad, the card must display the active pending request (`⚡ Game Request Sent`) and allow withdrawing, rather than showing an unrequested "Send Request" button.
   - If both are `'offered'`, the first or closest squad is retained.

3. **Action Integrity**:
   - `onSendRequest`: Uses the selected offer's `challenge_id` and `team_id`.
   - `onDecline`: Declines the offer.

---

## 3. Caveats & Edge Cases Discovered

1. **FlatList KeyExtractor Mismatch (`app/teams/offers.tsx:846`)**:
   - *Observation*: Line 846 currently uses: `keyExtractor={(item) => item.id}` (which is the UUID of the `challenge_candidates` table row).
   - *Risk*: If the item selected by `dedupedMap` changes from Candidate 1 to Candidate 2 (for example, when a request is sent and status transitions to `'interested'`), React detects a key change (`item.id`) and unmounts/remounts the card, losing component state and causing visual flicker.
   - *Fix*: Change `keyExtractor={(item) => item.challenge_id}`. This provides a stable React identity tied to the fixture.

2. **Decline Cascade / "Zombie" Offers in Database RPC**:
   - *Observation*: In `supabase/migrations/20260823220000_match_offers_request_flow.sql:100–148` (`decline_open_challenge`), the query updates:
     `where challenge_id = in_challenge_id and team_id = in_team_id`.
   - *Risk*: If a user had two legacy candidate rows (Squad A and Squad B) for challenge C1:
     When the captain clicks "Decline", only Squad A is marked `'declined'`.
     When `offers.refetch()` runs, `listMyOffers()` queries `.in('status', ['offered', 'interested'])`. Squad A is excluded, but Squad B is still `'offered'`!
     As a result, challenge C1 re-appears on screen as a "zombie" offer under Squad B!
   - *Fix*: In `decline_open_challenge`, update all candidate rows for squads owned by the caller:
     ```sql
     update public.challenge_candidates
        set status = 'declined', responded_at = now()
      where challenge_id = in_challenge_id
        and team_id in (select id from public.teams where owner_id = v_uid);
     ```

3. **Non-Open Challenges (Cancelled or Accepted Fixtures)**:
   - *Observation*: In `challengeRepository.listMyOffers()`, the query filters `challenge_candidates` on `status in ('offered', 'interested')`, but does not filter `team_challenges.status = 'open'`.
   - *Risk*: If a host cancels the challenge or accepts an opponent, the candidate row could momentarily linger before being updated. PostgREST returns the candidate with `challenge: { status: 'cancelled' }`.
   - *Fix*: In `challengeRepository.listMyOffers()` and `app/teams/offers.tsx:494`, ensure offers are filtered with `if (!item.challenge || item.challenge.status !== 'open') continue;`.

4. **Badge Count Consistency in Match Search**:
   - *Observation*: `app/match/create/searching.tsx:1108` displays:
     `View All Offers ({myOffers.data?.length ?? 0}) →`.
   - *Assessment*: Because `useMyOffers()` calls `challengeRepository.listMyOffers()`, which already deduplicates by `challenge_id`, this badge count matches the exact number of cards rendered in `/teams/offers`.

---

## 4. Conclusion

1. **Requirement R3 Status**:
   - The user requirement states: *"Game offers in the 'Game Offers' screen must display as a single card per match fixture (deduplicated by `challenge_id`), allowing captains to manage their challenges cleanly without duplicate cards for every squad they created."*
   - Acceptance criteria: *"Each match fixture renders as exactly one card in the Game Offers screen."*
   - Deduplication is supported across both `src/features/teams/data/challengeRepository.ts` (lines 296–308) and `app/teams/offers.tsx` (lines 347–360).
2. **Actionable Implementation Recommendations**:
   - **Patch 1 (`app/teams/offers.tsx:846`)**: Update `keyExtractor` from `(item) => item.id` to `(item) => item.challenge_id`.
   - **Patch 2 (`app/teams/offers.tsx:494`)**: Add fixture open check: `if (!item.challenge || item.challenge.status !== 'open') return null;`.
   - **Patch 3 (`src/features/teams/data/challengeRepository.ts:300`)**: Filter out non-open fixtures: `if (!offer.challenge_id || !offer.challenge || offer.challenge.status !== 'open') continue;`.
   - **Patch 4 (`supabase/migrations/`)**: Verify that `20260904124000_deduplicate_offers_and_notifications_per_user.sql` is applied to eliminate duplicate candidate row generation at creation time, and update `decline_open_challenge` to decline all candidate rows owned by the caller for that challenge.

---

## 5. Verification Method

### 5.1 Static Verification
Run TypeScript type-checking to verify zero compilation errors:
```bash
npx tsc --noEmit
```
Verify that:
- `OpenOffer` type definition matches `src/features/teams/domain/challengeSchema.ts`.
- `keyExtractor={(item) => item.challenge_id}` satisfies React Native's `FlatList` typing (`(item: OpenOffer) => string`).

### 5.2 Functional / Integration Verification
1. **Multi-Squad Setup**:
   - Authenticate as User A (Captain).
   - Create two squads: "Phoenix XI" (format 4v4) and "Phoenix Titans" (format 4v4).
2. **Host Challenge Broadcast**:
   - Authenticate as User B (Opponent Captain).
   - Post an open challenge fixture for 4v4 at coordinates within radius of User A's squads.
3. **Offers Screen Verification**:
   - Switch to User A.
   - Open Teams tab (`/(tabs)/teams`), tap `"Game offers"`.
   - **Verify**: Exactly **ONE** card is rendered for the match fixture posted by User B.
   - **Verify**: The card displays User B's fixture title, scheduled time, distance, and squad details.
4. **Action Verification**:
   - Tap `"Send Request"`. Verify the card immediately updates to `⚡ Game Request Sent · Waiting for opponent captain to accept`.
   - Verify that no second card appears for User A's other squad.
   - Tap `"Withdraw Request"`. Confirm withdrawal.
   - Pull down to refresh (`onRefresh`). Verify that the card disappears completely and does **not** reappear under the second squad ("zombie offer").
