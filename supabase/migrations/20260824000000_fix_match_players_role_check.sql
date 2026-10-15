-- Bug: every accept_open_challenge call fails with a 23514 check-constraint
-- violation, 100% reproducible, confirmed live in production logs.
--
-- match_players_role_check (20260818090000_open_matches.sql, written for the
-- "Post a Match" open-match feature) only allows role IN ('creator', 'player').
-- finalise_challenge (redefined in 20260820120000, 20260823220000,
-- 20260823223500 for the team-challenge/interactive-matchmaking flow) inserts
-- role = 'opponent_captain' for the accepting team's captain — a value the
-- constraint predates and was never widened for. The insert always violates
-- the constraint, the whole finalise_challenge transaction rolls back before
-- it reaches the "Match Confirmed" notification, and the client sees the
-- generic "Some details are invalid" fallback because 23514 carries no
-- specific token the error mapper recognises.
--
-- Fix is the constraint, not the insert: 'opponent_captain' is intentional
-- (see the comment above the two 'creator'/'opponent_captain'/'player'
-- inserts in finalise_challenge) — the schema just never caught up to it.

alter table public.match_players drop constraint if exists match_players_role_check;
alter table public.match_players add constraint match_players_role_check
  check (role in ('creator', 'player', 'opponent_captain'));
