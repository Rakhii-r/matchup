# P24 (MatchUp) — Production Plan: Current State → Launch

**Date:** 5 July 2026 · **Team:** solo developer · **Basis:** Architecture Spec v1.0, the actual codebase, and the audit in `AUDIT_REPORT.md`.

**Where you actually are:** the architecture doc describes the *destination*. The code has ~70% of the backend spine (schema, RLS, repositories, hooks) and ~40% of the frontend (auth + create/join match work; profile creation and 3 of 4 tabs are unwired mockups). Several things the doc promises don't exist yet: Edge Functions (`notify-wave`), FCM registration, Realtime, tests, CI, git. This plan sequences what remains.

> **Implementation update — 3 August 2026:** The status snapshot above was written on 5 July and is retained for historical context. The completed work below is now the authoritative current state for match discovery, creation, venue selection, joining, and approval notifications.

## 0. Implemented Match Workflow (Current State)

### Completed application changes

- **ESLint configuration:** added the Expo and Prettier ESLint configuration in `.eslintrc.cjs`. TypeScript typechecking passes. The project still has separate pre-existing React 19 lint findings around React Native `Animated.Value` refs and effect state updates.
- **Nearby match lifecycle filtering:** Nearby no longer shows terminal or indefinitely stale matches. The database RPC returns only `open` matches scheduled in the future or within a six-hour ongoing-match window. The repository repeats the cutoff client-side to protect partially deployed environments and stale responses.
- **Database-only venue selection:** manual venue entry was removed from Create Match. Users select from a dropdown populated by the `venues` table. The list is filtered to venues supporting the selected sport.
- **Authoritative venue data:** match creation re-fetches the chosen venue by ID before insertion. It stores `venue_id`, the database venue name, and the venue's database latitude/longitude. Device coordinates are no longer incorrectly used as match coordinates.
- **Required match name:** Create Match now requires a dedicated name of 2–80 characters. It is stored in `matches.match_name` and displayed on Nearby cards and the match-detail screen. Description/format notes remain separate.
- **Secure join requests:** code and browse joins use the transactional `join_match` database RPC. It rejects unauthenticated/inactive accounts, own-match joins, closed or started matches, full matches, and invalid join sources. Duplicate requests are idempotent.
- **Creator approval workflow:** joining creates an `interested` membership. The creator can accept it as `approved`, reject/remove it, and later confirm the player from the match-detail screen.
- **Realtime creator popup:** while signed in and the app is active, a creator receives a Supabase Realtime popup when a player requests to join. The popup includes an **Accept** action; the request also remains on the match-detail screen if the creator chooses **Later** or was offline.
- **Realtime player popup:** when the creator changes the membership to `approved`, the requesting player receives a realtime acceptance popup and the relevant TanStack Query data is invalidated.
- **Actionable deployment errors:** if the mobile code is ahead of the database schema (for example, `match_name` is missing), the UI now reports that the latest Supabase migrations must be applied instead of showing only a generic error.

### Implemented database migrations

Migration filenames use the timestamp versions recorded by the linked remote Supabase project. Do not rename them back to `0001`, `0002`, and so on; Supabase uses the timestamp prefix as migration identity.

| Migration | Implementation |
|---|---|
| `20260803060907_filled_slots_trigger.sql` | Keeps filled-player counts synchronized from confirmed memberships. |
| `20260803070000_join_match_rpc.sql` | Adds the locked, server-authoritative join RPC and removes direct client inserts into `match_players`. |
| `20260803070100_hide_expired_nearby_matches.sql` | Excludes stale historical matches from `nearby_matches` while retaining a six-hour ongoing window. |
| `20260803070200_match_names_and_join_realtime.sql` | Adds `matches.match_name`, validates its length, and enables `match_players` in the Supabase Realtime publication. |

> **Corrected 3 August 2026 (later the same day).** The paragraph that stood here claimed the first eleven local timestamps matched remote. They did not. `security_hardening` had never been applied to the remote project, so remote held ten pre-August entries against eleven local files. Mapping files onto remote timestamps in order, without accounting for that gap, shifted six files down one slot: local `20260721093107` said `security_hardening` while remote said `avatars_storage`, and so on through `filled_slots_trigger`. Because Supabase keys migration identity on the timestamp prefix alone, `migration list` showed matching versions while the contents differed — and `db push` would have skipped `security_hardening` permanently.
>
> Resolved: the six files were renamed back onto the timestamps matching their real contents, `security_hardening` was given a new trailing timestamp and applied, and the duplicate `20260803060907` ledger row was removed. Local and remote now agree on both version and content.

### Deployment procedure

From the repository root, verify migration alignment:

```powershell
npx.cmd supabase migration list
```

Apply pending migrations:

```powershell
npx.cmd supabase db push
```

Before trusting `migration list`, remember it compares **timestamps only** — two files can show as matched while containing entirely different SQL. Confirm content matches too. Use `supabase migration repair` when the ledger genuinely disagrees with what ran (as it did on 3 August), and not otherwise; reverting valid history makes the ledger inaccurate in the opposite direction.

After a successful database push, restart Expo Go without USB debugging:

```powershell
npx.cmd expo start --go --tunnel --clear
```

For devices on the same Wi-Fi, LAN mode is faster:

```powershell
npx.cmd expo start --go --lan --clear
```

### Acceptance test checklist

1. Create or verify at least one admin-managed venue for each supported sport.
2. Open Create Match and confirm that no manual venue input is available.
3. Select a sport and confirm that only compatible database venues appear.
4. Enter a match name, format, future date/time, venue, and optional description; post the match.
5. Confirm the new name appears on Nearby and the match-detail screen.
6. Sign in as a second user and join using the share code or Nearby card.
7. Confirm the creator receives the interested-player popup and can choose **Accept**.
8. Confirm the second user receives the accepted popup and sees membership status `Approved`.
9. Confirm the creator can move the player from `Approved` to `Confirmed`.
10. Confirm completed/cancelled matches and matches older than the ongoing window do not appear in Nearby.

### Known scope boundary

The implemented alerts are foreground in-app Realtime popups. Reliable alerts while the app is closed or backgrounded still require Expo/FCM device-token registration and a server-side push notification function. That remains a launch-critical item in Phase 1-B below.

---

## 1. Tech Stack Recommendation

### Keep (your choices are right — don't churn)

| Component | Verdict | Why, specifically for you |
|---|---|---|
| React Native + Expo SDK 56 + TS strict | **Keep** | Already built, typecheck passes, EAS Update gives you OTA fixes — critical for a solo dev who can't afford store-review turnaround on every bug. |
| Expo Router + TanStack Query + Zustand + Zod | **Keep** | Your doc's Redux analysis is correct and the code proves it: the entire server-state layer is ~200 lines of hooks. Redux would triple that for zero gain. |
| Supabase (Postgres + PostGIS + RLS + Auth) | **Keep** | The "one spine, never rewritten" principle is your best architectural decision. The RLS foundation in `supabase/migrations/` is 80% right — it needs the audit's fixes, not a replacement. |
| Supabase Edge Functions for privileged logic | **Keep** | You'll need exactly two before launch (join-match RPC can be plain SQL; notify-wave must be an Edge Function). Deno functions deploy in seconds — right size for one person. |
| FCM via expo-notifications | **Keep** | Free, standard, already a dependency. |
| PostHog + Sentry | **Keep, activate** | Wrappers exist (`src/core/observability/`), keys are empty. Free tiers cover you well past launch. Your doc's "measure the thesis" principle is currently unmeasurable. |
| expo-secure-store session | **Keep** | The chunking adapter (`secureStore.ts`) is better than most production apps. |

### Swap

| From → To | Why |
|---|---|
| **Twilio → MSG91** for OTP SMS (**decided — Twilio dropped entirely**) | Verified pricing: Twilio India ≈ $0.0832/SMS (~₹7.3) vs MSG91 ₹0.15–0.20/OTP — ~35–45× difference. DLT registration in progress on Jio TrueConnect; break-even vs the ~₹5,900 DLT fee is ~830 OTPs. MSG91 connects to Supabase Auth via the custom SMS hook. CLAUDE.md updated. |
| **Doc's full Domain layer (use-cases + DI container + entities) → your current lighter pattern** | The doc specifies `ApprovePlayerUseCase`, repository interfaces, `di/container.ts`. The code skipped all that and went screen → hook → repository — **and that was the right call for a solo dev.** The use-case layer earns its keep with a team of 4+; for you it's ceremony that slows every feature by 30%. Keep the repository boundary (that's the part with real value), drop the rest, amend the doc. |
| **Doc's Realtime Presence for "available today" → persisted rows only (Phase 1)** | The `availability` table + `nearby_available` RPC already work. Presence channels add connection cost and teardown bugs for a feature the polling/refetch model already covers at your scale. Realtime enters in Phase 2 with chat, where it's actually load-bearing. |

### Add (missing entirely)

| Addition | Why |
|---|---|
| **Git + GitHub (private) + GitHub Actions CI** | You have *no version control* (audit B5). This is item #1 of week 1. CI = typecheck + lint + `npm audit` on push; ~30 lines of YAML. |
| **Cloudflare Turnstile CAPTCHA on OTP request** | Supabase Auth supports it natively. Without it, `signInWithOtp` is an open faucet billing you per SMS (audit S4). Non-negotiable before the app is public. |
| **pgTAP smoke tests for RLS** (or a plain SQL test script run in CI against `supabase start`) | Your entire security model *is* the RLS policies. One regression = data leak. Ten assertions ("user B cannot update user A's profile", "non-creator cannot approve players") catch the catastrophic class of bug. Skip Jest/Detox for now — RLS tests have 10× the value per hour for this architecture. |
| **Upstash Redis / BullMQ** | **Do NOT add.** Your doc's Phase-3-only stance is correct. Endorsed as-is. |
| **Maps SDK (Google/Mapbox)** | **Defer.** Doc lists it, but Phase 1 venue directory needs distance text + a "Directions" deep-link to Google Maps (`https://maps.google.com/?q=lat,lng`) — zero SDK, zero API key billing. Add the SDK in Phase 2 with live venue availability. |

---

## 2. Security Foundations (must-haves before launch)

Full detail with file/line citations is in `AUDIT_REPORT.md` §2; this is the launch-gate list. **Items marked ⛔ are risks live in your current architecture right now.**

1. ⛔ **Version control + secrets hygiene.** `git init`, `.gitignore` covering `.env*`/`.expo/`/`node_modules/` *before* first commit (a real `.env` sits in the repo root today). Prod/staging secrets live only in EAS env & Supabase dashboard; rotate the anon key after go-live if the folder was ever shared.
2. ⛔ **Data exposure: phones + home coordinates.** `profiles_select` currently lets any signed-in user read every user's `phone`, `home_lat/lng`. Your doc §8 even specifies "limited columns" for profile reads — the implementation didn't follow it. Fix with a `public_profiles` view (audit S2). *This is the single worst issue in the system.*
3. ⛔ **Anon-callable SECURITY DEFINER functions.** `nearby_matches` etc. are executable without login and bypass RLS (verified via live Supabase advisors). `revoke execute … from anon, public`.
4. **Auth hardening:** Turnstile CAPTCHA on OTP, Supabase Auth rate limits (per-phone and per-IP), MSG91 spend alert. JWT config is already good (1h expiry + refresh rotation).
5. **Server-side integrity:** join-match via locking RPC (client-side capacity checks are bypassable — S6); `filled_slots` maintained by trigger; attendance restricted to actual match players (S7); crypto-random share codes (S8); enforce `is_active` so bans actually ban (S3).
6. **Input validation depth:** Zod at the boundary exists and is good — mirror the length caps as Postgres CHECK constraints so the API can't be fed garbage directly (S10).
7. **Encryption:** in transit — TLS everywhere via Supabase (done); at rest — Supabase encrypts disk by default (done, nothing to build). Session at rest — SecureStore (done). **Certificate pinning (doc §8.1): drop it from the launch list.** In Expo managed workflow it requires a config plugin + breaks on cert rotation, and your threat model (casual sports app) doesn't justify the solo-dev maintenance cost. Revisit if you ever handle payments in-app.
8. **Dependency scanning:** `npm audit` in CI + Dependabot on GitHub. Current 12 moderate vulns are build-time Expo-chain only; clear at next SDK bump.
9. **Backups:** Supabase Pro ($25/mo) for daily backups **+ enable PITR before launch** (~$100/mo tier; if budget-blocked, at minimum schedule `pg_dump` via GitHub Actions nightly to private storage). An accidental `delete` without PITR is unrecoverable.
10. **Storage bucket RLS** (doc §8.1): when you add avatars, path-scoped policies (`avatars/{auth.uid()}/*`) from day one.

---

## 3. Fastest Path to Completion

### Off-the-shelf decisions (build nothing you can rent)

Already correctly rented: auth (Supabase), SMS (MSG91), push (FCM), analytics/crash (PostHog/Sentry free tiers), builds (EAS), geo (PostGIS). Additionally rent: CAPTCHA (Turnstile, free), CI (GitHub Actions free tier), status/uptime (BetterStack/UptimeRobot free), WhatsApp sharing (RN `Share` API — your growth loop needs zero infra). **Build custom: nothing new.** The remaining work is wiring, not invention.

### Phase 1-A — MVP-critical (weeks 1–4): "a stranger can complete the loop"

Order matters — each item unblocks the next:

1. **Git + CI + Sentry/PostHog keys** (day 1–2). Everything after this is diffable and crash-visible.
2. **Security migration #1** (day 3–5): `public_profiles` view, revoke anon EXECUTE, `(select auth.uid())` rewrite, all missing indexes, CHECK constraints, `is_active` enforcement. One migration file, mechanical, from the audit. *Do this before wiring UI so screens are built against the final policies.*
3. **Wire create-profile** (the sign-up dead-end, audit B1) — the hook exists; this is a 1-day connect job. **Nothing else matters until a new user can enter the app.**
4. **Integrity migration #2:** `join_match` locking RPC + `filled_slots` trigger + attendance player check. Repoint `useJoinByCode` at the RPC.
5. **Wire the three mockup tabs** to their existing hooks: Available → `useSetAvailable`/`useNearbyAvailable`; Venues → `useVenues` (distance text + call button + Maps deep-link, kill fake "Book Now"); Profile → `useAuthStore` real data (kill fake reliability score — it's Phase 2 per your own doc).
6. **"My matches" on Home** (creator + joined queries) — without it, organisers lose their own matches.
7. **MSG91 + Turnstile** in Supabase Auth config; test the OTP path on a real device with a real SIM.

### Phase 1-B — Launch-critical, not day-1-critical (weeks 5–7)

8. **notify-wave Edge Function + FCM device registration** (`devices` table exists, zero code does). This is your doc's core retention mechanic ("player needed nearby") — launch-critical for the *thesis*, but build it after the loop works.
9. **Share-to-WhatsApp** on match creation (share code + deep link). In India this *is* your distribution.
10. **Theme consolidation + match-detail rebuild** (the light/dark split, audit §4) + accessibility labels + demo-match removal.
11. **RLS smoke tests in CI**; seed one locality (your doc §12.6: venues + ~50 test players); load-test the join race (200 concurrent joins → exactly N slots).
12. **EAS production builds**, Play Store internal track → closed beta with a real cricket/badminton group.

### Nice-to-have (only if beta feedback demands)

Animation polish pass (audit §4 — the *feel* layer, after flows work), onboarding coach-marks, avatar upload (Storage + bucket RLS), venue detail screen (`venue/[id]` route from the doc).

### Post-launch (Phase 2 of your spec — do not start before density data)

Matching engine, chat (Realtime), reliability score (Edge Function over now-trustworthy attendance), waiting list, live venue availability, maps SDK. Your doc's own guiding principle: *liquidity risk, not technology risk* — Phase 2 code is worthless until Phase 1 proves people show up.

---

## 4. Scalability Plan (1 lakh+ concurrent, later)

### Architect correctly NOW (cheap now, rewrite-expensive later)

1. **All DB fixes from the audit** — `(select auth.uid())` policies, `blocks(blocked_id, blocker_id)` index, partial GiST on open matches, FK indexes. One migration; at 100 users invisible, at 100k users the difference between 20ms and timeouts.
2. **Transactional integrity at the DB** (join RPC, `filled_slots` trigger) — race conditions only manifest under load, and retrofitting correctness into live data is the costliest class of rework.
3. **Keep clients stateless / server authoritative** — you already have this (JWT + RLS + PostgREST). It's the property that makes horizontal scaling *possible* later. Don't compromise it for convenience features.
4. **Queue-shaped notification fan-out from day one:** notify-wave should read a `notification_jobs` table (insert → process → mark done) even while the "queue" is just Postgres + a cron-triggered Edge Function. Then Phase 3's BullMQ/Upstash swap is a transport change, not a redesign. Sending pushes inline from request paths is the pattern that forces rewrites.
5. **Pagination + TTL hygiene:** `.limit()` on every list (venues currently unbounded), keyset pagination on nearby, `pg_cron` purge of expired availability. Unbounded growth is silent until it isn't.
6. **Bounded profile exposure** (`public_profiles`) — privacy fix now, *and* the seam that later lets you cache public profiles aggressively without leaking PII.

### Do NOT over-engineer yet (your doc mostly agrees — hold the line)

- **No Redis/BullMQ until Phase 3** (doc §3.3 is right; Postgres covers both hot paths for years at your realistic scale).
- **No read replicas, no sharding, no multi-region** — a Supabase compute upgrade is a dashboard click when metrics demand it. City-based sharding is your natural partition *if* you ever need it; nothing you build now blocks it.
- **No microservices / custom API layer** — PostgREST + RPCs + Edge Functions is the whole backend until well past 100k MAU.
- **No offline-first sync** (doc §2.4 already defers it — correct; TanStack cache persistence is a cheap later add).
- **No matching engine before density data** — the doc's own liquidity thesis.
- **No cert pinning, no Detox E2E suite, no design-system package** — team-scale tooling, not solo-scale.

When real scale arrives, the path is: compute upgrade → Supavisor transaction pooling → read replica for `nearby_*` → geohash-TTL cache in Upstash via Edge Function (details + load-test plan: `AUDIT_REPORT.md` §5).

---

## 5. Step-by-Step Execution Plan (solo dev, ~8 weeks to public beta)

| Week | Deliverable | Depends on |
|---|---|---|
| **1** | Git + GitHub + CI (typecheck/lint/audit); Sentry & PostHog live; **security migration #1** (profiles view, revoke anon, policy rewrite, indexes, CHECKs, `is_active`); update CLAUDE.md (MSG91, superseded docs) | — |
| **2** | **Create-profile wired** (kills the sign-up dead-end); **integrity migration #2** (join RPC, filled_slots trigger, attendance check, crypto share codes); repoint client hooks | Wk 1 migration (build UI against final policies) |
| **3** | Wire Available + Venues + Profile tabs to real hooks; remove demo matches; "My matches" on Home | Wk 2 (profile must exist to test as real user) |
| **4** | MSG91 + DLT template live in Supabase Auth; Turnstile CAPTCHA; real-device OTP test; MSG91 spend alerts. **Milestone: complete loop on a physical phone with a real SIM** | Wks 2–3; DLT approval lead time — **file MSG91 DLT paperwork in week 1**, approval can take 1–2 weeks |
| **5** | FCM device registration + `notification_jobs` table + notify-wave Edge Function ("player needed" push); WhatsApp share on match create | Wk 3 (needs working matches) |
| **6** | Theme consolidation; match-detail rebuild on dark theme; accessibility labels; skeletons/toasts; success-moment on match create | Wks 3–5 (polish only what works) |
| **7** | RLS smoke tests in CI; seed target locality; k6 join-race + nearby load test; PITR/backups enabled; EAS production profiles + store listings (start Play review early — first review is slowest) | Everything above |
| **8** | Closed beta (Play internal track) with one real player group in the seeded locality; fix from Sentry + PostHog funnels; iterate copy/onboarding | Wk 7 |
| **9+** | Public soft launch in that one locality; watch funnel (signup → create → join → attended); Phase 2 decisions **only** from density data | Beta learnings |

**Critical-path dependencies:** DLT/MSG91 approval (start week 1, needed week 4) · Play Store account + review (start week 6, needed week 8) · Apple Developer enrollment if doing iOS at launch (start week 1 — can take days; or **defer iOS entirely**, your doc is Android-first and that's one less store fight).

---

## 6. Cost & Effort Estimate (solo developer)

### Effort

| Phase | Calendar time (full-time solo) | Notes |
|---|---|---|
| Weeks 1–4: security + wiring + auth | ~4 weeks | Mostly connect-the-dots; the hooks/migrations groundwork is done. Biggest unknown: MSG91/DLT bureaucracy, not code. |
| Weeks 5–6: push + polish | ~2 weeks | notify-wave is your first Edge Function — budget a day of Deno learning curve. |
| Weeks 7–8: hardening + beta | ~2 weeks | Testing discipline weeks; resist feature temptation. |
| **To public soft launch** | **~8–9 weeks full-time** (13–16 weeks at ~20 h/wk part-time) | |
| Phase 2 (matching, chat, reliability) | +6–8 weeks, post-validation | Don't schedule until density data exists. |

### Cash (monthly unless noted)

| Item | Cost |
|---|---|
| Supabase Pro | $25/mo (+~$100/mo when you enable PITR; acceptable to defer PITR to launch week) |
| MSG91 — DLT registration | ~₹5,900 one-time + ~₹0.15–0.25/OTP SMS (budget ₹2–5k/mo early; the Turnstile CAPTCHA is what keeps this from exploding) |
| EAS | Free tier is enough pre-launch; $19/mo if build queue slows you |
| Google Play | $25 one-time |
| Apple Developer (if iOS at launch) | $99/yr — **deferrable** |
| Sentry, PostHog, GitHub, Turnstile, UptimeRobot | $0 (free tiers) |
| **Total to launch** | **≈ $75–150 + ₹10–15k one-time, then ≈ $30–60/mo + SMS** until real traffic |

The dominant cost is your ~2 months of time. Everything in this plan is sequenced to protect that: no new services to learn except one small Edge Function, no rewrites, and the security work front-loaded where it's a migration file instead of a post-launch incident.

---

### If you only remember five things

1. `git init` today — you are one disk failure from losing the project.
2. Fix the profiles privacy hole and anon RPC access **before** any stranger installs the app.
3. Wire create-profile first — no user can currently get past sign-up.
4. File MSG91 DLT paperwork in week 1; it's your longest external lead time.
5. Hold your own doc's line: no Redis, no matching engine, no Phase 2 until one locality proves the loop.
