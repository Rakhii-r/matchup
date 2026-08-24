-- ============================================================================
-- Activity Notifications & Pending Actions RPCs
-- ============================================================================

-- 1. list_my_notifications — Returns delivered push notification history
create or replace function public.list_my_notifications(in_limit integer default 50)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  route text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id,
    j.kind,
    j.title,
    j.body,
    (j.data->>'route')::text as route,
    j.created_at
  from public.notification_jobs j
  where j.user_id = (select auth.uid())
  order by j.created_at desc
  limit coalesce(in_limit, 50);
$$;

revoke execute on function public.list_my_notifications(integer) from anon, public;
grant  execute on function public.list_my_notifications(integer) to authenticated;

-- 2. get_my_pending_actions — Drives Activity "Needs Your Attention" and notification badge
create or replace function public.get_my_pending_actions()
returns table (
  kind text,
  title text,
  subtitle text,
  route text,
  urgency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return;
  end if;

  -- 1. Incoming match requests for the host captain's open challenges
  return query
  select
    'match_request'::text as kind,
    'Match Request from ' || applicant.name as title,
    'Opponent squad wants to play ' || c.match_name || ' (' || coalesce(c.area_name, 'Local Area') || ')' as subtitle,
    ('/match/create/searching?challengeId=' || c.id::text)::text as route,
    'high'::text as urgency
  from public.team_challenges c
  join public.teams host_team on host_team.id = c.from_team_id
  join public.challenge_candidates cc on cc.challenge_id = c.id
  join public.teams applicant on applicant.id = cc.team_id
  where (c.created_by = v_uid or host_team.owner_id = v_uid)
    and c.status = 'open'
    and cc.status = 'interested'
  order by cc.responded_at desc;

  -- 2. Direct match offers to candidate teams
  return query
  select
    'match_offer'::text as kind,
    'Match Offer from ' || host_team.name as title,
    'Challenged your squad for ' || c.match_name || ' (' || coalesce(c.area_name, 'Local Area') || ')' as subtitle,
    ('/teams/offers')::text as route,
    'medium'::text as urgency
  from public.challenge_candidates cc
  join public.team_challenges c on c.id = cc.challenge_id
  join public.teams host_team on host_team.id = c.from_team_id
  join public.teams my_team on my_team.id = cc.team_id
  where my_team.owner_id = v_uid
    and c.status = 'open'
    and cc.status = 'offered'
  order by cc.created_at desc;

  -- 3. Match player invites awaiting confirmation
  return query
  select
    'match_invite'::text as kind,
    'Match Invitation: ' || m.match_name as title,
    'You are invited to play on ' || to_char(m.scheduled_at, 'DD Mon, HH12:MI AM') as subtitle,
    ('/match/' || m.id::text)::text as route,
    'medium'::text as urgency
  from public.match_players mp
  join public.matches m on m.id = mp.match_id
  where mp.user_id = v_uid
    and mp.status = 'invited'
    and m.status in ('open', 'locked')
    and m.scheduled_at > now()
  order by m.scheduled_at asc;
end;
$$;

revoke execute on function public.get_my_pending_actions() from anon, public;
grant  execute on function public.get_my_pending_actions() to authenticated;
