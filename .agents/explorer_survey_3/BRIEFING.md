# BRIEFING — 2026-09-04T07:29:45Z

## Mission
Investigate User-Level Match Offers Deduplication in the Game Offers screen (Requirement R3) across codebase.

## 🔒 My Identity
- Archetype: explorer
- Roles: survey, codebase investigation, evidence collection
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_3
- Original parent: d869b871-3964-442f-8a88-415ded5b71ca
- Milestone: survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Scope strictly on Game Offers screen / component, challenge offers retrieval, deduplication by challenge_id / fixture ID, card rendering logic, and action preservation (accept/decline/details)
- Document exact file paths, line numbers, function signatures, queries, and concrete recommendations in handoff.md

## Current Parent
- Conversation ID: d869b871-3964-442f-8a88-415ded5b71ca
- Updated: 2026-09-04T07:23:00Z

## Investigation State
- **Explored paths**:
  - `app/teams/offers.tsx`: Game offers screen, incoming/outgoing modes, card rendering, actions
  - `src/features/teams/data/challengeRepository.ts`: `listMyOffers()`, `declineOpen()`, deduplication map
  - `src/features/teams/presentation/useChallenges.ts`: `useMyOffers()` hook
  - `src/features/teams/domain/challengeSchema.ts`: `OpenOffer` domain schema
  - `app/(tabs)/teams.tsx`: Route entry point to `/teams/offers`
  - `app/match/create/searching.tsx`: Live radar search screen, match offers section, and offer counts
  - `supabase/migrations/20260904124000_deduplicate_offers_and_notifications_per_user.sql`: `rank_challenge_candidates` with `DISTINCT ON (t.owner_id)` and notification deduplication
  - `supabase/migrations/20260823220000_match_offers_request_flow.sql`: `apply_to_open_challenge`, `decline_open_challenge`
- **Key findings**:
  - Root cause of duplicate cards: multiple squad ownership combined with non-deduplicated candidate ranking in Postgres and querying all member teams in `listMyOffers()`.
  - Tri-layer deduplication established: DB (`rank_challenge_candidates` DISTINCT ON owner), repository (`challengeRepository.listMyOffers()`), and presentation (`app/teams/offers.tsx` `dedupedIncomingOffers`).
  - Status precedence rule correctly retains `'interested'` over `'offered'`.
  - Identified 4 subtle caveats: FlatList keyExtractor should key on `challenge_id`, `decline_open_challenge` should cascade decline to all user squads to prevent zombie offers, non-open challenges should be filtered out, and badge count in searching screen verified synchronized.
- **Unexplored areas**: None, survey complete.

## Key Decisions Made
- Completed survey for Requirement R3 and documented in handoff.md.

## Artifact Index
- DISPATCH.md — task assignment and prompts
- BRIEFING.md — persistent situational awareness
- progress.md — liveness heartbeat
- handoff.md — structured handoff report
