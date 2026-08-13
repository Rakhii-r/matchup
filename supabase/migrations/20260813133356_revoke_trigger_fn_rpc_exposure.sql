-- ============================================================================
-- A trigger function has no business being a REST endpoint.
--
-- push_notifications already closed this for tg_notify_join_requested,
-- tg_notify_membership_status and tg_notify_challenge_received. tg_notify_match_invited
-- was added by open_challenges and inherited Postgres's default EXECUTE grant to
-- PUBLIC, re-opening /rest/v1/rpc/tg_notify_match_invited to the anon role.
--
-- Caught by the Supabase database linter immediately after applying
-- open_challenges — not by review. Worth remembering: every new SECURITY DEFINER
-- function in this schema needs an explicit revoke, because the default is open.
-- ============================================================================

revoke execute on function public.tg_notify_match_invited() from anon, authenticated, public;
