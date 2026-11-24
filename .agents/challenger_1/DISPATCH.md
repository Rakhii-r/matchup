# Dispatch: Challenger 1 (Empirical & Adversarial Verification)

## Objective
Empirically verify correctness, edge cases, and robustness of the Geospatial Play-Zone Targeting and Single-Card Offers Deduplication.

## Sources of Truth
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\PROJECT.md`
- `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\TEST_READY.md`

## Focus Areas & Adversarial Testing
1. **Play-Zone Radius Boundaries**:
   - Test recipient exactly at boundary distance (distance == radius) vs strictly outside (distance == radius + 1m).
   - Test null squad coordinates / null profile location: verify 0 notifications.
2. **Captain Deduplication Under Pressure**:
   - Simulate a captain with 2, 5, 10 squads all within radius of a posted challenge.
   - Verify that `rank_challenge_candidates` returns ONLY 1 candidate row for that captain (the closest).
   - Verify that `post_open_challenge` calls `enqueue_notification` strictly once for that captain.
   - Verify that `listMyOffers()` and `OffersScreen` display strictly 1 card.
3. **Decline & Zombie Offer Prevention**:
   - Decline an offer and verify that all candidate rows owned by that captain for that fixture are declined.
4. **Run Test Suites**:
   - Inspect and execute tests in `tests/` and `supabase/tests/`.

## Output Requirements
- Write your handoff report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_1\handoff.md` with your explicit verdict: `APPROVE` or `REJECT`.

## 2026-09-04T08:02:47Z
You are Challenger 1. Your working directory is c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_1.
Read your instructions in c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_1\DISPATCH.md, c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\PROJECT.md, and c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md.
Empirically and adversarially test geospatial play-zone boundaries and single-card offers deduplication. Run test suites.
Write your report and explicit verdict (APPROVE or REJECT) to c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\challenger_1\handoff.md. When done, send a message to parent with your summary.
