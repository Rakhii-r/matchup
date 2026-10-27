# SIXFOUR 24 — Project Context for Claude Code

Cross-platform mobile app (iOS + Android) for organising casual **Box Cricket** and
**Badminton (Shuttle)** matches with nearby players. Android-first, Indian market.

> Source of truth is the phase-wise doc set: `MatchUp_Phase1_Requirements.docx` /
> `MatchUp_Phase1_Development.docx`, `MatchUp_Phase2_Requirements.docx` /
> `MatchUp_Phase2_Development.docx`, and `MatchUp_Phase3_Requirements.docx` /
> `MatchUp_Phase3_Development.docx`. Each Requirements doc states what/why (user stories,
> acceptance criteria, NFRs, Definition of Done); each Development doc states how (stack,
> data model, RLS, sprint plan). `MatchUp_Architecture_and_Structure.docx` and
> `MatchUp_Phase1_Build_Plan.docx` are superseded and kept only for history.

## Stack (do not substitute without asking)

- **App:** React Native + Expo (TypeScript, strict), Expo Router (file-based, typed routes)
- **Server state:** TanStack Query · **Client state:** Zustand
- **Forms/validation:** react-hook-form + Zod (validate every external input at the boundary)
- **Backend:** Supabase — Auth (phone OTP: **Twilio Verify** in dev and at launch, plus test phone numbers; MSG91 with DLT via Jio TrueConnect later — Supabase has no built-in MSG91 provider, so that swap needs a Send SMS auth hook. See `docs/SMS_OTP_SETUP.md`), Postgres + PostGIS, Realtime, Storage, Edge Functions
- **Session storage:** expo-secure-store (NEVER AsyncStorage in plaintext)
- **Push:** Firebase Cloud Messaging (via expo-notifications)
- **Analytics/crash:** PostHog + Sentry · **Builds:** EAS

## Branding

The app is **SIXFOUR 24**. Wordmark is lowercase `sixfour24`; never "SixFour24".
Was MatchUp, then briefly P24 — both names are dead. The Android bundle ID is
still `com.asrdigi.matchup` and must stay: it is tied to `google-services.json`
and the FCM credentials, so changing it is a re-registration, not a rename.

Brand green is chartreuse **#98BB01** (`#AEC902` highlight, `#5A7400` shadow).
It fails WCAG AA against white for body text, so it is a fill colour only —
text on it is near-black `#141600`, and the light palette darkens it to
`#5A7400` wherever it carries text. `success` stays emerald so a "completed"
badge is not indistinguishable from a primary button.

Logos live in `assets/images/`: `sixfour24-logo.png` (wordmark lockup, 1672x941)
and `sixfour24-icon.png` (monogram, square). Use `<AppLogo />` — never require
the file directly. `variant="icon"` for headers, where the wordmark is unreadable.

## Theming — read before touching colour

There are three colour sources and only one of them is live:

| Source | Files | Themeable? |
|---|---|---|
| `useMock()` from `mockTheme` | `(tabs)/index.tsx` | **Yes** |
| `M` from `mockTheme` (deprecated) | 7 screens | No — frozen dark |
| `colors` from `@shared/theme` (deprecated) | ~22 files | No — frozen dark |
| `useTheme().colors` | a few | Yes |

**Why a constant cannot be themed.** `StyleSheet.create` runs at module load, so
a colour read from a constant is captured once and can never change. That is why
the theme toggle did nothing before 13 Aug 2026 — and also why `setScheme` had
never been called by anything.

**To make a screen themeable**, turn its `StyleSheet.create({...})` into
`const makeStyles = (M: MockPalette) => StyleSheet.create({...})`, then inside
the component call `const M = useMock()` and
`const styles = useMemo(() => makeStyles(M), [M])`. `(tabs)/index.tsx` is the
worked example. Converting the remaining screens is the "consolidate the two
design systems" task.

The toggle lives in the Nearby header. The choice is persisted to
expo-secure-store and survives a restart; with no override the app defaults to
dark regardless of the OS setting.

## Emerald redesign kit (6 Oct 2026)

Thirteen screens were restyled to the emerald mockups: Home, Games, Teams,
Create team, Team details, Challenges, Booked & Scheduled Games, Select Area,
Game Details, the venue booking sheet, Toss, Live Scoring and Scorecard. No
repository, RPC or route changed.

- `src/shared/ui/decor.tsx` holds the shared pieces: `PageHeader` / `RoundBack`
  (round mint back button + bold title), `IconTile`, and the SVG illustrations
  (`StadiumBackdrop`, `HillsArt`, `MapPinArt`, `CalendarArt`). The artwork is
  drawn from the palette, not shipped as bitmaps, so it follows the theme.
- `app/teams/_layout.tsx` styles the header for every `/teams/*` route. A
  screen there only sets `title`.
- The tab bar FLOATS (`position: 'absolute'`). Nothing reserves space for it:
  every tab screen pads with `useTabContentPadding()`, which is derived from
  `TAB_BAR_HEIGHT` + `TAB_BAR_GAP` in `responsive.ts`.
- `Button` takes `icon` and `trailing` render props; both receive the label
  colour.
- The Teams tab badge is the real team count. It used to be a hard-coded `2`.

## Account deletion (27 Oct 2026)

Settings → Delete account (two confirmations) calls
`authRepository.deleteAccount`: it removes the avatar file first (storage
refuses deletes from SQL), then `delete_my_account`, then a LOCAL sign-out.
The RPC never deletes `auth.users`/`profiles` — that cascades into every
match the user created and every team they own, and `deliveries` RESTRICTs it
for anyone who ever batted or bowled. It erases instead: personal rows
deleted, profile reduced to "Deleted player", owned squads handed to the
longest-standing member, unstarted matches cancelled/left, and the login
(phone, identities, sessions) removed. The public policy and deletion pages
live in `../../netlify-site/`.

## Navigation

Five tabs: **Home · Matches · Teams · Activity · Profile**.

- `Home` (`(tabs)/index.tsx`) is the player dashboard — stats, my team, next
  match, pending actions, recent matches, quick actions. It answers "what is
  happening with ME?". A started match (`status = 'locked'`) the user
  organises or is confirmed in is pinned to the top as a LIVE card
  (`LiveMatchBanner`, `matchRepository.listLive`) that reopens the Match
  Center; it refetches on every Home focus because the tab never unmounts.
- `Matches` (`(tabs)/matches.tsx`) is the former Home screen, moved verbatim:
  sport filter, create, join with code, my matches, nearby list. It answers
  "what can I find or join?".
- `Available` and `Venues` keep their routes but are hidden from the bar with
  `href: null` and reached from Home quick actions. Five tabs is the practical
  limit on a phone; deleting the files would have deleted working screens.

**Create Match is a wizard, not a form.** `app/match/create/` is a nested stack
of real routes — **three steps**: game + match type (`index`) → `venue` →
`details` — so hardware back moves one step back and every step is
deep-linkable. It replaced the single-page `app/match/create.tsx`; Expo Router
treats `create.tsx` and `create/index.tsx` as conflicting routes, so the old
file had to go. Answers live in a zustand store
(`src/features/matches/presentation/useCreateMatchWizard.ts`), never in route
params, which are lost on back-navigation.

- Step 1 asks for the sport AND the match type on one screen. There are exactly
  two types: **Team Vs Team (Challenge)** and **Post a Match (Open for all)**.
  The solo option was removed on 17 Aug 2026.
- **Two creation engines, and the match type picks one** (18 Aug 2026). This
  is the one place the two flows genuinely diverge, and `matchType` MUST branch
  the submit — an earlier version funnelled both through
  `post_open_challenge`, which is exactly why "Post a Match" demanded a team
  and dumped the organiser on the opponent radar.

  | | Team Vs Team (Challenge) | Post a Match (Open for all) |
  |---|---|---|
  | Step 3 shows | Team A modal + informational Team B row | no team UI at all |
  | Submit | `usePostOpenChallenge` → `post_open_challenge` | `useCreateOpenMatch` → `create_open_match` |
  | Creates | a `team_challenges` row, candidates, offers | the `matches` row itself |
  | Lands on | the radar, `create/searching` | the match, `/match/[id]` |
  | Fills up by | one opposing squad accepting | individuals calling `join_open_match` |

  Everything else on Step 3 — venue, date, start/end time, players per side,
  game type, search distance — is identical on both branches and written once.
  `useCreateMatch` stays in the codebase but has no entry point from this
  wizard.
- Step 3 folds in what used to be the team route: on the challenge branch Team A
  is picked in a modal, and Team B is never picked at all — the radar search
  finds the opponent.
- **The radar is Step 3's destination for the challenge branch only**, and it is
  not a fourth step:
  `app/match/create/searching.tsx`, reached as
  `/match/create/searching?challengeId=<the posted challenge>`. It lives in the
  wizard stack so back leaves the flow rather than the app. Every dot on it is
  a real `get_challenge_candidates` row positioned by that team's `rank` and
  `distance_m` against the challenge's own `search_radius_m` — the only
  clock-driven thing on the screen is the three-line stage checklist, which is
  cosmetic and says so. Widening the search withdraws the challenge first,
  because `post_open_challenge` refuses a second live one per team.

**Squad vs squad only, and format is a hard filter (3 Sep 2026).** Two rules
that are really one rule, in `20260904092956_squad_only_matchmaking.sql`.

*No individual enters team matchmaking.* The Find Players board — a solo player
browsing squads and asking to join one — is gone: `app/teams/find-players.tsx`,
`app/match/create/player-searching.tsx` and `app/teams/[id]/requests.tsx` are
deleted, `list_teams_needing_players`, `request_to_join_team`,
`list_team_join_requests` and `respond_to_join_request` are dropped, and
`recruitRepository` is down to one method. `public.team_join_requests` is kept
but inert — no RPC, no grants — so historical rows survive; drop it separately
when the data is no longer wanted. A squad grows by invite code.

*A team plays one format, and only that format.* `teams.target_size` was
"recruiting to N players" and is now the team's DECLARED FORMAT in players per
side — a 6 means "we are a 6 v 6 side". A fixture's format is `total_slots / 2`
(`public.challenge_format`), a team's is `target_size`, and
`public.team_format_matches` is the single comparison every path uses. A NULL
format is NOT a wildcard: the team is out of matchmaking in both directions,
which is why the discovery screens distinguish "no team", "no format" and "no
opponents at this format" instead of showing one empty list.

Enforced in seven places so no path can skip it: `rank_challenge_candidates`
(the radar ranks same-format teams only), `list_open_challenges_nearby` (which
gained a required `in_team_size` and returns nothing for a null),
`apply_to_open_challenge`, `accept_open_challenge` (both sides re-checked at
acceptance), and the three triggers — insert and accept on `team_challenges`,
insert/update on `challenge_candidates` — which is what covers `create_challenge`
and `respond_to_challenge` without editing either. Tokens are
`FORMAT_MISMATCH` and `OPPONENT_FORMAT_MISMATCH`, ordered before each other in
`challengeRepository`'s table for the same substring reason as the squad tokens.

The per-fixture override still exists and is honest: Step 3 defaults the size
chips to the team's format, and choosing a different one calls
`set_team_target_size` FIRST and posts second. Posting first simply fails — the
insert trigger compares the fixture's format with the poster's — because a team
judged by one format while posting another is the asymmetry the whole change
exists to remove. `rank_challenge_candidates` also regained the two self-match
exclusions that `20260820120000` dropped when it rewrote the function.

`app/teams/offers.tsx` is both sides of an open challenge. With no params it is
the **incoming** list (accept / decline). With `?challengeId=` it is the
**poster's** view of who the fixture reached, fed by `get_challenge_candidates`
— and it has no Accept, because `accept_open_challenge` requires the *accepting*
team's owner, so a poster-side accept could only ever fail.

**`challenge_candidates` RLS is not a scoping filter.** Its select policy matches
rows for a team you are in AND every row of a challenge your team posted. A
query for incoming offers must therefore also filter `team_id` to the caller's
own teams (`challengeRepository.listMyOffers`); relying on the policy alone
showed posters their own outgoing candidates as if they were incoming offers.
- `app/teams/post-open.tsx` and `app/teams/challenge.tsx` are orphaned screens:
  the files remain, nothing navigates to them. Every Create Match entry point —
  Home's CTA, the Matches screen buttons, "Find an opponent" on both Teams
  screens — goes to `/match/create`.

The dashboard reads five SECURITY DEFINER RPCs — `get_player_stats`,
`get_my_next_match`, `get_my_recent_matches`, `get_my_pending_actions`,
`list_my_notifications` — and reuses `useMyTeams`. Nothing on Home
reimplements a feature; every button pushes to an existing route.

`get_player_batting_history` is a sixth, added 17 Aug 2026 for the Profile
statistics screen: one row per completed match the caller was confirmed for,
with the batting card derived from `deliveries`. It is the only source of
per-match figures on Profile. `overs`, `opponent_name` and `strike_rate` are
genuinely nullable on it — a fixture from before in-app scoring has no over
count, an open match has no named opponent team, and a strike rate divides by
balls faced — so the screen labels those states rather than filling them in.
`get_player_stats`, `get_my_next_match`, `get_my_recent_matches` and this one
were created directly against the project; they are written down in
`20261002141000_capture_dashboard_rpcs.sql` so a rebuilt database has them.

`list_my_notifications` exists because `notification_jobs` has RLS on with zero
policies: it is a delivery queue whose attempts/last_error columns are
operational. The RPC exposes only the four columns that belong on screen.

## Architecture rules

- Clean Architecture per feature: `presentation → domain → data`. Dependencies point inward.
  UI never imports the Supabase client directly — it goes through a repository.
- The client is untrusted. All access control is enforced by Postgres **RLS** and Edge Functions.
- No `TODO`/placeholder code, no empty catch blocks. Handle every error path.
- Explicit typing; no `any` without a justified comment. Treat all external input as nullable.
- Always paginate lists. Clean up subscriptions/timers on unmount.

## Auth bootstrap and network resilience (2 Oct 2026)

Rules that exist because their absence was a shipped bug. Do not undo them.

- **A failed read is not an answer.** `AuthStatus` has a fifth value,
  `offline`: "we could not find out". Only a profile query that SUCCEEDS with
  no row may set `needs_profile`, and only a session read that succeeds with no
  session may set `signed_out`. `loadProfile` returning `false` must leave the
  store alone. Before this, any network blip sent existing users to
  create-profile, and an offline cold start sent them to login.
- **`bootstrapAuth()` owns the first session read**; `INITIAL_SESSION` is
  ignored. `TOKEN_REFRESHED` only swaps the session when a profile is already
  loaded — it must not refetch the profile every hour.
- **Never call Supabase inside `onAuthStateChange` synchronously.** auth-js
  holds its lock during the callback. Signed-in handling is deferred with
  `setTimeout(…, 0)`; sign-out is applied in the same tick because it makes no
  requests and the route guard must see it immediately.
- **Sign-out clears the query cache** (`queryClient.clear()` in
  `applySession`). Most query keys carry no user id.
- **Every Supabase request has a timeout** (`fetchWithTimeout` in
  `supabaseClient.ts`: 15s, 30s for storage). React Native's fetch has none.
- **`secureStorage` writes are two-slot + pointer.** Write the idle slot, then
  flip `<key>__ptr`. Never delete-then-write: Android kills the app while
  backgrounding, which is when the token refreshes.
- **`toAppError` checks 429 and 5xx before the "otp" substring rule.**
- **Queries retry twice with jitter and never on `conflict`/`rate_limited`.**
  `focusManager` is wired to `AppState`, so `refetchOnWindowFocus` is how the
  app catches up on Realtime events missed in the background.
- **`onlineManager` is fed by `expo-network`, imported lazily** so an OTA
  update cannot crash a binary built before the dependency existed. Queries
  and mutations run with `networkMode: 'always'`: offline they FAIL and show
  their error state rather than pausing, and a mutation never fires late. The
  gain is `refetchOnReconnect`, plus the offline screen dismissing itself.
- **In-app popups come from `notification_jobs`, not from table listeners.**
  `MatchJoinAlerts` holds two Realtime listeners, both filtered by user id:
  the user's own notification rows, and `team_challenges` they created (a
  direct challenge being accepted enqueues nothing for the challenger). A new
  event that needs a popup should `enqueue_notification` in the database and
  put what the popup needs in `data` — `join_requested` carries `playerRowId`
  for exactly that reason. Do not add a listener on `match_players` or
  `challenge_candidates`: they cannot be filtered per user, so Realtime runs
  every subscriber's RLS check against every change, and the event shows two
  popups because the queue already announces it.
- Watchers poll the live score every 8s (`WATCHER_POLL_MS`), not 4s.
- **Every page refreshes itself (27 Oct 2026).** `RefreshOnNavigate` in
  `app/_layout.tsx` refetches the on-screen queries older than `staleTime` on
  every route change, because tabs and stack screens stay mounted and would
  otherwise show whatever they loaded first. `<Screen scroll>` has
  pull-to-refresh built in via `useRefreshAll`; a screen with its own
  ScrollView/FlatList adds a `RefreshControl` with the same hook.
- **Location permission is not location.** With the phone's Location switch
  off, `getCurrentPositionAsync` throws and every location button looked dead.
  `getCurrentCoords` now shows Android's "Turn on location?" dialog first, and
  tells the user when it still cannot get a fix.
- **Local release builds must regenerate `app.manifest`.** expo-updates'
  `create<Variant>UpdatesResources` declares only string inputs, so Gradle
  never re-ran it and any image added later rendered blank (the toss coins).
  `android/app/build.gradle` forces it to run every build.
- `logger.error` reaches Sentry through the sink registered in `initSentry`.

Lists are capped, not paginated. The plan is `docs/PAGINATION_PLAN.md`.

## Folder map

```
app/          Expo Router routes only (screens)
src/features/ feature modules (auth, profile, matches, teams, players, attendance,
              availability, venues, safety, notifications)  each = data/domain/presentation
src/core/     infra: api, auth, config, storage, realtime, location, notifications,
              network, errors, logging, di, observability
src/shared/   ui, hooks, theme, utils, types
supabase/     migrations (schema + RLS + PostGIS + RPC), functions, seed.sql
```

## Phase 1 scope (what we are building now)

OTP login · create profile · create/join match · fill missing players (count-based) ·
approve & confirm · play & mark attended · "I'm available today" · static venue directory
("call to confirm") · attendance flag · report & block.

Note "fill missing players" means filling an OPEN match's sheet with individual
players. It never meant filling a team fixture: since 3 Sep 2026 no individual
can queue for, search for or join a Team vs Team lobby at all.

**Open matches (18 Aug 2026).** `matches.match_type` is `'team_vs_team'` or
`'open'`; every row that predates the column is `'team_vs_team'`, which is what
makes the split safe. An open match has `team_a_id`, `team_b_id` and
`challenge_id` all null by construction.

- `create_open_match` writes the match AND seats its creator as a real
  `match_players` row (`role = 'creator'`, status `confirmed`) in one
  transaction, so the roster is never briefly empty and `filled_slots` is 1
  immediately. `join_open_match` seats anyone else straight to `confirmed` —
  there is no approve/confirm queue, because the match is advertised as open.
- **`filled_slots` counts the creator exactly once.** It used to be
  `1 + confirmed`, because `finalise_challenge` deliberately writes no row for
  the creator. Now `match_occupied_slots` adds the implicit +1 only when the
  creator has no confirmed row of their own, so both flows produce the same
  number they always did. `missing_count` is derived for open matches and left
  untouched for team fixtures, where `finalise_challenge` writes 0.
- `join_match` delegates to `join_open_match` when `match_type = 'open'`, so
  "Join with code" and the nearby card both seat you rather than queue you.
  Its team branch is byte-for-byte what it was.
- **Conflicts are interval overlaps, never "you already have a match."**
  `player_schedule_conflict` is the per-player twin of
  `team_schedule_conflict` and follows the same rule: a commitment is a match
  you created or are confirmed on, in status `open`/`locked`, and only an
  actual overlap refuses. 19 Aug 3–5pm and 20 Aug 3–5pm both stand; 19 Aug
  3–5pm and 19 Aug 4–6pm do not. Rows with no `end_time` are assumed to run
  3 hours. Both RPCs raise
  `PLAYER_SCHEDULE_CONFLICT|<startIso>|<endIso>|<name>` so the message can name
  the fixture that actually clashes; `@shared/utils/scheduleConflict` parses
  that for both repositories.
- `nearby_matches` now honours `matches.search_radius_m`. Before this the
  Search Distance chips were stored and never read. `finalise_challenge` does
  not copy the radius onto the match it creates, so it is null on every team
  fixture and the clause is a no-op for them.
- **The toss gives an open match two shell teams** (`<match name> · Side A` /
  `· Side B`, both owned by the organiser) so scoring has sides to point at.
  They carry `teams.is_match_side = true` (23 Oct 2026) and are excluded from
  `get_my_teams_overview` and `teamRepository.listMine` -- before that every
  tossed open match added two "duplicate" cards to the organiser's My Teams.
  Never list a team in squad UI without filtering this flag; the toss panel
  shortens their names to "Side A" / "Side B".
- `list_match_players` returns `role` and orders the host first. Its
  visibility rule is unchanged, and it is what makes the Players list work for
  a joined player as well as the creator: an open-match joiner is `confirmed`,
  i.e. seated, so they see the whole roster. A stranger sees nothing.

**Teams (added 5 Aug 2026, outside the original phase docs).** Persistent squads:
`teams` + `team_members`, joined by invite code through the `join_team` RPC.
`team_challenges` lets one team's owner challenge another by invite code;
accepting creates a real match and confirms both squads onto it. Note "team" is
overloaded in this codebase — it also means the confirmed roster of a single
match (`matches.status = 'locked'`) and, in Phase 2 FR-204, one of the two sides
within a match. Those are unrelated to `teams`.

See `ROADMAP.md` for how the current product goals map onto the phase docs, and
which ones are blocked by dependencies rather than effort.

## Built since the phase docs (Aug 2026)

- **Open challenges / matchmaking (goal 4, FR-201).** Post a fixture with no
  named opponent; the server ranks nearby same-sport teams by distance from the
  venue, offers it to the closest five, first accept wins. Team position is the
  centroid of members' `home_location`, derived not stored.
- **Consent.** Accepting a fixture confirms only the two captains. Every other
  player is `invited` and pushed a "can you make it" prompt. `filled_slots`
  counts only `confirmed`, so the sheet reflects real availability.
- **Toss (FR-204).** Server-side coin; two RPCs so only the winner picks bat
  or bowl.
- **Scoring — single scorer, deliberately NOT FR-301.** Ball-by-ball with undo.
  FR-301 wants two independent scorers and reconciliation; this trusts one.
  `deliveries` is shaped so a `scorer_slot` column can add the second later.

### Scoring rules that are easy to get wrong

- Legal ball = `extra_type IS NULL OR IN ('bye','leg_bye')`. Wides and no-balls
  are re-bowled and never advance the over.
- `extra_runs` is the TOTAL for that ball including the penalty. A plain wide
  is 1; a wide run away for four is 5.
- Balls faced excludes wides only — a no-ball is a ball the batter faced.
- Bowler economy excludes byes and leg byes, includes wides and no-balls. A
  run-out is not the bowler's wicket.
- Over and ball numbers are derived server-side from the delivery count, never
  sent by the client. Totals are recomputed from the ball log on every write so
  undo is exact rather than a reversal that can drift.
- **Ending the match is TWO calls.** `end_innings` only sets that innings row to
  `completed`; it never touches `matches`. `finish_match` is what compares the
  two innings, writes `matches.status = 'completed'` and phrases `result_text`
  ("… won by 12 runs" / "… won by N wickets" / "Match tied"). A second innings
  ended without `finish_match` leaves the fixture in progress with no winner and
  every read model that keys off status empty — that was the shipped bug. Both
  calls sit behind one `ending` flag in `app/match/[id]/score.tsx`; when the
  second fails the innings is closed and the match is not, so an "Innings closed
  — no result yet" card retries `finish_match` alone instead of hiding the
  half-ended state.
- `matches.result_text` is rendered verbatim by `app/match/[id]/result.tsx`
  (Match Complete, frame 17). Never recompute the margin client-side — the
  wickets-remaining figure depends on the confirmed squad size and belongs in
  `finish_match` alone. `get_live_state` returns the LATEST innings only, so the
  first innings' total is read as `target - 1` (start_innings writes innings 2's
  target as the closed first innings' runs + 1) and its wickets are the one
  figure no read model exposes.

## NOT built yet

Reliability score · match chat · live venue availability · feed algorithm ·
Redis · friends graph (see `docs/FRIENDS_PLAN.md`) · MOTM picker · match history
screen · notifications inbox · home dashboard widgets.

Player career stats are built as of 17 Aug 2026: `(tabs)/profile.tsx` is the
player statistics screen (career totals, Overview / Batting / Recent tabs, a
runs-over-time trend) with the account settings and admin rows below it. It has
no player level, rank or XP because no such column exists, no Fielding tab
because no catch or run-out is recorded per player, and no "View All" on Recent
Performances because there is still no match-history route to link to.

## Working agreement

When you change or add functionality, update the relevant `.md` in the same
change — this file for architecture and rules, `ROADMAP.md` for status, and a
dedicated doc under `docs/` for anything with a real design behind it.

## Commands

- `npm start` / `npm run android` / `npm run ios`
- `npm run typecheck` · `npm run lint`
- DB types: `npm run db:types` (requires Supabase CLI + local stack)

### If lint drowns in "Resolve error"

`import/no-unresolved` is an error here, and the `typescript` entry in
`import/resolver` is served by `eslint-import-resolver-typescript`, which since
v3.7 wraps `unrs-resolver` -- a NATIVE binding published as one optional
dependency per platform. npm installs only the one matching the machine doing
the install (npm/cli#4828), so a `node_modules` installed on Windows and linted
from Linux/WSL/CI throws "Cannot find native binding" and eslint-plugin-import
prints a full stack trace ON EVERY FILE. It looks like a crash; nothing is
wrong with the code being linted.

`.eslintrc.cjs` guards this: it loads the resolver once, and if it cannot, it
drops that resolver and turns `import/no-unresolved` off for the run with one
explanatory line on stderr, so the other rules still report. To fix it properly,
install the binding for the platform you are linting on -- the version must
match `unrs-resolver` exactly:

```
npm i --no-save @unrs/resolver-binding-linux-x64-gnu@$(node -p "require('unrs-resolver/package.json').version")
```
