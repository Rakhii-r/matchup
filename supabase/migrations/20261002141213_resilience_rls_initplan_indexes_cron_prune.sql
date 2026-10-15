-- ============================================================================
-- Resilience pass: RLS init-plans, hot-path FK indexes, cron history retention.
--
-- 1. RLS. A bare function call in a policy is evaluated once PER ROW; wrapped in
--    a scalar subquery Postgres evaluates it once per statement (an InitPlan).
--    profiles_admin_* called the SECURITY DEFINER is_admin() for every candidate
--    row, which is why a profile-by-id read averaged 134 ms on a 10-row table.
-- 2. Indexes. Only the foreign keys that sit on a read path the app actually
--    runs: the notifications inbox and its Realtime filter (user_id), the
--    player-stats RPCs (striker_id, bowler_id, motm_user_id), captain chat
--    (recipient_id), and challenge ownership checks (created_by, challenge_id).
-- 3. cron.job_run_details is never pruned by pg_cron itself. Two per-minute
--    jobs had grown it to 158k rows in three months.
--
-- Every statement is idempotent.
-- ============================================================================

alter policy profiles_admin_select on public.profiles
  using ((select public.is_admin()));

alter policy profiles_admin_update on public.profiles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy captain_chat_select on public.captain_chat_messages
  using (
    (((select auth.uid()) = sender_id) or ((select auth.uid()) = recipient_id))
    and (not public.is_blocked_between(sender_id, recipient_id))
  );

create index if not exists notification_jobs_user_idx
  on public.notification_jobs (user_id, created_at desc);
create index if not exists matches_challenge_idx
  on public.matches (challenge_id) where challenge_id is not null;
create index if not exists matches_motm_idx
  on public.matches (motm_user_id) where motm_user_id is not null;
create index if not exists deliveries_striker_idx
  on public.deliveries (striker_id);
create index if not exists deliveries_bowler_idx
  on public.deliveries (bowler_id);
create index if not exists captain_chat_recipient_idx
  on public.captain_chat_messages (recipient_id);
create index if not exists team_challenges_created_by_idx
  on public.team_challenges (created_by);

select cron.schedule(
  'prune-cron-history',
  '17 3 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '7 days'$cron$
);
