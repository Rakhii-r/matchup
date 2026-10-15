-- Captain chat: drop the table privileges no client should hold.
--
-- 20260830090000 revoked INSERT/UPDATE/DELETE on captain_chat_messages so every
-- write goes through send_captain_message / mark_chat_read. It left TRUNCATE,
-- REFERENCES and TRIGGER granted to `anon` and `authenticated` -- the default
-- grants a table is born with.
--
-- TRUNCATE is the one that matters: row-level security does not apply to it, so
-- a role holding the privilege can empty the table whatever the policies say.
-- PostgREST exposes no TRUNCATE verb, so this was not reachable through the
-- app's API; it is revoked so that stays true if anything else ever connects as
-- one of these roles.
--
-- SELECT is deliberately kept for `authenticated`: Realtime needs it, and the
-- inbox reads the table directly under the captain_chat_select policy.

revoke truncate, references, trigger on table public.captain_chat_messages from anon, authenticated;

-- `anon` has no reason to read chat at all. The select policy already returns
-- nothing without a session; this removes the grant as well.
revoke select on table public.captain_chat_messages from anon;
