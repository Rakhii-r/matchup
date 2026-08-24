# sixfour24 — UI/UX redesign plan

Audit date: 15 Aug 2026. Repo: `App Rebranding to P24/uploads/matchup`.
Supabase project: `izqknyzmeyiowbwmcfes`.

This is the output of steps 1–4 of the brief (audit → map → plan). No screen files
have been changed yet.

---

## 1. What exists today

**App layer** — 42 route files, ~8,058 lines under `app/`.

| Area | Routes | State |
|---|---|---|
| Auth | login, verify-otp, create-profile | Phone OTP working, India-first normalisation, secure-store chunked sessions |
| Tabs | index, matches, teams, activity, profile (+ hidden: available, venues) | 5 visible tabs |
| Match | create, join, [id], [id]/toss, [id]/score, [id]/scorecard | All built, incl. live scoring and toss |
| Teams | index, create, join, challenge, challenges, post-open, offers, [id]/{index,manage,edit,invite} | All built |
| Profile | profile/edit, player/[id] | Built |
| Admin | index, users, venues, sports | Built, superadmin-gated |

**Data layer** — 12 feature modules, 38 RPCs called from the client, all reads/writes
funnelled through repositories with `AppError` normalisation. This is a genuinely
well-structured backend. The redesign should not touch it.

**Already working, must not regress:** phone OTP, route guards, nearby matches
(PostGIS), create/join/approve match, share codes, attendance, teams + invite codes,
directed challenges, open challenges with candidate ranking and first-accept-wins,
player consent invitations, report/block with block-aware matchmaking, push
notifications with sanitised deep-link routing, venue directory, admin moderation,
superadmin roles, toss, single-scorer live scoring, scorecards.

---

## 2. Gap analysis — reference vs reality

Twenty reference frames, mapped:

| # | Reference frame | Current route | Work |
|---|---|---|---|
| 1 | Splash / onboarding | `_layout` AppSplash | Redesign |
| 2 | Home | `(tabs)/index.tsx` | **Rebuild** — different information architecture |
| 3 | Create match / select game | `match/create.tsx` (785 LOC single form) | **Split into a wizard** |
| 4 | Select venue | — | **New step** |
| 5 | Select team | — | **New step** |
| 6 | Create team | `teams/create.tsx` | Redesign + location field |
| 7 | Match details | `match/[id]/index.tsx` | Rebuild as unified tabs |
| 8 | Finding opponent (radar) | `teams/post-open.tsx` (form only) | **New screen + animation** |
| 9 | Match offers | `teams/offers.tsx` | Redesign |
| 10 | Team details & chat | `teams/[id]/index.tsx` | Redesign; **chat does not exist** |
| 11 | Match confirmation | — | **New screen** |
| 12 | Match details (confirmed) | `match/[id]/index.tsx` | Unified Details/Lineups/Venue tabs |
| 13 | Toss | `match/[id]/toss.tsx` | Real coin animation |
| 14 | Live scoring | `match/[id]/score.tsx` | Restyle only — logic is sound |
| 15 | Match lineups | part of `[id]` | Fold into unified screen |
| 16 | Venue details | — | **New screen** |
| 17 | Match complete | — | **New screen** |
| 18 | Matches history | `(tabs)/matches.tsx` (723 LOC) | Rebuild |
| 19 | Profile | `(tabs)/profile.tsx` | Redesign |
| 20 | Edit profile | `profile/edit.tsx` | Redesign + location autocomplete |

---

## 3. Blockers — needed before the relevant phase can start

### B1. Sports are hard-coded in the database, not just the UI

Five CHECK constraints pin every sport column to exactly two values:

```
availability.sport   CHECK (sport IN ('box_cricket','badminton'))
matches.sport        CHECK (sport IN ('box_cricket','badminton'))
profiles.sport_pref  CHECK (sport_pref <@ ARRAY['box_cricket','badminton'])
sports.sport         CHECK (sport IN ('box_cricket','badminton'))
teams.sport          CHECK (sport IN ('box_cricket','badminton'))
```

The reference shows six sports (Box Cricket, Shuttle, Football, Volleyball,
Basketball, Tennis). Adding any of them means dropping five constraints, making
`sports.sport` the single source of truth with foreign keys onto it, and widening the
`Sport` TypeScript union that is currently used across every feature module.

This is also the root cause of bug 41.5/41.6: the `sports` table stores
`sport='box_cricket'` with `name='Cricket'`, while the app labels it via a separate
hard-coded `SPORT_LABEL` map. Two lists, two labels, one concept.

### B2. Location autocomplete needs a Places provider and an API key

`profiles` already has `home_lat`, `home_lng` and a PostGIS `home_location`, so no
schema change is needed for coordinates. But §26 requires typeahead against a maps
provider. That needs a key, a billing account, and a decision on provider (Google
Places vs Mapbox vs OlaMaps — the last is materially cheaper for India).

### B3. Chat does not exist, at any layer

No `messages`/`conversations` table, no realtime channel, no UI, not even a stub.
§20 says to use existing backend "if present" — it is not. Building it means a new
table, RLS scoped to challenge participants, a realtime subscription, and a screen.

### B4. Venues have no image, rating, price or facilities

`venues` columns are: `name, address, lat, lng, location, sport_types, phone,
confirm_note, created_by, created_at`. The reference venue cards show a photo, a
star rating, a per-hour price and a facilities list. None of that exists. Today the
app fakes venue photos with two local bundled images keyed by sport — that is bug
41.9.

### B5. Matches have no game type, end time, or stored search radius

§16 asks Match Details to show Friendly/Competitive, an end time, and the search
distance. `matches` has none of those columns.

---

## 4. Proposed phases

Each phase ends with `tsc --noEmit` + `eslint` clean and the listed flow tested.

**Phase 0 — Design system unification (prerequisite)**
The app currently runs two parallel design systems. `@shared/theme` (colors/radius/
spacing) covers 22 files; `mockTheme` (M/S/R/useMock) covers 10. Six of the mockTheme
files import the frozen `M` directly and so ignore the theme toggle entirely. Going
Home → Teams → team detail crosses design systems in two taps.

Nothing else should be built until there is one token set. Deliverable: a single
themed token module, `useMock` semantics for all of it, every screen migrated.
Verify: no import of frozen `M` remains; light/dark toggle changes every screen.

**Phase 1 — Navigation + Home**
Bottom nav → Home / Matches / Venues / Teams / Profile. Activity leaves the bar and
becomes a route behind the header bell. Home rebuilt: greeting + location header,
Create Match CTA, horizontally scrolling Sports / Games Near You / Venues / Your
Matches, each with See All. All from live RPCs.
Verify: five tabs; every carousel scrolls; every See All lands correctly; no static data.

**Phase 2 — Sports as one source of truth** *(needs B1 decision)*
Migration dropping the five CHECKs, FK onto `sports`, widened `Sport` type, real
Sports Management with add/edit/activate/deactivate.
Verify: a sport added in admin appears in Home and Create Match within one refetch.

**Phase 3 — Create Match wizard**
Split the 785-line form into Select Game → Match Type → Select Venue → Select Team
(with inline Create Team) → Details. Reuses `useCreateMatch` and
`usePostOpenChallenge` unchanged.
Verify: both branches create real rows; back-navigation preserves state.

**Phase 4 — Unified Match Details**
One screen, tabbed Details / Lineups / Venue. Team A and Team B lineups kept
separate (currently one mixed roster — bug 41.12). Edit / Search Again / Withdraw /
Begin Match footer.
Verify: both lineups correct; withdraw clears offers and stops matchmaking.

**Phase 5 — Matchmaking flow**
Radar screen over the real `post_open_challenge` ranking, Match Offers redesign,
Team Details, accept/reject, Match Confirmed.
Verify: two accounts, one posts, one accepts, first-accept-wins holds.

**Phase 6 — Toss + Live Scoring polish**
Real coin animation using your `head coin -64.jpg` / `tails coin- 64.jpg` assets,
2–3s, tap-locked, result from the server's `perform_toss` — the animation must
display the server result, never generate its own. Scoring screen restyled only.
Verify: toss result matches the DB row every time.

**Phase 7 — Profile, venues, chat** *(chat needs B3; venues need B4)*

---

## 5. Bug list from §41 — root causes found during audit

| # | Bug | Root cause | Fixed |
|---|---|---|---|
| 2 | Team photo missing from Edit Team | `uploadLogo` uses `upsert: false` and the storage policy has INSERT only — a second upload can never succeed | No |
| 3/4 | Profile photo upload/remove | `profileRepository.update()` never wrote `avatar_url` | **Yes, 15 Aug** |
| 5/6 | Sports management inconsistency | B1 — two lists, `sports.sport` vs `SPORT_LABEL` | Needs B1 |
| 9 | Venue data inconsistency | B4 — photos are bundled local assets keyed by sport | Needs B4 |
| 12 | Team roster/side grouping | `match/[id]` renders one mixed roster; `get_match_sides` exists but is barely used | No |
| 1 | Match offers not working | `decline_open_challenge` wrote a status the CHECK constraint rejected | **Yes, 15 Aug** |

---

## 6. Also found

- Two duplicate match-list screens (`app/matches.tsx` 290 LOC and
  `app/(tabs)/matches.tsx` 723 LOC) and two team-list screens. The root `/teams` has
  no inbound link at all.
- `app/teams/challenge.tsx` — 243 lines, fully working directed-challenge form,
  nothing navigates to it.
- `app/(tabs)/venues.tsx` — 224 lines, unreachable: hidden from the bar and no push
  targets it. Phase 1 gives it a tab.
- No `+not-found.tsx` catch-all anywhere.
- Six screens are written as single minified lines, which makes them effectively
  unreviewable.
- Supabase advisor: `public.spatial_ref_sys` has RLS disabled. This is PostGIS's own
  reference table, shipped that way; low risk, but it will keep appearing in audits.
