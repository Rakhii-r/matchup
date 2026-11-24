# Dispatch to Explorer 1 (Survey: Geo-Targeted Notifications & Deduplication)

## Objective
Investigate the codebase for Geo-Targeted Notifications (`ST_DWithin`) and User Deduplication for push notifications (Requirement R1).

## Scope Boundaries
- Read-only investigation. DO NOT modify any code.
- Focus on:
  1. Where are games/fixtures created and challenges posted?
  2. Where are push notifications / pop-up notifications (specifically `challenge_offer`) sent?
  3. Where are queries for recipient captains/players made? Is PostGIS / `ST_DWithin` used or available in the database / Supabase / backend? What are the exact table and column names (`team_location`, `origin_location`, `radius_m`, squads, profiles, users)?
  4. How are captains associated with squads, and how can notification recipient queries be deduplicated by user/captain ID so that captains owning multiple squads receive at most one notification per match fixture?
  5. What are the dependencies, edge cases, and file paths involved?

## Relevant Context
- Workspace: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup
- User Request: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md

## Output Requirements
- Write your comprehensive findings to:
  `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_1\handoff.md`
- Include exact file paths, line numbers, function signatures, database schemas/RPCs/queries, and concrete recommendations.

## 2026-09-04T07:23:07Z
You are Explorer 1. Your working directory is c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_1.
Read your instructions in c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_1\DISPATCH.md and c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\orchestrator\ORIGINAL_REQUEST.md.
Investigate the codebase for Geo-Targeted Notifications (ST_DWithin) and user deduplication for push notifications (Requirement R1).
Document exact files, lines, database functions/migrations, and recommendations in c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_1\handoff.md. When done, send a message to parent with your summary.

