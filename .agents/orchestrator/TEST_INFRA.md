# Test Infrastructure Documentation (TEST_INFRA.md)

## Project: MatchUp Geospatial Play-Zone Targeting, Public Discovery & Offers Deduplication

---

## 1. Overview & Test Mission

This document defines the testing infrastructure, test execution harnesses, and test suite architecture for the MatchUp platform. The mission of this test suite is to verify the core requirements defined in `ORIGINAL_REQUEST.md` and architectural specifications in `PROJECT.md`:
1. **Requirement R1 (Geo-Targeted Notifications & Deduplication)**: Push notifications (`challenge_offer`) strictly target nearby captains within the designated play zone radius (`ST_DWithin(team_location, origin_location, radius_m)`), with strictly one notification per distinct captain even when managing multiple squads.
2. **Requirement R2 (Global In-App Match Viewing)**: Open matches and open fixtures across the app feed and Games tab must be discoverable and viewable by all users without distance lockouts or missing-GPS barriers.
3. **Requirement R3 (User-Level Match Offers Deduplication)**: Game offers in the "Game Offers" screen render as a single card per match fixture (keyed by `challenge_id`), preventing duplicate cards for multi-squad captains.

---

## 2. Test Architecture: The 4-Tier Model

The test suite is structured across 4 rigorous tiers of verification:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TIER 4: REAL-WORLD SCENARIOS                          │
│ Realistic multi-club league tournament workflow across multiple squads/fmts │
├─────────────────────────────────────────────────────────────────────────────┤
│                    TIER 3: CROSS-FEATURE COMBINATIONS                       │
│ Challenge creation -> geo-targeting -> single card -> apply -> notification  │
│ Out-of-radius global browse + in-radius localized push notification delivery │
├─────────────────────────────────────────────────────────────────────────────┤
│                    TIER 2: BOUNDARY & CORNER CASES                          │
│ Radius boundaries (<= R vs > R), null GPS coords, 0/1/N squads,             │
│ Offer lifecycle state transitions, Zombie offer prevention on decline       │
├─────────────────────────────────────────────────────────────────────────────┤
│                       TIER 1: FEATURE COVERAGE                              │
│ F1: Geo-targeted notification radius filtering (ST_DWithin)                │
│ F2: Captain notification deduplication across multiple squads               │
│ F3: Global match discovery with null coords / without distance gate         │
│ F4: Global open challenges browsing for squad-less users                    │
│ F5: Single card per match fixture in Game Offers (keyed by challenge_id)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Test Suite Directory Layout

```
matchup/
├── supabase/
│   └── tests/
│       ├── open_challenges_test.sql               # Base open challenges verification
│       └── geospatial_offers_dedup_test.sql      # Database RPC & PostGIS integration tests
├── tests/
│   ├── harness/
│   │   └── testHarness.ts                         # In-memory PostGIS spatial math & DB harness
│   ├── tier1_features/
│   │   ├── geoTargetedNotifications.test.ts       # Features F1 & F2
│   │   ├── globalMatchDiscovery.test.ts           # Features F3 & F4
│   │   └── offersDeduplication.test.ts            # Feature F5
│   ├── tier2_boundaries/
│   │   └── boundaryAndEdgeCases.test.ts           # Boundaries, GPS variations, zombie prevention
│   ├── tier3_cross_features/
│   │   └── crossFeatureWorkflows.test.ts          # Cross-feature flows (create, apply, global browse)
│   ├── tier4_real_world/
│   │   └── multiSquadLeagueWorkflow.test.ts       # Full multi-squad league ecosystem simulation
│   └── runTests.ts                                # Master test runner
└── .maestro/
    ├── config.yaml                                # Master Maestro E2E mobile runner
    ├── 01_home_and_calendar.yaml                  # Home feed and calendar
    ├── 02_matches_feed.yaml                       # Matches tab basic interactions
    ├── 03_create_match.yaml                       # Wizard match creation
    ├── 04_live_radar.yaml                         # Radar scan and distance filters
    ├── 05_venues_directory.yaml                   # Venues directory
    ├── 06_profile_and_theme.yaml                  # Profile and appearance
    ├── 07_game_offers_deduplication.yaml          # Game offers single card deduplication & actions
    └── 08_global_match_discovery.yaml             # Unblocked global match & fixture discovery
```

---

## 4. Authoritative Expected Output Derivation

All expected values across the test suite are derived directly from documented mathematical properties, Postgres/PostGIS invariants, and business contracts:

| Verification Target | Input / Condition | Authoritative Expected Output Derivation Source |
|---|---|---|
| **Geodesic Distance** | Origin `(18.5204, 73.8567)`, Target `(18.5204, 73.8850)` | PostGIS `ST_Distance(geography, geography)` spheroid calculation ($\approx 2990\text{ m}$) |
| **Geo-targeting Gate** | Target distance $D$, Radius $R$ | Invariant: Included if and only if $D \le R$. Excluded if $D > R$ |
| **Captain Deduplication** | Captain $U$ owns Squad $S_1$ ($2\text{km}$) and $S_2$ ($5\text{km}$) | PostGIS `SELECT DISTINCT ON (t.owner_id)` selects $S_1$; `post_open_challenge` enqueues strictly 1 push |
| **Global Discovery** | Query with `(lat: null, lng: null, radius: null)` | `nearby_matches` returns all open matches ordered chronologically by `scheduled_at asc` |
| **Offers Deduplication** | Multiple candidate rows for `challenge_id = C_1` | `challengeRepository.listMyOffers()` returns 1 item; `offers.tsx` FlatList key is `challenge_id` |
| **Status Precedence** | Rows for same challenge in `'offered'` and `'interested'` | Status `'interested'` has precedence over `'offered'` |
| **Decline Cascade** | User declines offer for fixture $C$ with squad $S_1$ | Invariant: All candidate rows for squads owned by user for fixture $C$ cascade to `'declined'` |

---

## 5. How to Run the Tests

### 5.1 TypeScript Test Suite (Unit & Integration)

Using Node's native test runner:
```bash
# Run all Tier 1-4 tests
node --loader ts-node/esm tests/runTests.ts
# or using tsx:
npx tsx tests/runTests.ts
# or using Node test glob:
node --test tests/**/*.test.ts
```

### 5.2 TypeScript Type-Checking Gate

```bash
# Verify project-wide TypeScript compilation (0 errors)
npx tsc --noEmit
```

### 5.3 PostgreSQL / PostGIS Database Integration Tests

Against a local Supabase / Postgres instance:
```bash
# Using Supabase CLI:
supabase test db

# Or using psql:
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/geospatial_offers_dedup_test.sql
```

### 5.4 Mobile UI E2E Test Suite (Maestro)

```bash
# Run the complete mobile E2E test suite (Flows 01 through 08)
maestro test .maestro/config.yaml

# Run specific E2E flows:
maestro test .maestro/07_game_offers_deduplication.yaml
maestro test .maestro/08_global_match_discovery.yaml
```

---

## 6. Coverage & Traceability Matrix

| Feature ID | Feature Description | Tier | Test File | Test Cases |
|---|---|---|---|---|
| **F1** | Geo-Targeted Notification Filtering | 1 | `tests/tier1_features/geoTargetedNotifications.test.ts` | `F1.1`, `F1.2` |
| **F2** | Captain Notification Deduplication | 1 | `tests/tier1_features/geoTargetedNotifications.test.ts` | `F2.1`, `F2.2` |
| **F3** | Global Match Discovery (Null Coords) | 1 | `tests/tier1_features/globalMatchDiscovery.test.ts` | `F3.1`, `F3.2`, `F3.3` |
| **F4** | Global Open Challenges (Squad-less) | 1 | `tests/tier1_features/globalMatchDiscovery.test.ts` | `F4.1`, `F4.2`, `F4.3` |
| **F5** | Single Card per Fixture in Offers | 1 | `tests/tier1_features/offersDeduplication.test.ts` | `F5.1`, `F5.2`, `F5.3` |
| **B1** | Exact Radius Boundary ($\le R$ vs $> R$) | 2 | `tests/tier2_boundaries/boundaryAndEdgeCases.test.ts` | `B1.1`, `B1.2` |
| **B2** | Squad Counts (0, 1, Multiple) | 2 | `tests/tier2_boundaries/boundaryAndEdgeCases.test.ts` | `B2.1`, `B2.2`, `B2.3` |
| **B3** | Lifecycle & Zombie Offer Prevention | 2 | `tests/tier2_boundaries/boundaryAndEdgeCases.test.ts` | `B3.1`, `B3.2` |
| **C1** | End-to-End Challenge -> Card -> Apply | 3 | `tests/tier3_cross_features/crossFeatureWorkflows.test.ts` | `Flow 1` |
| **C2** | Global Browse vs Targeted Push | 3 | `tests/tier3_cross_features/crossFeatureWorkflows.test.ts` | `Flow 2` |
| **R1** | Multi-Squad League Ecosystem | 4 | `tests/tier4_real_world/multiSquadLeagueWorkflow.test.ts` | `League Workflow` |
| **DB** | PostGIS & RPC SQL Integration | 1-3 | `supabase/tests/geospatial_offers_dedup_test.sql` | `TEST 1 - 5` |
| **UI** | Game Offers Single Card E2E | 1, 3 | `.maestro/07_game_offers_deduplication.yaml` | `Flow 7` |
| **UI** | Global Discovery E2E | 1, 3 | `.maestro/08_global_match_discovery.yaml` | `Flow 8` |
