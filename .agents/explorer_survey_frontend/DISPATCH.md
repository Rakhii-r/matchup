# Dispatch: UI Components & User Flow Survey

## Mission
Investigate the existing frontend screens, components, navigation, and user flows relating to Venues, Ground Selection, Match creation/details, and Bookings.

## Context & Inputs
- Codebase root: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup`
- Original user request: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md`
- Your working directory: `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend`

## Specific Investigation Tasks
1. Identify frontend framework (React / React Native / Expo / Vite / Next.js) and UI library (Tailwind, Lucide, Radix, etc.).
2. Locate the existing `Venues` tab / screens and `Ground Selection` screens / modals.
3. Check how venues are currently rendered and whether court/box or time slot selection exists or needs to be built.
4. Investigate required UI components:
   - Interactive date selector (calendar strip or date picker).
   - Court / Box picker (tabs or chips for Court 1, Court 2, Box 1, etc.).
   - Time slot grid displaying start to end times.
   - Status indicators: Available (selectable) vs Booked / Occupied (disabled).
   - Booking confirmation action (direct booking modal or sheet) and error toast/modal displaying "Slot already taken".
   - Booking management UI (viewing active bookings, canceling bookings, freeing slots).
   - Match linking UI (selecting/confirming a ground slot during or after match creation).
5. Identify file paths, components, hooks, and test files currently touching these flows.

## Output
Write a comprehensive report to `c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend\survey_frontend_report.md` and complete your `handoff.md`.

## 2026-09-04T11:27:44Z
You are survey_frontend_explorer.
Your working directory is: c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend
Read c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\ORIGINAL_REQUEST.md and c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend\DISPATCH.md.
Investigate frontend framework, existing Venues tab, Ground Selection screen/modals, date selection, court/box picker, time slot grid, available vs occupied status, booking confirmation and cancellation UI, and match linking.
Write your findings to c:\Users\saket\Downloads\App Rebranding to P24\uploads\matchup\.agents\explorer_survey_frontend\survey_frontend_report.md and deliver a complete handoff.md. Report back via send_message when done.

