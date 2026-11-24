# Original User Request

## 2026-09-04T07:19:37Z

Deliver geospatial play-zone push notification targeting and public in-app match discovery across the MatchUp app and backend.

Working directory: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
Integrity mode: development

## Requirements

### R1. Geo-Targeted Notifications (`ST_DWithin`)
- When a game is created or a challenge is posted, pop-up / push notifications (`challenge_offer`) must strictly target only nearby players / team captains whose registered location falls within the designated play zone radius (`ST_DWithin(team_location, origin_location, radius_m)`).
- Notifications must be sent strictly once per distinct user/captain (no multiple notification spam for users with multiple squads).

### R2. Global In-App Match Viewing
- Matches and open fixtures in the app feed / Games tab must be discoverable and viewable by all users across the app without restricting browse visibility, allowing players everywhere to view game details.

### R3. User-Level Match Offers Deduplication
- Game offers in the "Game Offers" screen must display as a single card per match fixture (deduplicated by `challenge_id`), allowing captains to manage their challenges cleanly without duplicate cards for every squad they created.

## Acceptance Criteria

### Notification Filtering
- [ ] Only captains within the match radius receive `challenge_offer` notifications.
- [ ] Users owning multiple squads receive at most one push notification per match fixture.

### Match Discovery & Offers
- [ ] Any user can browse and view open matches on the Games / Explore tab.
- [ ] Each match fixture renders as exactly one card in the Game Offers screen.
- [ ] TypeScript compilation (`npx tsc --noEmit`) passes with 0 errors.
