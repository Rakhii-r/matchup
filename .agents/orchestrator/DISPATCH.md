## 2026-09-04T07:22:00Z

You are the Project Orchestrator for the following project:

Workspace Directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Original Request: Read C:\Users\saket\.gemini\antigravity\brain\7d5c494a-1f33-4ba3-ba36-5ed3924bcdb6\ORIGINAL_REQUEST.md

Mission:
Deliver geospatial play-zone push notification targeting and public in-app match discovery across the MatchUp app and backend.

Requirements:
1. Geo-Targeted Notifications (ST_DWithin):
- When a game is created or a challenge is posted, pop-up / push notifications (challenge_offer) must strictly target only nearby players / team captains whose registered location falls within the designated play zone radius (ST_DWithin(team_location, origin_location, radius_m)).
- Notifications must be sent strictly once per distinct user/captain (no multiple notification spam for users with multiple squads).

2. Global In-App Match Viewing:
- Matches and open fixtures in the app feed / Games tab must be discoverable and viewable by all users across the app without restricting browse visibility, allowing players everywhere to view game details.

3. User-Level Match Offers Deduplication:
- Game offers in the "Game Offers" screen must display as a single card per match fixture (deduplicated by challenge_id), allowing captains to manage their challenges cleanly without duplicate cards for every squad they created.

Acceptance Criteria:
- Only captains within the match radius receive challenge_offer notifications.
- Users owning multiple squads receive at most one push notification per match fixture.
- Any user can browse and view open matches on the Games / Explore tab.
- Each match fixture renders as exactly one card in the Game Offers screen.
- TypeScript compilation (npx tsc --noEmit) passes with 0 errors.

Maintain progress.md and BRIEFING.md in your working directory. Regularly update progress.md so progress can be monitored. When finished and verified, report completion back to the Sentinel.
