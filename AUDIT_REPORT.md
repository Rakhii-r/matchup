# P24 (MatchUp) — Full Project Audit

**Date:** 5 July 2026 · **Scope:** entire repo (~7,800 LOC app + SQL) plus live Supabase project advisors (`izqknyzmeyiowbwmcfes`) and `npm audit`.

> **The one thing to know:** the backend foundation (schema, RLS, repositories) is genuinely good — but **the app as shipped is not functional end-to-end**. Profile creation is a dead-end mockup, and 3 of the 4 main tabs show hardcoded fake data. Fix Section 0 before anything else in this report.

---

## 0. Blockers found during the audit (fix before all else)

| # | Issue | Evidence |
|---|-------|----------|
| B1 | **Sign-up dead-end.** `create-profile` screen is a pure mockup: it never calls `useCreateProfile`; the "Ready to Play" CTA just does `router.back()` (`app/(auth)/create-profile.tsx:119-126`). The route guard then bounces the user straight back (`app/_layout.tsx:33-34`). **A new user can never enter the app.** The working hook exists (`src/features/profile/presentation/useCreateProfile.ts`) — it's just not wired. |
| B2 | **Available tab is fake.** Hardcoded players array and a toggle bound to local state only (`app/(tabs)/available.tsx:22-27, 63-68`), fake "12 active" (line 80). Real hooks `useSetAvailable` / `useNearbyAvailable` (`src/features/availability/presentation/useAvailability.ts`) are never imported by any screen. |
| B3 | **Venues tab is fake.** Hardcoded venues with ratings and a dead "Book Now" button (`app/(tabs)/venues.tsx:24-55, 131`). `useVenues` is only used by the admin screen. Phase 1 spec is "static directory + call to confirm" — the data layer for that exists and is unused. |
| B4 | **Profile tab is fake.** Shows "Arjun Sharma", 98% reliability, 142 matches for every user (`app/(tabs)/profile.tsx:23, 74-131`). Real profile is already in `useAuthStore`. Reliability score is explicitly a Phase 2 feature — showing a fake one violates your own scope doc. |
| B5 | **No version control.** No `.git`, no `.gitignore`, and a real `.env` sitting in the folder root. First `git init && git add .` will commit live credentials. |
| B6 | **Demo matches masquerade as real.** When the DB returns zero rows, hardcoded demo cards render with no visual "demo" marker; tapping does nothing (`src/features/matches/domain/demoMatches.ts`, `app/(tabs)/index.tsx:186-190, 196`). Also makes the `EmptyState` component (lines 122-160) unreachable dead code, since the list is never empty. |

---

## 1. Architecture Overview

### 1.1 Stack & topology

```
┌────────────────────────── Mobile app (iOS/Android) ─────────────────────────┐
│ Expo SDK 56 · React Native 0.85 · TypeScript strict · Expo Router (file-based)│
│ Server state: TanStack Query · Client state: Zustand · Validation: Zod       │
│ Animations: Reanimated 4 + Moti · Session: expo-secure-store (chunked)       │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ HTTPS + user JWT (supabase-js)
┌──────────────▼───────────────────────────────────────────────────────────────┐
│ Supabase: Auth (phone OTP) · Postgres 15 + PostGIS · RLS on every table      │
│ 2 RPCs (nearby_matches, nearby_available) · Storage/Realtime/Edge: unused    │
└──────────────────────────────────────────────────────────────────────────────┘
Observability: Sentry + PostHog wrappers wired but DSN/keys empty (.env:11-13)
Push: FCM planned (devices table exists, expo-notifications installed, no code)
```

Data flow is clean where implemented: screen → presentation hook → repository → supabase-js → RLS-guarded Postgres. Every repository maps raw errors to a typed `AppError` (`src/core/errors/AppError.ts:45-67`) — nice.

### 1.2 What's done well

- Feature-module Clean Architecture (`src/features/*/data|domain|presentation`) is followed consistently; UI never imports the Supabase client directly (one minor exception: `app/(tabs)/profile.tsx:6` imports `authRepository` directly instead of via a hook).
- RLS on every table, roles in a separate `user_roles` table to prevent self-promotion (`supabase/migrations/0003_roles_admin.sql:4-6`), recursion fixed properly with SECURITY DEFINER helpers (`0005_fix_matches_rls_recursion.sql`).
- Session in Keychain/Keystore with a smart chunking adapter for the 2KB Android limit (`src/core/storage/secureStore.ts`).
- Env config validated with Zod at startup (`src/core/config/env.ts:17-41`); typed DB types generated from schema.
- TanStack Query retry policy correctly refuses to retry auth/permission errors (`src/core/api/queryClient.ts:14-21`). `npx tsc --noEmit` passes clean.

### 1.3 Anti-patterns / maintainability risks

1. **Two parallel design systems.** `src/shared/theme` (light/dark, `ThemeContext`) vs `src/shared/theme/mockTheme.ts` (`M`/`S`/`R`, dark-only). Match detail and Join screens use the old light theme (`app/match/[id].tsx:19`, `app/match/join.tsx:8`) while every other screen is dark — a visibly jarring split and double maintenance. Consolidate on one theme.
2. **Mockup screens shipped in prod routes** (B1–B4 above). If you need design references, keep them in a `/mockups` storybook route, never on the tab bar.
3. **`filled_slots` is never maintained.** The column exists with constraints (`0001_phase1_schema.sql:81, 91`) and is displayed on every card (`app/(tabs)/index.tsx:207-208`), but no code updates it when players are approved/confirmed. Displayed numbers will always be wrong. Maintain it with a DB trigger on `match_players` status changes, not client writes.
4. **Missing infra promised by CLAUDE.md folder map:** `src/core/notifications`, `network`, `realtime`, `di` don't exist. Fine for now, but the doc and code disagree.
5. **No "My matches" surface.** After creating a match, the only way back to it is the modal you were left in. A creator who closes the app cannot find their own match again (no query for `creator_id = me` anywhere). Big functional hole.
6. **Zero tests, no CI.** Not even a smoke test for `normaliseIndianPhone` or the RLS policies (Supabase supports pgTAP tests).

---

## 2. Security Review

Transport is HTTPS throughout; SQL injection surface is effectively nil (supabase-js parameterized builders + RPCs, no string-built SQL); XSS/CSRF are not applicable to a native RN app in the web sense. The real issues are authorization scope and abuse resistance:

### CRITICAL

- **S1 — No git + live `.env` + no `.gitignore`** (B5). Also note the file itself says "NEVER commit real values" (`.env:1`) while containing real values for project `izqknyzmeyiowbwmcfes`. The anon key is public-by-design, but the repo needs `.gitignore` (`.env*`, `.expo/`, `node_modules/`) *before* the first commit, and history/rollback is itself a security control you currently don't have.
- **S2 — Every authenticated user can read every user's phone number and exact home coordinates.** `profiles_select` grants SELECT on full rows to any signed-in user (`0002_phase1_rls.sql:20-21`), and `profiles` contains `phone`, `home_lat`, `home_lng`, `home_location` (`0001:24-46`). Sign-up costs one OTP, so mass-scraping phones + home locations of your entire user base is trivial. Fix: restrict base-table SELECT to self + admins; expose a `public_profiles` view (id, full_name, area_name, avatar_url) for everything else. The app only ever reads `full_name, area_name` for other users (`src/features/matches/data/matchRepository.ts:105`, `src/features/availability/data/availabilityRepository.ts:77`), so nothing breaks.

### HIGH

- **S3 — Deactivation is toothless.** Admins can set `is_active = false` (`adminRepository.ts:26-32`), but no RLS policy anywhere references `is_active`, and the session isn't revoked. A "deactivated" user retains full access. Add `and (select is_active from profiles where id = auth.uid())` style checks (via a SECURITY DEFINER `is_active_user()` helper) to write policies, and/or ban via Supabase Auth admin API.
- **S4 — SMS pumping / OTP cost abuse.** `signInWithOtp` (`authRepository.ts:12`) has no CAPTCHA/app attestation, and OTP requests are attacker-controllable cost. Enable Supabase Auth rate limits + CAPTCHA (Turnstile), restrict SMS geo-permissions at the provider, set billing alerts. This is the #1 way early Indian consumer apps burn money.
- **S5 — SECURITY DEFINER functions executable by `anon`** (live advisor finding). `nearby_matches`, `nearby_available`, `has_role`, `is_admin`, `is_blocked_between`, etc. are callable *without signing in* and bypass RLS. An anonymous caller can enumerate open matches with coordinates via `/rest/v1/rpc/nearby_matches`. Fix: `revoke execute on function ... from anon, public;` (grant to `authenticated` only). Remediation link: [Supabase lint 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

### MEDIUM

- **S6 — Join race → overfilled matches.** Capacity/state checks live only in the client (`useMatches.ts:127-141`); `match_players_insert_self` only checks `user_id = auth.uid()` (`0002:81-82`). Concurrent joins (or a direct API call) bypass "match is open" entirely. Move join into an RPC that locks the match row and validates status/capacity.
- **S7 — Attendance can be recorded for anyone**, including users who never joined the match (`attendance_insert_creator` checks only creator + marked_by, `0005:71-76`). Add an `is_match_player` check. Matters because attendance feeds the Phase 2 reliability score.
- **S8 — Share codes are guessable and enumerable.** Generated with `Math.random()` (`matchSchema.ts:51-57`, 32⁶ ≈ 1.07B space, non-crypto RNG) and `getByShareCode` (`matchRepository.ts:76-84`) allows unthrottled probing of any open match. Use `crypto.getRandomValues`, and rate-limit lookups (RPC + counter) or lengthen the code.
- **S9 — Any user can insert venues** (`venues_insert`, `0002:34-35`) though Phase 1 says the directory is admin-managed. Spam/abuse vector into a screen all users see. Gate INSERT behind `is_admin()`.
- **S10 — DB accepts unbounded text.** Zod caps lengths client-side only (e.g. `reportSchema.ts:16`, `profileSchema.ts:7-8`); the tables have no length CHECKs. Anyone with the anon key + their JWT can insert megabyte strings. Add CHECK constraints mirroring the Zod caps.
- **S11 — Advisor misc:** `set_updated_at` has mutable `search_path`; PostGIS installed in `public`; `spatial_ref_sys` has RLS disabled (reference table, low risk). See [lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [0013](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [0014](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).

### LOW

- **S12 — `npm audit`: 12 moderate vulns**, all in the Expo config/CLI dependency chain (build-time, not runtime). Clear with the next SDK bump; don't `audit fix --force`.
- **S13 — Report/block spam** has no rate limiting (`safetyRepository.ts`) — annoying for moderators, not dangerous.
- **S14 — Session management** is otherwise solid: JWT 1h + refresh rotation (`supabase/config.toml:23-24`), SecureStore persistence, auto-refresh tied to AppState (`supabaseClient.ts:28-34`). Local-only test OTP correctly scoped to local config (`config.toml:32-35`) — just never copy that block to prod.

---

## 3. User-Friendliness / UX

### Broken or misleading flows (beyond Section 0)

- **Demo cards look real** and silently ignore taps (`app/(tabs)/index.tsx:196`). Either label them "Example" or replace with the (currently unreachable) empty state, which is well-designed.
- **No path to your own/joined matches** (see 1.3.5). Add a "My matches" section on Home fed by two cheap queries (`creator_id = me`, `match_players.user_id = me`).
- **Back-button trap risk on create-profile:** guard loops `needs_profile` users back (correct once B1 is fixed — but keep the close "X" from popping to login).

### What's already good

OTP flow: auto-submit at 6 digits, 30s resend timer, specific expired-code copy (`verify-otp.tsx:40-61`, `useOtp.ts:52-58`), SMS autofill via `autoComplete="sms-otp"` + `textContentType="oneTimeCode"` (`OtpBoxInput.tsx:46-47`). Home has skeletons, pull-to-refresh, retry states (`(tabs)/index.tsx:368-389, 401-402`). Error copy is human throughout (`AppError.ts:34-43`).

### Gaps

- **Feedback:** no success confirmation after creating a match (you're just teleported to the detail screen — show the share code prominently with a "Share on WhatsApp" action; in India that's the growth loop), no toasts anywhere, `Alert.alert` only in ReportBlockBar.
- **Loading:** match detail uses a bare spinner (`app/match/[id].tsx:68-77`) while Home uses skeletons — inconsistent.
- **Accessibility:**
  - Icon-only controls have no `accessibilityLabel` (gear/menu in `available.tsx:43-45`, `venues.tsx:66-69`, `profile.tsx:62-65`; gear on Home `index.tsx:280`).
  - No reduced-motion support anywhere (no `AccessibilityInfo.isReduceMotionEnabled` usage in the repo) despite looping pulse animations (`index.tsx:96-105, 124-133`).
  - Decorative header icons (`IconMenu`) do nothing when tapped — remove or wire them.
  - Dark-theme contrast is mostly fine; check `M.faint` (#6B7075) on `M.bg` (#0F0F10) for small text — it's borderline for WCAG AA.
- **Onboarding:** after profile creation, land users on Home with a one-time "How it works" (create → share code → approve → play) coach-mark instead of a cold list.

---

## 4. UI Polish & Animations

**Good news:** your stack already contains the right tools — Reanimated 4, Moti, `expo-haptics` (installed, **never used** — no `Haptics` import in the repo), gesture-handler. You need adoption, not new libraries.

### Recommended libraries (for this stack)

| Need | Use | Notes |
|------|-----|-------|
| All UI animation | **Reanimated 4 + Moti** (have) | Stop using legacy `Animated` (`index.tsx:78-90, 94-119`, `AppSplash.tsx:24-45`) — one API, runs on UI thread |
| Press feedback + haptics | `expo-haptics` (have) | `Haptics.impactAsync(Light)` on primary CTAs, `selectionAsync` on chips |
| List enter/exit | Reanimated `entering={FadeInDown}` / `Layout` | One prop per card, cheap on low-end Android |
| Complex vector (splash, success ticks) | **Lottie** (`lottie-react-native`) — add later | Only if design invests in it |
| Toasts | Small custom Moti component or `sonner-native` | Slide+fade, auto-dismiss |
| **Not** Framer Motion / GSAP | — | Web-only; wrong platform |

### Principles for your market (low-end Android first)

Durations 150–250ms; animate only `transform`/`opacity` (UI thread); no layout-property animations in long lists; gate all looping/decorative motion behind a `useReducedMotion()` hook (Reanimated exports one); never block input on a transition.

### Before → after, highest-impact screens

1. **Match detail (`app/match/[id].tsx`) — worst offender.** Before: light-theme card dump that visually belongs to a different app; bare spinner. After: rebuild on `mockTheme` tokens; skeleton rows; share-code block with copy + WhatsApp share and a spring "copied ✓"; player rows `entering={FadeInDown.delay(i*40)}`, `exiting={FadeOutUp}` + `LinearTransition` when approved/removed; Approve/Confirm buttons with scale-press + light haptic; sticky status header. Effort: ~2 days. Impact: highest in app (it's the core loop screen).
2. **Splash → login handoff.** You already have a polished animated splash (`src/shared/ui/splash/`). Add: logo shared-element-style continuation (splash logo fades/moves into login logo position), staggered `FadeInUp` for heading/input/CTA (60ms steps). Effort: 0.5 day.
3. **Home feed (`app/(tabs)/index.tsx`).** Already has skeletons/scale-press. Add: card `entering` stagger on first load, animate the progress bar width with `withTiming` on data change, pull-to-refresh with a subtle logo spinner, haptic on "Create Match". Convert `ScalePressable` to Reanimated. Effort: 1 day.
4. **Create match (`app/match/create.tsx`).** Chips already animate via Moti. Add: `selectionAsync` haptic per chip, animate the sticky CTA between disabled/enabled states (color + slight rise), success moment after posting — full-screen brief check + share code reveal instead of instant navigation. Effort: 1 day.
5. **Tab transitions.** Add `animation: 'fade'`/`shift` on the tab navigator and keep modals as-is; enable `react-native-screens` freeze. Effort: hours.

**Flag (don't do):** parallax on the login stadium image, animated gradient backgrounds, per-frame shadow animations, and any long (>400ms) blocking transition — all hurt on ₹8-10k Android phones. The existing infinite pulse loops should pause when off-screen and respect reduced motion.

---

## 5. Scalability — 1,00,000 concurrent users

Reality check: 1 lakh *concurrent* implies millions of installs. You will not get there on the current single Supabase instance — but the architecture (thick DB with RLS + stateless clients) scales further than most. What breaks first, in order:

### 5.1 Verified bottlenecks (from live advisors + code)

1. **RLS `auth_rls_initplan` — 31 policies** re-evaluate `auth.uid()` per row (every policy in `0002`/`0003`/`0005`). At scale this is pure CPU burn. Fix is mechanical: replace `auth.uid()` with `(select auth.uid())` in every policy. [Lint 0003](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan). **Do this now — it's one migration.**
2. **`is_blocked_between()` runs per candidate row** in `nearby_matches` (`0001:218`), `matches_select`, `availability_select`, `profiles_select`. Each call is an EXISTS over `blocks` with an OR across both directions — and **`blocks(blocked_id)` has no index** (unindexed-FK advisor; the unique index only covers `blocker_id, blocked_id`). Add `create index on blocks (blocked_id, blocker_id);` immediately; longer-term, filter blocks in the RPC once (CTE) instead of per-row.
3. **Unindexed FKs (9)**: `attendance(user_id)`, `attendance(marked_by)`, `blocks(blocked_id)`, `matches(venue_id)`, `reports(reporter_id / reported_user_id / match_id)`, `user_roles(granted_by)`, `venues(created_by)`. One migration.
4. **12 `multiple_permissive_policies`** warnings (admin policies OR'd onto user policies on `matches`, `venues`, `profiles`, `reports`, `user_roles`) — every query evaluates both. Acceptable now; consolidate into single policies with `is_admin()` OR'd inside when you tune.
5. **Missing composite index for the hot query:** `nearby_matches` filters `status='open'` + `ST_DWithin` + orders by distance. Add a partial index: `create index matches_open_location_gix on matches using gist (location) where status = 'open';` (the plain `matches_status_idx` on a 4-value column is near-useless alone).
6. **Unbounded tables/queries:** `venueRepository.list()` has no `.limit()` (`venueRepository.ts:22-28`) — it silently truncates at `max_rows = 1000` (`config.toml:9`); `availability` rows are never deleted after expiry (`0004` filters them but they accumulate forever). Add pagination + a `pg_cron` daily purge.
7. **`filled_slots` integrity** (1.3.3) — under concurrency this must be a transactional trigger, never client math.
8. **Single point of failure:** one Supabase project, one region, no queue. Push notifications (Phase 1 spec: "player needed" alerts) must not be sent inline from request paths — use a DB queue (`pgmq`) or Edge Function fan-out.

### 5.2 Scaling plan by load tier

| Tier | What to do |
|------|-----------|
| 0–10k MAU (now) | Fix 5.1.1–5.1.7. Enable Sentry + PostHog (keys are empty today). Supabase Pro, PITR backups. |
| 10k–100k MAU | Compute upgrade; **Supavisor transaction-mode pooling** for all client traffic; add read replica, route `nearby_*` RPCs to it; CDN (Supabase Storage + CDN) for venue/avatar images; queue + Edge Function for FCM fan-out; rate limiting at Auth + per-RPC (counter tables or Cloudflare in front). |
| ~1 lakh concurrent | Largest compute + multiple read replicas; cache `nearby_matches` per geohash-cell with 15–30s TTL in Redis (Upstash) via an Edge Function — nearby results don't need per-user freshness (blocks can be filtered client-side from a small cached blocklist); shard-by-city is your natural partition key if Postgres writes saturate; consider moving discovery reads off PostgREST to a thin API layer with autoscaling. |

Client-side you're already well set up: `staleTime: 30s`, no refetch-on-focus (`queryClient.ts:12, 23`), exponential backoff. Add jittered retry and offline cache persistence (TanStack persister) later.

### 5.3 Monitoring & alerting (before launch)

Sentry (crash + `registerLogSink` bridge from `logger.ts` — the hook exists, wire it), PostHog funnels (events already defined in `analytics.ts:24-37`), Supabase: enable `pg_stat_statements` review + log drain, alerts on DB CPU > 70%, pooler saturation, auth error rate, SMS spend. Uptime check on the REST endpoint.

### 5.4 Load-testing plan

Tool: **k6** (scriptable JS, native ramping arrival rates; Locust fine too; JMeter not worth it here).

1. Seed a **staging** Supabase project with realistic data: 500k profiles, 50k open matches clustered in 5–10 city geohashes, 1M match_players, blocks distribution ~1%.
2. Mint a pool of ~10k real JWTs (script `verifyOtp` against test OTPs, or sign JWTs with the project secret for staging).
3. Scenario mix per virtual user: 60% `rpc/nearby_matches` (random coords in-city), 15% match detail (3 queries: match, players, membership), 10% `rpc/nearby_available`, 10% joins/creates (writes), 5% profile reads.
4. Stages: ramp 1k → 10k → 50k → 100k arrivals/min, 10-min soak at each. Gates: p95 < 500ms reads / < 1s writes, error rate < 0.5%, no pooler exhaustion, DB CPU < 80%.
5. Separately chaos-test the join race (S6): 200 concurrent joins on one 4-slot match must yield exactly 4.
6. Re-run after every index/policy change; keep results in the repo.

---

## 6. Future Roadmap

**Phase A — Make it real (1–2 weeks).** B1–B6: wire create-profile, Available, Venues, Profile tabs to the existing hooks; remove/label demo matches; `git init` + `.gitignore` + first commit; add "My matches" to Home. *No animation work yet except keeping what exists.*

**Phase B — Security & integrity (1 week, parallel-ish).** S2 (profiles view — biggest), S5 (revoke anon EXECUTE), S3 (`is_active` enforcement), S4 (CAPTCHA + SMS limits), S6 (join RPC with lock), `filled_slots` trigger, S7, S9, one migration for all index/`(select auth.uid())` fixes (5.1.1–5.1.5). Turn on Sentry/PostHog.

**Phase C — Polish for launch (1–2 weeks).** Theme consolidation (kill the light/dark split — match detail rebuild is item #1), animation pass per Section 4 (this is the right time: after flows work, before scale), accessibility labels + reduced-motion hook, share-to-WhatsApp on match create, onboarding coach-marks. Beta on EAS internal track.

**Phase D — Grow (Phase 2 of your spec).** Push notifications (queue-based), match chat (Realtime — budget connections), reliability score (server-computed from the now-trustworthy attendance data), venue partnerships replacing fake "Book Now" with a real one. Load-test at each step per 5.4; introduce Redis caching + read replica when city launch marketing starts, not before.

---

## Final checklist

### Security fixes
- [ ] `git init`, add `.gitignore` (`.env*`, `.expo/`, `node_modules/`), first commit (S1)
- [ ] Lock `profiles` SELECT to self+admin; add `public_profiles` view; repoint the 2 profile joins (S2)
- [ ] `revoke execute ... from anon, public` on all SECURITY DEFINER functions (S5)
- [ ] Enforce `is_active` in RLS write policies + revoke sessions on deactivation (S3)
- [ ] Enable Auth CAPTCHA + OTP rate limits + SMS geo-restrictions + billing alert (S4)
- [ ] Replace client-side join with locking `join_match` RPC (S6)
- [ ] Restrict attendance inserts to actual match players (S7)
- [ ] Crypto-random share codes + throttled lookup (S8)
- [ ] Venue INSERT → admin-only (S9)
- [ ] Add DB length CHECK constraints mirroring Zod caps (S10)
- [ ] Fix `set_updated_at` search_path; note PostGIS/spatial_ref_sys lints (S11)
- [ ] Re-run `npm audit` at next Expo SDK upgrade (S12)

### Scalability fixes
- [ ] One migration: `(select auth.uid())` in all 31 flagged policies
- [ ] Index migration: `blocks(blocked_id, blocker_id)` + 9 unindexed FKs + partial GiST on open matches
- [ ] `filled_slots` maintained by trigger on `match_players`
- [ ] Paginate `venues.list()`; `pg_cron` purge of expired `availability`
- [ ] Wire Sentry + PostHog keys; DB/pooler/SMS-spend alerts
- [ ] Supavisor transaction pooling; plan read replica + geohash-TTL cache for `nearby_*`
- [ ] Queue-based FCM fan-out (never inline)
- [ ] k6 staging suite per 5.4, incl. the 200-concurrent-join race test

### UI / Animation upgrades
- [ ] Wire the 4 mockup screens to real data first (B1–B4)
- [ ] Consolidate on one dark theme; rebuild match detail + join screens on it
- [ ] Migrate legacy `Animated` code to Reanimated/Moti; delete duplicate `ScalePressable`s into one shared component
- [ ] Haptics on CTAs/chips (`expo-haptics` is already installed)
- [ ] List `entering`/`exiting` + `LinearTransition` on Home cards and player queue
- [ ] Skeletons on match detail; toast component for success/error
- [ ] Match-created "success moment" with share code + WhatsApp share
- [ ] `useReducedMotion()` gate on all loops; `accessibilityLabel` on all icon buttons
- [ ] Tab fade transitions; keep everything ≤250ms, transform/opacity only
