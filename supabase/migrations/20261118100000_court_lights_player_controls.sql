-- Court lights, player side (owner, 18 Nov 2026):
--   * A venue "has lights" as soon as any of its courts has a linked device.
--     Players see a badge on the venue and on each lit court.
--   * The booker can opt out when booking, and switch lights on/off from the
--     scoreboard during the slot: venue_bookings.lights_wanted.
--   * Everyone in the match sees the lights status on the scoreboard.

alter table public.venue_bookings
  add column if not exists lights_wanted boolean not null default true;

alter table public.light_events drop constraint if exists light_events_skip_reason_check;
alter table public.light_events add constraint light_events_skip_reason_check
  check (skip_reason in
    ('no_active_booking', 'scorer_not_booker', 'not_paid', 'booker_turned_off',
     'ambiguous_court', 'no_device', 'device_disabled', 'rate_limited'));

-- The rule gains one condition: the booker has not switched lights off.
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

  select count(*) into v_count from public.venue_bookings b
   where b.user_id = in_uid and b.status = 'confirmed'
     and now() >= b.start_time and now() < b.end_time;

  if v_count = 0 then
    -- Log only when someone else holds a court at this match's venue now.
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
    select * into v_booking from public.venue_bookings b
     where b.user_id = in_uid and b.status = 'confirmed'
       and now() >= b.start_time and now() < b.end_time
       and (v_count = 1 or b.match_id = v_match)
     limit 1;

    if v_booking.id is null then
      v_reason := 'ambiguous_court';
    elsif not v_booking.lights_wanted then
      v_reason := 'booker_turned_off';
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

-- A booking that is switched off by the booker must not fire after a send is
-- queued either: claim re-checks it.
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

  if v_ev.booking_id is not null and not exists (
    select 1 from public.venue_bookings b
     where b.id = v_ev.booking_id and b.status = 'confirmed' and now() < b.end_time
       and b.lights_wanted
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

-- Courts that have a light device. Public to signed-in users: it says which
-- grounds have lights, nothing more.
create or replace function public.list_light_courts()
returns table(venue_id uuid, court_number integer)
language sql stable security definer set search_path to 'public' as $$
  select d.venue_id, d.court_number from public.court_devices d
   order by d.venue_id, d.court_number;
$$;

-- The booker switches lights on/off for their own booking: at booking time
-- (the opt-out) or from the scoreboard during the slot.
create or replace function public.set_booking_lights(in_booking_id uuid, in_wanted boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.venue_bookings%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select * into v_b from public.venue_bookings where id = in_booking_id for update;
  if v_b.id is null then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_b.user_id <> v_uid then raise exception 'NOT_YOUR_BOOKING' using errcode = '42501'; end if;
  if v_b.status <> 'confirmed' then raise exception 'BOOKING_CANCELLED' using errcode = '23514'; end if;
  if v_b.end_time <= now() then raise exception 'BOOKING_FINISHED' using errcode = '23514'; end if;

  update public.venue_bookings set lights_wanted = coalesce(in_wanted, true)
   where id = in_booking_id;
end;
$$;

-- Lights status for a match's scoreboard, for anyone on the match. The court
-- is found the same way enqueue_light_event finds it: the scorer's (or, before
-- scoring starts, the organiser's) booking that is live right now. Returns no
-- row when that court has no light device.
create or replace function public.get_match_lights(in_match_id uuid)
returns table(booking_id uuid, venue_name text, court_number integer, until timestamptz,
              paid boolean, wanted boolean, device_enabled boolean, i_am_booker boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_holder uuid;
  v_count  integer;
begin
  if v_uid is null then return; end if;
  if not (public.is_match_creator(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    return;
  end if;

  select coalesce(m.scorer_id, m.creator_id) into v_holder
    from public.matches m where m.id = in_match_id;
  if v_holder is null then return; end if;

  select count(*) into v_count from public.venue_bookings b
   where b.user_id = v_holder and b.status = 'confirmed'
     and now() >= b.start_time and now() < b.end_time;
  if v_count = 0 then return; end if;

  return query
    select b.id, v.name, b.court_number, b.end_time,
           exists (select 1 from public.light_entitlements e
                    where e.booking_id = b.id and e.revoked_at is null),
           b.lights_wanted, d.enabled, b.user_id = v_uid
      from public.venue_bookings b
      join public.venues v on v.id = b.venue_id
      join public.court_devices d
        on d.venue_id = b.venue_id and d.court_number = b.court_number
     where b.user_id = v_holder and b.status = 'confirmed'
       and now() >= b.start_time and now() < b.end_time
       and (v_count = 1 or b.match_id = in_match_id)
     limit 1;
end;
$$;

-- Replaced by get_match_lights. No released build calls it.
drop function if exists public.get_my_lights_status(uuid);

-- The counter screen shows when the booker has switched lights off.
drop function if exists public.list_venue_light_bookings(uuid, timestamptz, timestamptz);
create function public.list_venue_light_bookings(
  in_venue_id uuid, in_from timestamptz, in_to timestamptz)
returns table(booking_id uuid, court_number integer, start_time timestamptz,
              end_time timestamptz, booker_name text, lights_paid boolean,
              amount_paise integer, method text, granted_at timestamptz,
              lights_wanted boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.can_manage_venue_lights(in_venue_id, (select auth.uid())) then
    raise exception 'NOT_VENUE_STAFF' using errcode = '42501';
  end if;

  return query
    select b.id, b.court_number, b.start_time, b.end_time,
           coalesce(p.full_name, 'Player'),
           e.id is not null, e.amount_paise, e.method, e.granted_at,
           b.lights_wanted
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

revoke execute on function
  public.list_light_courts(),
  public.set_booking_lights(uuid, boolean),
  public.get_match_lights(uuid),
  public.list_venue_light_bookings(uuid, timestamptz, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.list_light_courts(),
  public.set_booking_lights(uuid, boolean),
  public.get_match_lights(uuid),
  public.list_venue_light_bookings(uuid, timestamptz, timestamptz)
to authenticated;
