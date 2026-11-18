-- finalise_challenge creates the match and seats both captains, but checks
-- nothing about its caller: respond_to_challenge and accept_open_challenge do
-- that before calling it. It was still executable by `authenticated`, so any
-- signed-in user could call /rest/v1/rpc/finalise_challenge with any challenge
-- and any team and force a fixture onto another squad.
--
-- Both callers are SECURITY DEFINER owned by postgres, so they keep EXECUTE.
-- The app never calls it directly.
-- Applied to the live project on 14 Nov 2026.

revoke execute on function public.finalise_challenge(uuid, uuid) from authenticated;
