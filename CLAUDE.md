# MatchUp — Project Context for Claude Code

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
- **Backend:** Supabase — Auth (phone OTP: **dev = Twilio Verify SMS + test phone numbers**; production = MSG91 with DLT via Jio TrueConnect, swap is config-only), Postgres + PostGIS, Realtime, Storage, Edge Functions
- **Session storage:** expo-secure-store (NEVER AsyncStorage in plaintext)
- **Push:** Firebase Cloud Messaging (via expo-notifications)
- **Analytics/crash:** PostHog + Sentry · **Builds:** EAS

## Architecture rules

- Clean Architecture per feature: `presentation → domain → data`. Dependencies point inward.
  UI never imports the Supabase client directly — it goes through a repository.
- The client is untrusted. All access control is enforced by Postgres **RLS** and Edge Functions.
- No `TODO`/placeholder code, no empty catch blocks. Handle every error path.
- Explicit typing; no `any` without a justified comment. Treat all external input as nullable.
- Always paginate lists. Clean up subscriptions/timers on unmount.

## Folder map

```
app/          Expo Router routes only (screens)
src/features/ feature modules (auth, profile, matches, players, attendance,
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

## NOT in Phase 1 (do not build yet)

Matching engine · match chat · computed reliability score · live venue availability ·
feed algorithm · Redis. These are Phase 2/3 — their folders exist but stay empty.

## Commands

- `npm start` / `npm run android` / `npm run ios`
- `npm run typecheck` · `npm run lint`
- DB types: `npm run db:types` (requires Supabase CLI + local stack)
