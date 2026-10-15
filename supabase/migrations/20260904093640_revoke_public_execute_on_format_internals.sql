-- Follow-up to 20260904092956_squad_only_matchmaking.
--
-- `revoke ... from anon, authenticated` does NOT remove the PUBLIC grant that
-- Postgres gives every new function by default, and anon/authenticated both
-- inherit PUBLIC. The security advisor caught the result: the three trigger
-- functions and the two format helpers were still listed as anon-executable
-- even though the migration revoked them by name. Same class the repo already
-- fixed once, in 20260813133356_revoke_trigger_fn_rpc_exposure.
--
-- Revoking from PUBLIC is the only revoke that actually closes it. Explicit
-- grants are re-issued after, because revoking PUBLIC does not touch them but
-- it keeps the intent readable at the call site.

-- Trigger functions: never callable as an RPC, by anyone but the owner.
revoke execute on function public.assert_squad_big_enough() from public;
revoke execute on function public.assert_opponent_squad_on_accept() from public;
revoke execute on function public.assert_applicant_squad_big_enough() from public;

-- Internal helpers: read by other SECURITY DEFINER functions, not by clients.
-- team_format_matches is SECURITY DEFINER over teams, so a public grant leaks
-- one team's declared format to anyone who can guess a uuid.
revoke execute on function public.team_format_matches(uuid, integer) from public;

-- challenge_format is pure arithmetic on an argument and touches no table, so
-- authenticated may keep it; PUBLIC (i.e. anon) may not.
revoke execute on function public.challenge_format(integer) from public;
grant  execute on function public.challenge_format(integer) to authenticated;

-- A write path that was relying on its own NOT_AUTHENTICATED check to stand in
-- for a grant. Belt and braces: anon cannot reach it at all now.
revoke execute on function public.set_team_target_size(uuid, integer) from public;
grant  execute on function public.set_team_target_size(uuid, integer) to authenticated;

-- Pre-existing, same defect, same fix while we are here.
revoke execute on function public.squad_meets_size(uuid, integer) from public;
