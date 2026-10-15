-- ============================================================================
-- Realtime Subscriptions for Push/Popups, Match Requests & Challenges
-- ============================================================================

-- 1. Enable RLS and add SELECT policy for notification_jobs so users can read and receive realtime push notifications
alter table public.notification_jobs enable row level security;

drop policy if exists "notification_jobs_select" on public.notification_jobs;
create policy "notification_jobs_select" on public.notification_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 2. Add challenge_candidates, team_challenges, and notification_jobs to supabase_realtime publication
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'challenge_candidates'
  ) then
    alter publication supabase_realtime add table public.challenge_candidates;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_challenges'
  ) then
    alter publication supabase_realtime add table public.team_challenges;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_jobs'
  ) then
    alter publication supabase_realtime add table public.notification_jobs;
  end if;
end $$;
