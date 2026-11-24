# Dispatch: Challenger 2 (Global Discovery & Concurrency Testing)

## Objective
Empirically verify correctness, edge cases, and robustness of Global In-App Match Viewing and public fixture discovery across feeds and screens.

## Sources of Truth
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\PROJECT.md`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\TEST_READY.md`

## Focus Areas & Adversarial Testing
1. **Global Discovery Without GPS / Location**:
   - Device with GPS disabled / permissions denied (`coords == null`):
     - Verify `nearby_matches(null, null, null, null)` returns all upcoming open matches sorted by `scheduled_at`.
     - Verify Games tab (`matches.tsx`) renders the match cards cleanly with non-blocking informational chip.
     - Verify Home feed (`index.tsx`) renders global matches without blocking placeholder.
2. **Squad-Less Fixture Discovery**:
   - User with 0 squads (`activeFormat.reason === 'no_team'`):
     - Verify `list_open_challenges_nearby(null, null, null, null, null)` returns open fixtures.
     - Verify open challenges rail renders in `matches.tsx` and `index.tsx`.
     - Verify tapping "⚡ Challenge Team" guides the user to `/teams/create`.
3. **Creator Search Radius Non-Interference**:
   - Verify that when creator posts with 5km radius, an out-of-radius player (> 50km away) can still view and discover the match globally.
4. **Run Test Suites**:
   - Inspect and execute tests in `tests/` and `supabase/tests/`.

## Output Requirements
- Write your handoff report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_2\handoff.md` with your explicit verdict: `APPROVE` or `REJECT`.

## 2026-09-04T08:02:47Z
You are Challenger 2. Your working directory is c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_2.
Read your instructions in c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_2\DISPATCH.md, c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\PROJECT.md, and c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md.
Empirically and adversarially test global discovery without GPS, squad-less fixture browsing, and creator radius non-interference. Run test suites.
Write your report and explicit verdict (APPROVE or REJECT) to c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_2\handoff.md. When done, send a message to parent with your summary.

