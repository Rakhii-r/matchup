-- Phase 2: paid court lights. A 4, 6 or wicket recorded by the person who
-- holds a paid booking for the court, during that booking, blinks the lights
-- on that court through ThingsBoard. Design: docs/PHASE2_LIGHTS_DESIGN.md.
--
-- Pipeline:
--   record_delivery -> enqueue_light_event (the rule; logs every fire AND skip)
--                   -> dispatch_light_event (pg_net, async, after commit)
--                   -> Edge Function light-event -> claim_light_event (re-checks
--                      expiry and the slot) -> ThingsBoard device telemetry
--                   -> rule chain -> RPC "blink" to the ESP32.
--
-- One ThingsBoard device per court (the ESP32 itself). Its access token lives
-- in Vault, never in a table the app can read.
--
-- Vault rows this needs, set once per project OUTSIDE migrations (they are
-- project specific):
--   light_event_url     https://<ref>.supabase.co/functions/v1/light-event
--   light_event_secret  random string; the Edge Function asks the database to
--                       compare it (verify_light_event_caller), so there is
--                       exactly one copy.
-- Until both exist, events are logged as failed with dispatcher_not_configured
-- and scoring is unaffected.

-- ---------------------------------------------------------------- tables ----

-- Who may mark bookings paid at one venue. Superadmins may act on any venue.
create table if not exists public.venue_staff (
  venue_id  uuid not null references public.venues(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  added_by  uuid references public.profiles(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (venue_id, user_id)
);
create index if not exists venue_staff_user_idx on public.venue_staff (user_id);

-- Which ThingsBoard device serves which court. The token is in Vault under
-- feed_secret_name.
create table if not exists public.court_devices (
  venue_id          uuid not null references public.venues(id) on delete cascade,
  court_number      integer not null check (court_number >= 1),
  feed_secret_name  text not null unique,
  enabled           boolean not null default true,  -- per-court kill switch
  updated_at        timestamptz not null default now(),
  primary key (venue_id, court_number)
);

-- Append-only: a revoke sets revoked_at, a regrant inserts a new row, so
-- "who switched this on?" is always answerable.
create table if not exists public.light_entitlements (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.venue_bookings(id) on delete cascade,
  amount_paise  integer not null check (amount_paise >= 0),
  method        text not null check (method in ('cash', 'upi', 'comp')),
  granted_by    uuid references public.profiles(id) on delete set null,
  granted_at    timestamptz not null default now(),
  revoked_by    uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz
);
create unique index if not exists light_entitlements_one_active
  on public.light_entitlements (booking_id) where revoked_at is null;

-- Every fire and every skip, with the reason ("I paid and nothing blinked").
-- Doubles as the outbox. delivery_id unique: one ball never fires twice.
create table if not exists public.light_events (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid unique references public.deliveries(id) on delete set null,
  booking_id   uuid references public.venue_bookings(id) on delete set null,
  scorer_id    uuid references public.profiles(id) on delete set null,
  venue_id     uuid references public.venues(id) on delete set null,
  court_number integer,
  event        text not null check (event in ('FOUR', 'SIX', 'WICKET', 'TEST')),
  status       text not null check (status in
                 ('skipped', 'queued', 'sending', 'sent', 'failed', 'expired')),
  skip_reason  text check (skip_reason in
                 ('no_active_booking', 'scorer_not_booker', 'not_paid',
                  'ambiguous_court', 'no_device', 'device_disabled', 'rate_limited')),
  expires_at   timestamptz,
  attempts     integer not null default 0,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists light_events_court_recent
  on public.light_events (venue_id, court_number, created_at desc);
create index if not exists light_events_booking_idx on public.light_events (booking_id);

-- RLS on, no policies: clients reach these only through the RPCs below.
alter table public.venue_staff        enable row level security;
alter table public.court_devices      enable row level security;
alter table public.light_entitlements enable row level security;
alter table public.light_events       enable row level security;
revoke all on table public.venue_staff, public.court_devices,
                    public.light_entitlements, public.light_events
  from anon, authenticated;

-- ---------------------------------------------------------------- helpers ---

create or replace function public.can_manage_venue_lights(in_venue_id uuid, in_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select in_uid is not null and (
    public.is_superadmin(in_uid)
    or exists (select 1 from public.venue_staff s
                where s.venue_id = in_venue_id and s.user_id = in_uid)
  );
$$;

-- Posts one event to the Edge Function. net.http_post only queues inside the
-- transaction, so a rolled-back ball sends nothing.
create or replace function public.dispatch_light_event(in_event_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'light_event_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'light_event_secret';

  if v_url is null or v_key is null then
    update public.light_events
       set status = 'failed', error = 'dispatcher_not_configured'
     where id = in_event_id;
    raise warning 'light-event: vault secrets light_event_url/light_event_secret not set';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('event_id', in_event_id),
    timeout_milliseconds := 5000
  );
end;
$$;

-- --------------------------------------------------------------- the rule ---

create or replace function public.enqueue_light_event(in_delivery public.deliveries, in_uid uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_event   text;
  v_match   uuid;
  v_booking public.venue_bookings%rowtype;
  v_device  public.court_devices%rowtype;
  v_count   integer;
  v_reason  text;
  v_id      uuid;
begin
  -- Wicket first: a run-out off a no-ball is a wicket. A wide never has
  -- runs_off_bat (record_delivery moves them to extras), so it never fires.
  v_event := case
    when in_delivery.wicket_type is not null then 'WICKET'
    when in_delivery.runs_off_bat = 6 then 'SIX'
    when in_delivery.runs_off_bat = 4 then 'FOUR'
  end;
  if v_event is null then return; end if;

  select match_id into v_match from public.innings where id = in_delivery.innings_id;

  -- Confirmed bookings this user holds right now. Half-open, so back-to-back
  -- bookings on one court hand over cleanly at the exact minute.
  select count(*) into v_count from public.venue_bookings b
   where b.user_id = in_uid and b.status = 'confirmed'
     and now() >= b.start_time and now() < b.end_time;

  if v_count = 0 then
    -- Someone else holds a court at this match's venue right now: log it, so a
    -- paid slot scored by a friend is visible. Otherwise this is an ordinary
    -- match with no booking at all, and logging every boundary in the app
    -- would only bury the rows that matter.
    if not exists (
      select 1 from public.venue_bookings b
        join public.matches m on m.id = v_match
       where b.status = 'confirmed' and b.venue_id = m.venue_id
         and now() >= b.start_time and now() < b.end_time
    ) then
      return;
    end if;
    v_reason := 'scorer_not_booker';
  else
    -- Prefer the booking linked to this match; with one booking, that one.
    select * into v_booking from public.venue_bookings b
     where b.user_id = in_uid and b.status = 'confirmed'
       and now() >= b.start_time and now() < b.end_time
       and (v_count = 1 or b.match_id = v_match)
     limit 1;

    if v_booking.id is null then
      v_reason := 'ambiguous_court';
    elsif not exists (select 1 from public.light_entitlements e
                       where e.booking_id = v_booking.id and e.revoked_at is null) then
      v_reason := 'not_paid';
    else
      select * into v_device from public.court_devices d
       where d.venue_id = v_booking.venue_id and d.court_number = v_booking.court_number;
      if v_device.venue_id is null then
        v_reason := 'no_device';
      elsif not v_device.enabled then
        v_reason := 'device_disabled';
      elsif (select count(*) from public.light_events ev
              where ev.venue_id = v_booking.venue_id
                and ev.court_number = v_booking.court_number
                and ev.status <> 'skipped'
                and ev.created_at > now() - interval '1 minute') >= 6 then
        v_reason := 'rate_limited';
      end if;
    end if;
  end if;

  insert into public.light_events (
    delivery_id, booking_id, scorer_id, venue_id, court_number,
    event, status, skip_reason, expires_at
  ) values (
    in_delivery.id, v_booking.id, in_uid, v_booking.venue_id, v_booking.court_number,
    v_event,
    case when v_reason is null then 'queued' else 'skipped' end,
    v_reason,
    case when v_reason is null
         then least(now() + interval '10 seconds', v_booking.end_time) end
  ) returning id into v_id;

  if v_reason is null then
    perform public.dispatch_light_event(v_id);
  end if;
end;
$$;

-- record_delivery: identical to 20261031090000 (verified against the live
-- definition on 18 Nov 2026) plus ONE guarded call after the insert. Lights are
-- never allowed to stop a ball being scored.
create or replace function public.record_delivery(in_innings_id uuid, in_striker_id uuid, in_non_striker_id uuid, in_bowler_id uuid, in_runs_off_bat smallint DEFAULT 0, in_extra_type text DEFAULT NULL::text, in_extra_runs smallint DEFAULT 0, in_wicket_type text DEFAULT NULL::text, in_out_player_id uuid DEFAULT NULL::uuid)
 returns deliveries
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype; v_row public.deliveries%rowtype;
  v_seq integer; v_legal boolean; v_over integer; v_ball smallint;
  v_all_out integer; v_done boolean;
  v_bat smallint := coalesce(in_runs_off_bat, 0);
  v_extra smallint := coalesce(in_extra_runs, 0);
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_i.status <> 'in_progress' then raise exception 'INNINGS_ENDED' using errcode = '23514'; end if;

  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  if in_striker_id = in_non_striker_id then
    raise exception 'SAME_BATTER_BOTH_ENDS' using errcode = '23514';
  end if;

  -- Totals are bat + extra, so a run must be in exactly one of them.
  if in_extra_type = 'wide' then
    v_extra := greatest(v_extra, 1 + v_bat);
    v_bat := 0;
  elsif in_extra_type = 'no_ball' then
    v_extra := greatest(v_extra - v_bat, 1);
  end if;

  v_legal := in_extra_type is null or in_extra_type in ('bye', 'leg_bye');
  v_over := v_i.legal_balls / 6;
  v_ball := (v_i.legal_balls % 6) + 1;

  if v_m.overs is not null and v_legal and v_i.legal_balls >= v_m.overs * 6 then
    raise exception 'OVERS_EXHAUSTED' using errcode = '23514';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.deliveries where innings_id = in_innings_id;

  insert into public.deliveries (
    innings_id, seq, over_number, ball_in_over,
    striker_id, non_striker_id, bowler_id,
    runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id
  ) values (
    in_innings_id, v_seq, v_over, v_ball,
    in_striker_id, in_non_striker_id, in_bowler_id,
    v_bat, in_extra_type, v_extra,
    in_wicket_type, in_out_player_id
  ) returning * into v_row;

  -- Court lights (Phase 2). Own block: any failure here is swallowed so the
  -- ball is still recorded.
  begin
    perform public.enqueue_light_event(v_row, v_uid);
  exception when others then
    raise warning 'enqueue_light_event failed for %: %', v_row.id, sqlerrm;
  end;

  -- Re-read: the AFTER INSERT trigger has already recomputed runs/wickets/balls.
  select * into v_i from public.innings where id = in_innings_id;
  v_all_out := public.wickets_to_end_innings(v_i.match_id);

  -- All out closes EITHER innings. Overs and target still only close the
  -- second -- the first is deliberately ended by hand, because the sides swap
  -- and the scorer confirms it.
  v_done := v_i.wickets >= v_all_out;

  if v_i.number = 2 then
    v_done := v_done
      or (v_i.target is not null and v_i.runs >= v_i.target)
      or (v_m.overs is not null and v_i.legal_balls >= v_m.overs * 6);
  end if;

  if v_done then
    update public.innings
       set status = 'completed', ended_at = now()
     where id = in_innings_id;

    if v_i.number = 2 then
      perform public.finish_match(v_i.match_id, null);
    end if;
  end if;

  return v_row;
end;
$function$;

-- ------------------------------------------------- Edge Function contract ---

create or replace function public.verify_light_event_caller(in_token text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'light_event_secret'
       and s.decrypted_secret is not null
       and in_token is not null
       and s.decrypted_secret = in_token
  );
$$;

-- Atomically queued -> sending, then re-checks everything that can change
-- between the ball and the send. Returns no row when the event must not fire.
create or replace function public.claim_light_event(in_event_id uuid)
returns table(event_id uuid, event text, expires_at timestamptz, device_token text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ev     public.light_events%rowtype;
  v_device public.court_devices%rowtype;
  v_token  text;
begin
  update public.light_events ev
     set status = 'sending', attempts = ev.attempts + 1
   where ev.id = in_event_id and ev.status = 'queued'
  returning * into v_ev;
  if v_ev.id is null then return; end if;

  if v_ev.expires_at is null or v_ev.expires_at <= now() then
    update public.light_events set status = 'expired' where id = v_ev.id;
    return;
  end if;

  -- The slot may have been cancelled or ended since the ball. TEST events
  -- have no booking.
  if v_ev.booking_id is not null and not exists (
    select 1 from public.venue_bookings b
     where b.id = v_ev.booking_id and b.status = 'confirmed' and now() < b.end_time
  ) then
    update public.light_events set status = 'expired', error = 'slot_over' where id = v_ev.id;
    return;
  end if;

  select * into v_device from public.court_devices d
   where d.venue_id = v_ev.venue_id and d.court_number = v_ev.court_number;
  if v_device.venue_id is null or not v_device.enabled then
    update public.light_events set status = 'failed', error = 'device_disabled' where id = v_ev.id;
    return;
  end if;

  select decrypted_secret into v_token from vault.decrypted_secrets
   where name = v_device.feed_secret_name;
  if v_token is null then
    update public.light_events set status = 'failed', error = 'no_device_token' where id = v_ev.id;
    return;
  end if;

  return query select v_ev.id, v_ev.event, v_ev.expires_at, v_token;
end;
$$;

create or replace function public.finish_light_event(in_event_id uuid, in_ok boolean, in_error text)
returns void language sql security definer set search_path to 'public' as $$
  update public.light_events
     set status  = case when in_ok then 'sent' else 'failed' end,
         sent_at = case when in_ok then now() end,
         error   = case when in_ok then null else left(in_error, 500) end
   where id = in_event_id and status = 'sending';
$$;

-- ------------------------------------------------------------- app RPCs ---

-- Venues the caller can run the counter for.
create or replace function public.list_my_light_venues()
returns table(id uuid, name text, courts_count integer)
language sql stable security definer set search_path to 'public' as $$
  select v.id, v.name, coalesce(v.courts_count, 1)
    from public.venues v
   where public.can_manage_venue_lights(v.id, (select auth.uid()))
   order by v.name;
$$;

-- Confirmed bookings overlapping [in_from, in_to) with their lights status.
-- The client passes local midnight to midnight, so no timezone lives here.
create or replace function public.list_venue_light_bookings(
  in_venue_id uuid, in_from timestamptz, in_to timestamptz)
returns table(booking_id uuid, court_number integer, start_time timestamptz,
              end_time timestamptz, booker_name text, lights_paid boolean,
              amount_paise integer, method text, granted_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_venue_lights(in_venue_id, (select auth.uid())) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;

  return query
    select b.id, b.court_number, b.start_time, b.end_time,
           coalesce(p.full_name, 'Player'),
           e.id is not null, e.amount_paise, e.method, e.granted_at
      from public.venue_bookings b
      left join public.profiles p on p.id = b.user_id
      left join public.light_entitlements e
        on e.booking_id = b.id and e.revoked_at is null
     where b.venue_id = in_venue_id and b.status = 'confirmed'
       and b.start_time < in_to and b.end_time > in_from
     order by b.start_time, b.court_number
     limit 200;
end;
$$;

create or replace function public.set_lights_paid(
  in_booking_id uuid, in_amount_paise integer, in_method text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.venue_bookings%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select * into v_b from public.venue_bookings where id = in_booking_id for update;
  if v_b.id is null then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_venue_lights(v_b.venue_id, v_uid) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;
  if v_b.status <> 'confirmed' then raise exception 'BOOKING_CANCELLED' using errcode = '23514'; end if;
  if v_b.end_time <= now() then raise exception 'BOOKING_FINISHED' using errcode = '23514'; end if;
  if in_amount_paise is null or in_amount_paise < 0 or in_amount_paise > 10000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if in_method is null or in_method not in ('cash', 'upi', 'comp') then
    raise exception 'INVALID_METHOD' using errcode = '22023';
  end if;
  if exists (select 1 from public.light_entitlements
              where booking_id = in_booking_id and revoked_at is null) then
    raise exception 'ALREADY_PAID' using errcode = '23505';
  end if;

  insert into public.light_entitlements (booking_id, amount_paise, method, granted_by)
  values (in_booking_id, in_amount_paise, in_method, v_uid);
end;
$$;

create or replace function public.revoke_lights_paid(in_booking_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_venue uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select venue_id into v_venue from public.venue_bookings where id = in_booking_id;
  if v_venue is null then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_manage_venue_lights(v_venue, v_uid) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;

  update public.light_entitlements
     set revoked_by = v_uid, revoked_at = now()
   where booking_id = in_booking_id and revoked_at is null;
  if not found then raise exception 'NOT_PAID' using errcode = 'P0002'; end if;
end;
$$;

-- One row per court of the venue, configured or not, with its latest event.
create or replace function public.list_court_devices(in_venue_id uuid)
returns table(court_number integer, configured boolean, enabled boolean,
              last_event text, last_status text, last_error text, last_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_venue_lights(in_venue_id, (select auth.uid())) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;

  return query
    select c.n, d.venue_id is not null, coalesce(d.enabled, false),
           le.event, le.status, coalesce(le.error, le.skip_reason), le.created_at
      from public.venues v
      cross join lateral generate_series(1, greatest(coalesce(v.courts_count, 1), 1)) as c(n)
      left join public.court_devices d
        on d.venue_id = v.id and d.court_number = c.n
      left join lateral (
        select ev.event, ev.status, ev.error, ev.skip_reason, ev.created_at
          from public.light_events ev
         where ev.venue_id = v.id and ev.court_number = c.n
         order by ev.created_at desc limit 1
      ) le on true
     where v.id = in_venue_id
     order by c.n;
end;
$$;

-- Superadmin only: link a court to its ThingsBoard device by access token.
-- The token goes straight into Vault and is never returned.
create or replace function public.set_court_device_token(
  in_venue_id uuid, in_court_number integer, in_token text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_courts  integer;
  v_name    text := 'tb_device_' || in_venue_id::text || '_' || in_court_number::text;
  v_secret  uuid;
  v_token   text := btrim(coalesce(in_token, ''));
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin(v_uid) then raise exception 'NOT_SUPERADMIN' using errcode = '42501'; end if;
  select coalesce(courts_count, 1) into v_courts from public.venues where id = in_venue_id;
  if v_courts is null then raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002'; end if;
  if in_court_number is null or in_court_number < 1 or in_court_number > v_courts then
    raise exception 'COURT_OUT_OF_RANGE' using errcode = '22023';
  end if;
  if v_token !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'INVALID_TOKEN' using errcode = '22023';
  end if;

  select id into v_secret from vault.secrets where name = v_name;
  if v_secret is null then
    perform vault.create_secret(v_token, v_name, 'ThingsBoard device token for a court');
  else
    perform vault.update_secret(v_secret, v_token);
  end if;

  insert into public.court_devices (venue_id, court_number, feed_secret_name)
  values (in_venue_id, in_court_number, v_name)
  on conflict (venue_id, court_number)
    do update set feed_secret_name = excluded.feed_secret_name, updated_at = now();
end;
$$;

create or replace function public.set_court_device_enabled(
  in_venue_id uuid, in_court_number integer, in_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_venue_lights(in_venue_id, (select auth.uid())) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;
  update public.court_devices
     set enabled = coalesce(in_enabled, false), updated_at = now()
   where venue_id = in_venue_id and court_number = in_court_number;
  if not found then raise exception 'NO_DEVICE' using errcode = 'P0002'; end if;
end;
$$;

-- Sends a TEST event through the same pipeline. Returns its id so the screen
-- can show whether it reached ThingsBoard.
create or replace function public.send_test_blink(in_venue_id uuid, in_court_number integer)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_device public.court_devices%rowtype;
  v_id     uuid;
begin
  if not public.can_manage_venue_lights(in_venue_id, v_uid) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;
  select * into v_device from public.court_devices
   where venue_id = in_venue_id and court_number = in_court_number;
  if v_device.venue_id is null then raise exception 'NO_DEVICE' using errcode = 'P0002'; end if;
  if not v_device.enabled then raise exception 'DEVICE_DISABLED' using errcode = '23514'; end if;

  insert into public.light_events (scorer_id, venue_id, court_number, event, status, expires_at)
  values (v_uid, in_venue_id, in_court_number, 'TEST', 'queued', now() + interval '10 seconds')
  returning id into v_id;

  perform public.dispatch_light_event(v_id);
  return v_id;
end;
$$;

create or replace function public.get_light_event_status(in_event_id uuid)
returns table(status text, error text)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ev public.light_events%rowtype;
begin
  select * into v_ev from public.light_events where id = in_event_id;
  if v_ev.id is null or not public.can_manage_venue_lights(v_ev.venue_id, (select auth.uid())) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;
  return query select v_ev.status, coalesce(v_ev.error, v_ev.skip_reason);
end;
$$;

-- For the scorer's "Lights on until 7:00 PM" chip. Display only: it decides
-- nothing; enqueue_light_event applies the same rule on every ball.
create or replace function public.get_my_lights_status(in_match_id uuid)
returns table(venue_name text, court_number integer, until timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then return; end if;
  select count(*) into v_count from public.venue_bookings b
   where b.user_id = v_uid and b.status = 'confirmed'
     and now() >= b.start_time and now() < b.end_time;
  if v_count = 0 then return; end if;

  return query
    select v.name, b.court_number, b.end_time
      from public.venue_bookings b
      join public.venues v on v.id = b.venue_id
      join public.light_entitlements e on e.booking_id = b.id and e.revoked_at is null
      join public.court_devices d
        on d.venue_id = b.venue_id and d.court_number = b.court_number and d.enabled
     where b.user_id = v_uid and b.status = 'confirmed'
       and now() >= b.start_time and now() < b.end_time
       and (v_count = 1 or b.match_id = in_match_id)
     limit 1;
end;
$$;

-- Staff management, superadmin only.
create or replace function public.list_venue_staff(in_venue_id uuid)
returns table(user_id uuid, full_name text, added_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_superadmin((select auth.uid())) then
    raise exception 'NOT_SUPERADMIN' using errcode = '42501';
  end if;
  return query
    select s.user_id, coalesce(p.full_name, 'Player'), s.added_at
      from public.venue_staff s
      left join public.profiles p on p.id = s.user_id
     where s.venue_id = in_venue_id
     order by s.added_at;
end;
$$;

-- Matches on the last 10 digits, so "+91 98765 43210" and "9876543210" agree.
create or replace function public.add_venue_staff(in_venue_id uuid, in_phone text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_digits text := right(regexp_replace(coalesce(in_phone, ''), '\D', '', 'g'), 10);
  v_user   uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin(v_uid) then raise exception 'NOT_SUPERADMIN' using errcode = '42501'; end if;
  if not exists (select 1 from public.venues where id = in_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if length(v_digits) <> 10 then raise exception 'INVALID_PHONE' using errcode = '22023'; end if;

  select p.id into v_user
    from public.profiles p
    left join auth.users u on u.id = p.id
   where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = v_digits
      or right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = v_digits
   limit 1;
  if v_user is null then raise exception 'PLAYER_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.venue_staff (venue_id, user_id, added_by)
  values (in_venue_id, v_user, v_uid)
  on conflict do nothing;
end;
$$;

create or replace function public.remove_venue_staff(in_venue_id uuid, in_user_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_superadmin((select auth.uid())) then
    raise exception 'NOT_SUPERADMIN' using errcode = '42501';
  end if;
  delete from public.venue_staff where venue_id = in_venue_id and user_id = in_user_id;
end;
$$;

-- ---------------------------------------------------------------- grants ---

revoke execute on function
  public.can_manage_venue_lights(uuid, uuid),
  public.dispatch_light_event(uuid),
  public.enqueue_light_event(public.deliveries, uuid),
  public.verify_light_event_caller(text),
  public.claim_light_event(uuid),
  public.finish_light_event(uuid, boolean, text),
  public.list_my_light_venues(),
  public.list_venue_light_bookings(uuid, timestamptz, timestamptz),
  public.set_lights_paid(uuid, integer, text),
  public.revoke_lights_paid(uuid),
  public.list_court_devices(uuid),
  public.set_court_device_token(uuid, integer, text),
  public.set_court_device_enabled(uuid, integer, boolean),
  public.send_test_blink(uuid, integer),
  public.get_light_event_status(uuid),
  public.get_my_lights_status(uuid),
  public.list_venue_staff(uuid),
  public.add_venue_staff(uuid, text),
  public.remove_venue_staff(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.verify_light_event_caller(text),
  public.claim_light_event(uuid),
  public.finish_light_event(uuid, boolean, text)
to service_role;

grant execute on function
  public.list_my_light_venues(),
  public.list_venue_light_bookings(uuid, timestamptz, timestamptz),
  public.set_lights_paid(uuid, integer, text),
  public.revoke_lights_paid(uuid),
  public.list_court_devices(uuid),
  public.set_court_device_token(uuid, integer, text),
  public.set_court_device_enabled(uuid, integer, boolean),
  public.send_test_blink(uuid, integer),
  public.get_light_event_status(uuid),
  public.get_my_lights_status(uuid),
  public.list_venue_staff(uuid),
  public.add_venue_staff(uuid, text),
  public.remove_venue_staff(uuid, uuid)
to authenticated;
