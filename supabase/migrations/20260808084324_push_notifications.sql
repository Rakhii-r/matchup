-- Push notifications: the queue, the enqueue triggers, and device registration.
--
-- Shape of the system, and why:
--
--   match_players change  ->  trigger  ->  notification_jobs row  ->  pg_cron (1 min)
--     ->  pg_net POST  ->  notify-wave Edge Function  ->  Expo Push API  ->  device
--
-- Notifications are queued as ROWS, never sent inline from the request path.
-- Inserting a job is cheap and transactional: if the join transaction rolls back,
-- the notification disappears with it. Sending inline would couple the user's
-- join latency to Expo's API and is the pattern that forces a rewrite when the
-- fan-out grows. The "queue" is just Postgres today; swapping in a real broker
-- later is a change of transport, not of design.
--
-- Realtime popups (MatchJoinAlerts) stay as they are. They fire only while the
-- app is foregrounded; this path is what reaches a user whose app is closed.

-- Both extensions pin their own schema (net.*, cron.*) regardless of any
-- `with schema` clause, so calls below are fully qualified rather than relying
-- on search_path.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table public.notification_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in (
                 'join_requested', 'join_approved', 'join_confirmed', 'challenge_received'
               )),
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) between 1 and 240),
  data         jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  processed_at timestamptz
);

comment on table public.notification_jobs is
  'Outbound push queue. Written only by triggers; drained only by the notify-wave Edge Function using the service role.';

-- The dispatcher's hot path: pending jobs, oldest first.
create index notification_jobs_pending_idx
  on public.notification_jobs (created_at)
  where status = 'pending';

-- The reaper's path: jobs stuck in 'processing' after a function crash.
create index notification_jobs_claimed_idx
  on public.notification_jobs (claimed_at)
  where status = 'processing';

-- RLS on with ZERO policies: no client, anon or authenticated, can read or write
-- this table. A job body can name another user ("Rahul wants to join"), so it is
-- not safe to expose even to its own recipient. The service role bypasses RLS.
alter table public.notification_jobs enable row level security;
revoke all on public.notification_jobs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue helper + triggers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER because the calling user has no rights on notification_jobs.
-- Never call this with user-supplied title/body; all callers below build the
-- text from database columns.
create or replace function public.enqueue_notification(
  in_user_id uuid,
  in_kind    text,
  in_title   text,
  in_body    text,
  in_data    jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- No recipient, nothing to do. Silently skipping keeps the trigger from
  -- breaking the parent transaction over a missing profile.
  if in_user_id is null then
    return;
  end if;

  insert into public.notification_jobs (user_id, kind, title, body, data)
  values (in_user_id, in_kind, left(in_title, 120), left(in_body, 240), coalesce(in_data, '{}'::jsonb));
end;
$$;

revoke execute on function public.enqueue_notification(uuid, text, text, text, jsonb)
  from anon, authenticated, public;

-- A player asked to join -> tell the match creator.
create or replace function public.tg_notify_join_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match   public.matches%rowtype;
  v_name    text;
begin
  if new.status <> 'interested' then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found or v_match.creator_id = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'A player') into v_name
  from public.profiles where id = new.user_id;

  perform public.enqueue_notification(
    v_match.creator_id,
    'join_requested',
    'New join request',
    v_name || ' wants to join ' || v_match.match_name,
    jsonb_build_object('matchId', new.match_id, 'route', '/match/' || new.match_id)
  );
  return new;
end;
$$;

create trigger notify_join_requested
  after insert on public.match_players
  for each row execute function public.tg_notify_join_requested();

-- Creator approved or confirmed a player -> tell that player.
create or replace function public.tg_notify_membership_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('approved', 'confirmed') then
    return new;
  end if;

  select * into v_match from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;

  perform public.enqueue_notification(
    new.user_id,
    case new.status when 'approved' then 'join_approved' else 'join_confirmed' end,
    case new.status
      when 'approved' then 'You are in'
      else 'Your spot is confirmed'
    end,
    case new.status
      when 'approved' then v_match.match_name || ' accepted your request.'
      else 'You are confirmed for ' || v_match.match_name || '.'
    end,
    jsonb_build_object('matchId', new.match_id, 'route', '/match/' || new.match_id)
  );
  return new;
end;
$$;

create trigger notify_membership_status
  after update of status on public.match_players
  for each row execute function public.tg_notify_membership_status();

-- A team was challenged -> tell the challenged team's owner.
create or replace function public.tg_notify_challenge_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_from  text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select owner_id into v_owner from public.teams where id = new.to_team_id;
  select name     into v_from  from public.teams where id = new.from_team_id;

  if v_owner is null or v_owner = new.created_by then
    return new;
  end if;

  perform public.enqueue_notification(
    v_owner,
    'challenge_received',
    'Match challenge',
    coalesce(v_from, 'A team') || ' challenged you to ' || new.match_name || '.',
    jsonb_build_object('challengeId', new.id, 'route', '/teams/challenges')
  );
  return new;
end;
$$;

create trigger notify_challenge_received
  after insert on public.team_challenges
  for each row execute function public.tg_notify_challenge_received();

-- PostgREST exposes every function in `public` as an RPC endpoint, so without
-- this the trigger functions above are reachable at /rest/v1/rpc/tg_notify_*.
-- Postgres checks EXECUTE on a trigger function when the trigger is CREATED,
-- not each time it fires, so revoking here does not stop the triggers.
--
-- sync_filled_slots and add_team_owner_as_member have the same exposure from
-- earlier migrations; closed here rather than left for a separate pass.
revoke execute on function public.tg_notify_join_requested()     from anon, authenticated, public;
revoke execute on function public.tg_notify_membership_status()  from anon, authenticated, public;
revoke execute on function public.tg_notify_challenge_received() from anon, authenticated, public;
revoke execute on function public.sync_filled_slots()            from anon, authenticated, public;
revoke execute on function public.add_team_owner_as_member()     from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Device registration
-- ---------------------------------------------------------------------------

-- devices.fcm_token holds an EXPO push token (ExponentPushToken[...]), not a raw
-- FCM token. Expo's service is what actually talks to FCM/APNs. The column name
-- predates that decision; it is left alone rather than renamed under live data.
comment on column public.devices.fcm_token is
  'Expo push token (ExponentPushToken[...]). Expo relays to FCM/APNs.';

-- Upsert keyed on the token, not on (user, token): the same physical device can
-- be handed to a second account, and the token must then follow the new owner
-- or the previous user keeps receiving that device''s pushes.
create or replace function public.register_device(
  in_token    text,
  in_platform text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if in_token is null or char_length(in_token) < 10 then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;
  if in_platform not in ('ios', 'android') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;
  -- A banned account must not keep receiving pushes.
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    raise exception 'Account is not active' using errcode = '28000';
  end if;

  insert into public.devices (user_id, fcm_token, platform, last_seen)
  values (v_uid, in_token, in_platform, now())
  on conflict (fcm_token) do update
    set user_id   = excluded.user_id,
        platform  = excluded.platform,
        last_seen = now();
end;
$$;

grant execute on function public.register_device(text, text) to authenticated;
revoke execute on function public.register_device(text, text) from anon, public;

-- Called on sign-out, before the session is torn down.
create or replace function public.unregister_device(in_token text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.devices
  where fcm_token = in_token and user_id = (select auth.uid());
$$;

grant execute on function public.unregister_device(text) to authenticated;
revoke execute on function public.unregister_device(text) from anon, public;

-- ---------------------------------------------------------------------------
-- Draining: claim, then dispatch
-- ---------------------------------------------------------------------------

-- Claims a batch atomically. FOR UPDATE SKIP LOCKED means two overlapping
-- Edge Function invocations cannot claim the same job, so nobody gets a
-- duplicate push if a run is slow and the next cron tick fires.
create or replace function public.claim_notification_jobs(in_limit integer default 100)
returns table (
  id      uuid,
  user_id uuid,
  title   text,
  body    text,
  data    jsonb,
  tokens  text[]
)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select j.id
    from public.notification_jobs j
    where j.status = 'pending' and j.attempts < 5
    order by j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(in_limit, 100), 500))
  ),
  claimed as (
    update public.notification_jobs j
    set status = 'processing', attempts = j.attempts + 1, claimed_at = now()
    from picked p
    where j.id = p.id
    returning j.id, j.user_id, j.title, j.body, j.data
  )
  select c.id, c.user_id, c.title, c.body, c.data,
         coalesce(
           array_agg(d.fcm_token order by d.last_seen desc) filter (where d.fcm_token is not null),
           array[]::text[]
         )
  from claimed c
  left join public.devices d on d.user_id = c.user_id
  group by c.id, c.user_id, c.title, c.body, c.data;
end;
$$;

revoke execute on function public.claim_notification_jobs(integer) from anon, authenticated, public;

-- Returns jobs stranded in 'processing' by a crashed run. Without this a single
-- Edge Function timeout would park those jobs forever.
create or replace function public.reap_stuck_notification_jobs()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.notification_jobs
  set status = case when attempts >= 5 then 'failed' else 'pending' end,
      last_error = coalesce(last_error, 'reclaimed after stalled dispatch')
  where status = 'processing' and claimed_at < now() - interval '5 minutes';

  delete from public.notification_jobs
  where status in ('sent', 'failed') and processed_at < now() - interval '14 days';
$$;

revoke execute on function public.reap_stuck_notification_jobs() from anon, authenticated, public;

-- Pokes the Edge Function, but only when there is something to send — an empty
-- POST every minute forever is wasted invocations.
--
-- The URL and service role key live in Vault, never in this file. Set them once:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-wave', 'notify_wave_url');
--   select vault.create_secret('<service-role-key>', 'notify_wave_service_key');
create or replace function public.dispatch_notification_jobs()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (
    select 1 from public.notification_jobs where status = 'pending' and attempts < 5
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_wave_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_wave_service_key';

  if v_url is null or v_key is null then
    raise warning 'notify-wave: vault secrets not set; jobs are queued but not dispatched';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke execute on function public.dispatch_notification_jobs() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('notify-wave-dispatch');
exception when others then
  null;  -- not scheduled yet on a fresh database
end;
$$;

do $$
begin
  perform cron.unschedule('notification-jobs-reap');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'notify-wave-dispatch',
  '* * * * *',
  $cron$select public.dispatch_notification_jobs()$cron$
);

select cron.schedule(
  'notification-jobs-reap',
  '*/5 * * * *',
  $cron$select public.reap_stuck_notification_jobs()$cron$
);
