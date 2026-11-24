-- Court lights no longer need the counter's "Lights paid" step (owner's call,
-- 23 Nov 2026). Every booking at a court with an enabled device gets lights;
-- the booker can still switch them off (lights_wanted).
--
-- Only the rule changes. light_entitlements, set_lights_paid and
-- revoke_lights_paid stay so the counter screen keeps working and history
-- survives, but nothing gates on them now. get_match_lights keeps its shape and
-- reports paid = true, so the scoreboard chip (which shows "pay at counter"
-- when paid is false) needs no app update.

create or replace function public.enqueue_light_event(in_delivery deliveries, in_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   text;
  v_match   uuid;
  v_booking public.venue_bookings%rowtype;
  v_device  public.court_devices%rowtype;
  v_count   integer;
  v_reason  text;
  v_id      uuid;
begin
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

create or replace function public.get_match_lights(in_match_id uuid)
returns table(booking_id uuid, venue_name text, court_number integer, until timestamptz,
              paid boolean, wanted boolean, device_enabled boolean, i_am_booker boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
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
           true,  -- payment no longer gates lights (20261123100000)
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
