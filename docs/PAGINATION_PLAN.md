# Pagination plan

Status: **planned, not built** (2 Oct 2026). Nothing in the app paginates today:
there is no `useInfiniteQuery` anywhere, most lists are a `ScrollView` over
`.map()`, and the list RPCs take no cursor. Lists are held in check only by
fixed caps (`.limit(50)`, `.limit(100)`) and PostgREST's `max_rows = 1000`.
That is fine at 10 users and wrong at 10,000: a cap silently hides rows, and an
uncapped RPC returns everything.

## Decisions

**1. Keyset (cursor) pagination, never OFFSET.**
`where (sort_col, id) < (:cursor_col, :cursor_id) order by sort_col desc, id desc limit :n`.
OFFSET re-reads and discards every skipped row, and it skips or repeats rows
when something is inserted while the user scrolls — which is the normal state of
a chat thread or a notifications inbox. Keyset is an index range scan at any
depth and is stable under inserts. The `id` tiebreak is required: two rows can
share a timestamp.

**2. Not every list gets pagination.** Three classes:

| Class | Meaning | Treatment |
|---|---|---|
| A — grows without bound per user | history, inbox, chat, admin tables | cursor + `useInfiniteQuery` + `FlatList` |
| B — bounded by a product rule | roster, lineup, candidates, slots for one day | keep a hard cap, no paging UI |
| C — ranked by distance | nearby matches / challenges / venues / players | server-side `in_limit`, cursor on `(distance_m, id)` |

**3. One RPC convention.** Every paged RPC takes
`in_limit int default 20, in_before timestamptz default null, in_before_id uuid default null`
and clamps `least(greatest(in_limit, 1), 50)` server-side — the client is
untrusted and must not be able to ask for 10,000 rows. The client requests
`limit + 1`; an extra row means there is another page, and it is dropped before
rendering. No `count(*)`: totals cost a second scan and no screen shows one.

**4. New parameters are added with defaults, old signature dropped in the same
migration.** A phone running last month's build still calls the RPC without the
new arguments and must keep working (`runtimeVersion` is `appVersion`, so old
binaries live for weeks). Dropping the old signature in the same transaction
avoids leaving two overloads, which PostgREST refuses to choose between.

**5. Page size 20; `maxPages: 5` on every infinite query.** Invalidation
refetches every loaded page, and Realtime invalidates often. Without `maxPages`
a user 30 pages deep triggers 30 requests per push notification.

## Inventory

| Surface | Source today | Class | Sort key | Phase |
|---|---|---|---|---|
| Captain chat thread | `get_captain_chat` — whole thread | A | `created_at desc, id` | 1 |
| Activity / notifications inbox | `list_my_notifications(in_limit 50)` | A | `created_at desc, id` | 1 |
| My matches (created + joined) | `listMine` (uncapped), `listJoined` (50), `listAllBookedMatches` (100 + 100, merged client-side) | A | `scheduled_at desc, id` | 1 |
| My venue bookings | `venue_bookings` select, uncapped | A | `start_time desc, id` | 1 |
| Nearby matches | `nearby_matches` — no limit | C | `distance_m, id` | 2 |
| Nearby open challenges | `list_open_challenges_nearby` — no limit | C | `distance_m, id` | 2 |
| Nearby venues / venue directory | `nearby_venues`, `venues` (100) | C | `distance_m, id` | 2 |
| Players available today | `nearby_available` — no limit | C | `distance_m, id` | 2 |
| My challenges | `list_my_challenges` — no limit | A | `created_at desc, id` | 2 |
| Admin: reports | `reports` (100) | A | `created_at desc, id` | 3 |
| Admin: users | `profiles` (200) | A | `created_at desc, id` + name search | 3 |
| Team fixtures | `get_team_fixtures` — no limit | A | `scheduled_at desc, id` | 3 |
| Team members, match players, lineup | capped by squad size | B | — | — |
| Challenge candidates | 5 offers per challenge | B | — | — |
| Venue slots | one day per request | B | — | — |
| My teams, sports, blocked users | small by nature; cap stays | B | — | — |
| Home dashboard cards | `limit 5` / `limit 1` slices | B | — | — |

## Phase 1 — the feeds that grow fastest (est. 3–4 days)

Chat first: `get_captain_chat` returns the entire thread on open and again on
every Realtime invalidation, so it gets slower with every message sent.

Database, one migration:

- `get_captain_chat`, `list_my_notifications`: add the three cursor parameters.
- New `list_my_matches(in_limit, in_before, in_before_id, in_scope text)`
  replacing the three client queries. It is a `union all` of matches created and
  matches joined, deduplicated in SQL — the client-side merge in
  `listAllBookedMatches` cannot be paged, because page 2 of one source can
  belong before page 1 of the other.
- New `list_my_bookings` with the same shape.
- Indexes: `match_players (user_id, created_at desc)`,
  `matches (creator_id, scheduled_at desc)`,
  `venue_bookings (user_id, start_time desc)`. Chat and notifications already
  have theirs.

Client:

- `src/shared/hooks/useCursorQuery.ts` — a thin wrapper over
  `useInfiniteQuery` that owns `getNextPageParam`, `maxPages`, and flattening.
  One helper because all Class A lists share exactly this logic.
- Repositories return `{ rows, nextCursor }`; hooks expose
  `{ items, fetchNextPage, hasNextPage, isFetchingNextPage }`.
- `app/(tabs)/activity.tsx`, `MyBookingsModal`, `app/profile/bookings.tsx`,
  `app/teams/matches.tsx`: render with `FlatList`, `onEndReached`,
  `onEndReachedThreshold={0.5}`, a footer spinner, pull-to-refresh that resets
  to page 1.
- Chat: inverted `FlatList`, older pages load on scroll-up. A Realtime INSERT
  is written into page 1 with `setQueryData`, not by invalidating — an
  invalidate would refetch every loaded page for each message.

## Phase 2 — discovery (est. 3 days)

- Add `in_limit` (default 30, max 50) and a `(distance_m, id)` cursor to the
  four `nearby_*` / `list_open_challenges_nearby` RPCs. The GiST indexes
  already exist; `order by location <-> point` uses them for KNN ordering.
- The cursor is the last row's distance. A team that moves between pages can
  appear twice or be skipped; de-duplicate by id on the client. Acceptable for
  discovery, would not be for a ledger.
- `(tabs)/matches.tsx` already uses `FlatList`; `(tabs)/venues.tsx` and
  `(tabs)/available.tsx` move from `ScrollView` + `.map()`.
- With a server limit in place the 60s poll on `useNearbyOpenChallenges` only
  refetches page 1.

## Phase 3 — admin and long tail (est. 2 days)

- Reports and users: cursor on `(created_at, id)` plus a server-side search
  (`ilike` on `full_name`, exact match on `phone`). A 200-row cap means an
  admin cannot find user 201 at all, which is a correctness bug, not a
  performance one.
- Indexes: `reports (status, created_at desc)`, `profiles (created_at desc)`.
- `get_team_fixtures`, `list_my_challenges`: cursor parameters.

## Done means

For each phase, on a staging project seeded with 5,000 rows per feed:

1. `explain analyze` of page 1 and of a page 100 rows deep both show an index
   scan and comparable timings (this is the check that keyset is really in use).
2. Insert a row while scrolled to page 3: no row repeats, none is skipped.
3. An app build from before the migration still loads page 1 of every list.
4. k6 `discovery_read` p95 under 300 ms at target concurrency.
5. Scrolling 200 items on a low-end Android device holds 55+ fps.

## Not doing

- **Total counts / "page 3 of 12".** Infinite scroll needs neither.
- **Offline cache of pages.** No persisted query cache exists yet; add it
  separately if offline reading becomes a requirement.
- **A generic `paginate(table)` SQL helper.** Each RPC has its own visibility
  rule; a shared helper would have to take the rule as dynamic SQL.
