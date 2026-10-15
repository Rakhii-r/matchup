-- notify-wave has been answering the cron with 403 Forbidden every minute since
-- 2026-08-13. Nothing was ever delivered; 538 jobs sat pending with attempts = 0,
-- which is the tell that claim_notification_jobs was never reached.
--
-- The cause was two copies of one secret that have to stay byte-identical:
--   * dispatch_notification_jobs sends vault secret `notify_wave_service_key`
--   * the function compared it to its own `SUPABASE_SERVICE_ROLE_KEY` env var,
--     which the platform injects and can rotate (and, on projects moved to the
--     new API key scheme, is no longer the same JWT at all).
-- When those drifted apart the guard rejected the only caller that is supposed
-- to get through, silently, forever -- the failure had no log line and no
-- attempts counter, so nothing surfaced it.
--
-- Fix: one source of truth. The vault row IS the shared secret. The function no
-- longer keeps its own copy; it asks the database whether the bearer token it
-- was handed matches, and the database is also what the dispatcher reads from,
-- so the two can no longer drift.
--
-- The secret never leaves the vault -- this returns a boolean, not the value --
-- and only service_role may call it, so an ordinary signed-in user cannot use it
-- as an oracle to guess the token.
create or replace function public.verify_notify_wave_caller(in_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'notify_wave_service_key'
       and s.decrypted_secret is not null
       and in_token is not null
       and s.decrypted_secret = in_token
  );
$function$;

revoke execute on function public.verify_notify_wave_caller(text) from public;
revoke execute on function public.verify_notify_wave_caller(text) from anon;
revoke execute on function public.verify_notify_wave_caller(text) from authenticated;
grant execute on function public.verify_notify_wave_caller(text) to service_role;
