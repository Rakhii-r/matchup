# BRIEFING — 2026-09-04T07:29:00Z

## Mission
Investigate the codebase for Global In-App Match Viewing across the MatchUp app and backend (Requirement R2).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_2
- Original parent: d869b871-3964-442f-8a88-415ded5b71ca
- Milestone: survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Deliver findings in handoff.md with 5 components: Observation, Logic Chain, Caveats, Conclusion, Verification Method
- Communicate results back to caller via send_message

## Current Parent
- Conversation ID: d869b871-3964-442f-8a88-415ded5b71ca
- Updated: 2026-09-04T07:29:00Z

## Investigation State
- **Explored paths**:
  - `app/(tabs)/matches.tsx` (Games tab screen)
  - `app/(tabs)/index.tsx` (Home screen feed)
  - `app/matches.tsx` (redirect route)
  - `app/(tabs)/_layout.tsx` (tab bar routes)
  - `app/match/[id]/index.tsx` (Match detail screen)
  - `src/features/matches/presentation/useMatches.ts`
  - `src/features/matches/data/matchRepository.ts`
  - `src/features/teams/presentation/useChallenges.ts`
  - `src/features/teams/presentation/useActiveTeamFormat.ts`
  - `src/features/teams/data/challengeRepository.ts`
  - `src/features/teams/presentation/MatchOfferDetailModal.tsx`
  - `supabase/migrations/20260818090000_open_matches.sql` (`nearby_matches`)
  - `supabase/migrations/20260903090000_squad_only_matchmaking.sql` (`list_open_challenges_nearby`)
  - `supabase/migrations/20260803123152_security_hardening.sql` (RLS policies)
- **Key findings**:
  - Gating Barrier 1: Missing GPS/location coordinates disables `useNearbyMatches` (`enabled: coords != null`) and renders a blocking notice on `app/(tabs)/matches.tsx:846–851` and `app/(tabs)/index.tsx:1075–1095`.
  - Gating Barrier 2: `nearby_matches` RPC forces `ST_DWithin(m.location, ..., in_radius_m)` and `m.search_radius_m`, hiding matches beyond the radius or beyond the creator's play zone.
  - Gating Barrier 3: Squad ownership lock: `useNearbyOpenChallenges` has `enabled: teamSize != null`, `challengeRepository` returns `[]` if `teamSize == null`, `list_open_challenges_nearby` returns empty if `in_team_size is null`, and `app/(tabs)/matches.tsx:699` completely hides open challenges if `activeFormat.reason === 'no_team'`.
  - Solution: Make coordinates and distance optional in `nearby_matches` RPC; remove `coords != null` disablement from `useNearbyMatches`; add "All" distance chip; make `in_team_size` optional in `list_open_challenges_nearby` and remove `teamSize != null` gating so all users can discover open fixtures and view details.
- **Unexplored areas**: None for R2. Survey complete.

## Key Decisions Made
- Fully documented 5-component survey report in `handoff.md`. Ready to communicate findings to parent orchestrator.

## Artifact Index
- DISPATCH.md — dispatch instructions and prompts
- BRIEFING.md — situational awareness
- progress.md — liveness heartbeat
- handoff.md — final survey report
