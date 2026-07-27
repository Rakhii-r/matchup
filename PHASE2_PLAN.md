# MatchUp — Phase 2 Plan (Match-day)

**Date:** 16 July 2026 · **Basis:** `MatchUp_Phase2_Requirements.docx` / `_Development.docx`, current repo state, `AUDIT_REPORT.md` (5 Jul), `PRODUCTION_PLAN.md` (13 Jul).

## 0. Gate check first — Phase 2 is not yet justified

Both `MatchUp_Phase2_Requirements.docx` ("Phase 2 is not justified until real density exists") and your own `PRODUCTION_PLAN.md` are explicit: Phase 2 starts only after the Phase 1 loop actually works for a stranger, end to end. I re-checked the live code against the audit, and the core blockers are still open:

- **B1 — Sign-up dead-end still exists.** `app/(auth)/create-profile.tsx` still does `onPress={() => router.back()}` on the "Ready to Play" CTA. It never calls the existing `useCreateProfile` hook. A new user still cannot enter the app.
- **B2/B3/B4 — Available, Venues, Profile tabs are still hardcoded mockups.** `available.tsx`, `venues.tsx`, `profile.tsx` all read from local fake arrays (`PLAYERS`, `VENUES`, `RELIABILITY = 98`), not `useSetAvailable`/`useNearbyAvailable`, `useVenues`, or `useAuthStore`.
- **B6 — Demo matches still render as real** (`demoMatches.ts` imported into `app/(tabs)/index.tsx`).
- **Integrity migration #2 not applied** — no `join_match` locking RPC exists in `supabase/migrations/`, `filled_slots` is still unmaintained (no trigger), attendance-restriction-to-players fix not present.
- **No "My matches" surface** — no query for `creator_id = me` on Home.
- **`notify-wave` / FCM never built** — `supabase/functions/` doesn't exist yet; `devices` table has no consuming code.
- **Git is not actually initialized** — `.git/` exists but is empty (no commits). You're still one disk failure from losing the project.

What **is** done: the `0006_security_hardening.sql` migration landed — `public_profiles` view, anon EXECUTE revoked, `is_active` enforcement, length CHECKs, the `auth.uid()` perf rewrite, `set_updated_at` search_path fix. That's Week 1 of your own `PRODUCTION_PLAN.md`. Weeks 2–4 (wire the app, integrity RPC, MSG91/Turnstile) have not started.

**Recommendation:** spend 2–3 weeks closing B1/B2/B3/B4/B6 + the integrity migration + "My matches" + real git history before touching Phase 2 code. Phase 2 chat, matching, and reliability score are worthless if the app they're bolted onto still dead-ends at sign-up — and reliability score specifically needs real attendance data from a working loop to mean anything. This isn't a detour from Phase 2, it's the precondition your own docs set for it.

The plan below assumes you'll close that gap first, then gives you the full Phase 2 build sequenced against your actual codebase.

## 1. Phase 2 scope (from `MatchUp_Phase2_Requirements.docx`)

Adds, without touching the Phase 1 spine: a deterministic matching engine (FR-201), day-of confirmation (FR-202), match-scoped chat (FR-203), a server-side digital toss (FR-204), waiting-list auto-promotion (FR-205), a computed reliability score (FR-206) + match history (FR-207), and opt-in live venue availability (FR-208).

Explicitly not in Phase 2 (stays Phase 3, folders stay empty): ball-by-ball scoring, gamification, social feed/friend graph, AI recommendations, Redis/BullMQ.

## 2. Data model additions needed

None of these tables exist yet in `supabase/migrations/` — all six are net-new:

| Table / column | Purpose | RLS rule |
|---|---|---|
| `profiles.reliability_score` (nullable numeric) | Computed trust signal | No client write policy at all — only `compute-reliability` Edge Function (service role) |
| `match_confirmations` | Day-of RSVP, separate from Phase 1 approval | Own row only |
| `waiting_list` | Backfill queue, ordered position | Read own row/position; only matchmaking/notify-wave functions update status |
| `match_chat_messages` | Match-scoped chat | Confirmed participants only; blocked pairs can't read each other |
| `match_results` | Digital toss outcome | Readable by participants; writable only by `digital-toss` function |
| `venue_availability` | Optional live slot count | Readable by all; writable by venue owner or booking function only |

## 3. Folder changes (per `MatchUp_Phase2_Development.docx` §9, mapped to your actual tree)

```
src/features/
  matchmaking/   NEW — doesn't exist yet. ranking client, useSuggestedMatches hook
  chat/          NEW — doesn't exist yet. chat repository, useMatchChat hook, message list UI
  reliability/   NEW — doesn't exist yet. read-only client for profiles.reliability_score
  matches/       EXTEND existing — confirmation, waiting-list, toss result on match detail
  venues/        EXTEND existing — live-availability rendering branch (single component, two states)
  scoring/       still empty — Phase 3
  gamification/  still empty — Phase 3
  feed/          still empty — Phase 3
```

`src/core/` is also missing `notifications`, `network`, `realtime`, and `di` — the audit flagged this against your own `CLAUDE.md` folder map. Phase 2's Realtime Broadcast channels (chat, toss) and the confirmation push reminders need a real `src/core/realtime` and `src/core/notifications` layer; right now nothing in `core/` handles either.

## 4. Sprint plan (~7 weeks, unchanged from your Development doc, sequenced against current gaps)

**Sprint 7 — Reliability score & match history (~1.5wk)**
Migration: `profiles.reliability_score`, no client write policy. `compute-reliability` Edge Function triggered on attendance insert/update + nightly sweep. Paginated match history screen over `matches`/`attendance`. PostHog: `reliability_score_computed`, `match_history_viewed`.
*Depends on real attendance data existing — i.e., the Phase 1 loop actually running.*

**Sprint 8 — Matching engine (~1.5wk)**
`matchmaking` Edge Function implementing `score = w1·proximity + w2·reliability_signal + w3·recency_boost`. New `src/features/matchmaking` module, `useSuggestedMatches` hook, "Suggested for you" section above the existing browse list (additive). PostHog: `suggestion_shown/accepted/ignored`.

**Sprint 9 — Confirmation & waiting list (~1.5wk)**
Migrations: `match_confirmations`, `waiting_list`. Reminder push + confirm/decline on match detail. Extend a `notify-wave` function (this still needs to be built first per Phase 1 — see gate check) with the promotion sequence. Concurrency test: two promotions racing for one freed slot never double-book.

**Sprint 10 — Match chat & digital toss (~1.5wk)**
Migrations: `match_chat_messages`, `match_results`. New `src/features/chat` module; Realtime Broadcast channel per `match_id`, torn down on unmount (same `channelManager` pattern as Phase 1's availability presence channel — confirm that pattern actually exists before reusing it). `digital-toss` Edge Function using crypto-secure randomness, idempotent per match. Extend Phase 1 report flow to cover chat messages.

**Sprint 11 — Live venue availability, harden, ship (~1wk)**
Migration: `venue_availability`, RLS scoped to venue owner. Venue directory UI branch (live vs. call-to-confirm). Full regression pass confirming no Phase 1 behavior changed. Extend PostHog/Sentry to new screens/functions.

## 5. Definition of Done (from your own docs — don't skip)

Every new table has RLS enabled with a denied-access test proving cross-user and client-write restrictions hold. Matching, confirmation, chat, toss, reliability, and waiting list all work end to end on both platforms. No Phase 1 acceptance test regresses. At least one pilot venue has live availability wired end to end. Reliability score has zero incidents of client-side manipulation.

## 6. Suggested immediate next step

Given the gate-check findings, the highest-leverage next session is closing B1 (wire `create-profile` to `useCreateProfile`) — nothing else in Phase 1 or 2 matters while sign-up is a dead end. Say the word and I'll wire it directly.
