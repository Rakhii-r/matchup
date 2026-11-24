# BRIEFING — 2026-09-04T15:14:00Z

## Mission
Complete screen integration, match linking, and booking management flows across target files for Milestone 4.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\worker_m4_complete
- Original parent: 39fd5516-7541-4661-805e-81e28a2af962
- Milestone: M4

## 🔒 Key Constraints
- DO NOT CHEAT. All implementations must be genuine.
- Verify `npx tsc --noEmit` passes with 0 errors.
- Ensure all E2E tests pass.
- Minimal change principle.
- Deliver `handoff.md` and use `send_message` when done.

## Current Parent
- Conversation ID: 39fd5516-7541-4661-805e-81e28a2af962
- Updated: 2026-09-04T15:14:00Z

## Task Summary
- **What to build**:
  1. Verify/polish `src/features/venues/presentation/MyBookingsModal.tsx`
  2. `app/(tabs)/venues.tsx` ("Book Court" CTA + "My Bookings" header action)
  3. `app/match/[id]/venue.tsx` (match ground selection with court/slot picker)
  4. `app/match/[id]/index.tsx` (display confirmed court & slot, cancel ground booking)
  5. `app/admin/venues.tsx` (operating hours start/end, slot duration, courts count)
- **Success criteria**:
  - `npx tsc --noEmit` has 0 errors.
  - All E2E tests pass (`npx tsx tests/e2e/run_e2e_tests.ts`).
- **Interface contracts**: `PROJECT.md`
- **Code layout**: `PROJECT.md`

## Change Tracker
- **Files modified**: none yet
- **Build status**: pending
- **Pending issues**: none

## Quality Status
- **Build/test result**: pending
- **Lint status**: pending
- **Tests added/modified**: pending

## Loaded Skills
- None required yet

## Key Decisions Made
- Inspect all current target files before making any modifications.
