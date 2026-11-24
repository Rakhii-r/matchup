# BRIEFING — 2026-09-04T07:35:00Z

## Mission
Investigate codebase for Geo-Targeted Notifications (ST_DWithin) and user deduplication for push notifications (Requirement R1).

## 🔒 My Identity
- Archetype: explorer
- Roles: survey, read-only investigation, evidence collection, synthesis
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_1
- Original parent: d869b871-3964-442f-8a88-415ded5b71ca
- Milestone: Investigation R1 (Geo-Targeted Notifications & User Deduplication)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Document exact files, lines, database functions/migrations, and recommendations
- No code modification in project source tree

## Current Parent
- Conversation ID: d869b871-3964-442f-8a88-415ded5b71ca
- Updated: 2026-09-04T07:23:07Z

## Investigation State
- **Explored paths**:
  - `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql`
  - `supabase/migrations/20260903090000_squad_only_matchmaking.sql`
  - `supabase/migrations/20260831174915_notification_preferences.sql`
  - `supabase/migrations/20260820120000_area_based_match_creation.sql`
  - `supabase/migrations/20260813133002_open_challenges.sql`
  - `supabase/migrations/20260808084324_push_notifications.sql`
  - `supabase/migrations/20260627063252_phase1_schema.sql`
  - `supabase/functions/notify-wave/index.ts`
  - `src/core/notifications/pushNotifications.ts`
  - `src/core/notifications/PushRegistrar.tsx`
  - `src/features/teams/presentation/useChallenges.ts`
  - `src/features/teams/data/challengeRepository.ts`
  - `app/match/create/details.tsx`
  - `app/teams/offers.tsx`
- **Key findings**:
  - `challenge_offer` notifications are generated strictly in `post_open_challenge` RPC (`supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql`).
  - Spatial filtering is performed using PostGIS `ST_DWithin(tl.loc, c.origin_location, in_radius_m)` in `rank_challenge_candidates`, operating on `geography(Point, 4326)` (meters).
  - Captain deduplication is achieved at two backend tiers: (1) `DISTINCT ON (t.owner_id)` in `rank_challenge_candidates` selecting the single closest team per captain, and (2) `v_notified_users uuid[]` tracking array in `post_open_challenge` ensuring at most one notification is queued per captain.
  - Client-side deduplication exists in `challengeRepository.listMyOffers()` and `app/teams/offers.tsx` using `challenge_id` maps.
- **Unexplored areas**: None within R1 scope; all 5 dispatch questions answered with exact paths and lines.

## Key Decisions Made
- Fully cataloged schema, PostGIS geography functions, notification pipeline (Postgres -> pg_net -> notify-wave -> Expo Push API), and deduplication logic.

## Artifact Index
- DISPATCH.md — turn messages & instructions
- BRIEFING.md — working memory
- progress.md — liveness heartbeat
- handoff.md — final analysis report
