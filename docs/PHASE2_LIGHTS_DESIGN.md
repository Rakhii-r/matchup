# Phase 2: paid court lights — entitlement design

**Status:** BUILT and live, 18 Nov 2026. Database:
`supabase/migrations/20261118090000_court_lights.sql`. Edge Function:
`supabase/functions/light-event`. App: `app/lights/` (counter screen),
`src/features/lights/`, and the scorer chip in `LiveScoringPanel`. The SQL below
is the original draft; the migration is the source of truth. What changed from
the draft is listed under **As built** at the end.

## Payment step dropped (23 Nov 2026)

Owner's call: every booking at a court with an enabled device gets lights, no
"Lights paid" needed. `20261123100000_court_lights_no_payment.sql` removes the
`not_paid` branch from `enqueue_light_event` and makes `get_match_lights`
return `paid = true`. Every 4/6 tested on 20 Nov had been skipped as
`not_paid` while Test blink worked, which is what prompted this. The booker's
off switch, the slot window, booker-only and the rate limit all still apply.
`light_entitlements` and Mark paid remain but gate nothing.

## AMY dashboard controller (20 Nov 2026, backend change)

The AMY dashboard sends one-way `setState` RPCs. The exported device ID is
`f14ac020-a81a-11f1-8680-eb7b4f3816b1`. To enable that controller, configure
these **Supabase Edge Function secrets** and deploy `light-event`:

- `TB_RPC_DEVICES` is a JSON object mapping the device access token already
  linked to each RPC court to its ThingsBoard device ID. For AMY the format is
  `{"<AMY's existing device access token>":"f14ac020-a81a-11f1-8680-eb7b4f3816b1"}`.
  Replace the placeholder with the exact linked token. A token absent from this
  map uses the original telemetry flow described below.
- Set `TB_API_KEY` to an existing ThingsBoard platform API key with permission
  to send RPC to that device. An existing password-based ThingsBoard account
  with that permission can instead supply `TB_USERNAME` and `TB_PASSWORD`.
  Keep these values in Supabase server secrets.
- The sender uses `TB_HOST` (default `https://thingsboard.cloud`) and
  `POST /api/rpc/oneway/{deviceId}`. SIX sends the string `"6"`, FOUR sends
  `"4"`, and WICKET sends `"out"`. TEST uses the FOUR pattern. Commands
  expire within five seconds or at the event deadline, whichever comes first.
  Each claimed RPC is submitted once. A timeout can occur after delivery.
- After deploying, open **Court Lights** and press **Test blink**. Its physical result
  should match the dashboard's FOUR button. Next score a six during an eligible
  booking. Its physical result should match the SIX button. The event log
  records ThingsBoard's HTTP result.

## What the owner asked for

1. The lights are a paid feature.
2. Only the user who booked the box can fire them.
3. Only a 4, a 6 or a wicket fires them, and only during the booked slot.
4. When the slot ends, access is gone.

## The rule

A ball fires the lights when ALL of these are true at the moment it is recorded:

| # | Condition | Comes from |
|---|---|---|
| 1 | The ball is a wicket, or `runs_off_bat` is 4 or 6 | `deliveries` |
| 2 | The caller is the match's scorer | already enforced by `record_delivery` |
| 3 | The caller holds a `confirmed` booking | `venue_bookings.user_id`, `status` |
| 4 | `now()` is inside that booking, `[start_time, end_time)` | `venue_bookings` |
| 5 | That booking has an active paid entitlement | `light_entitlements` (new) |
| 6 | That court has an enabled device | `court_devices` (new) |
| 7 | The court is under its rate limit | `light_events` (new) |

If any check fails: **the ball still saves, no light fires, and the reason is
logged** (except failing #1 or #2, which are not light events at all).

Start and end time are read from the booking at fire time and never copied, so a
cancelled or moved booking takes effect immediately with no sweep job. There is
no "revoke at slot end" step to fail: the window simply stops matching.

## Decisions, and why

### The rule follows the slot holder, not the match

The obvious rule ("the match must be linked to the booking") does not survive
contact with the data. Live counts on 30 Oct 2026:

| | Linked to a booking |
|---|---|
| Bookings with a `match_id` | 3 of 20 |
| Scored matches | 2 of 15 |
| "Next round" matches (`rematch_of`) | 0 of 15 |

`create_rematch` makes a new match that no booking points at, and players book
without linking at all. So the match is not used to find the booking. The scorer
is: **"the person scoring holds this court right now, and has paid for lights on
it."** That is also the owner's rule as stated, and it makes a fake match
harmless, since the slot is theirs and is paid for anyway.

If the caller holds two paid courts at once, the booking linked to this match
wins. If neither is linked, nothing fires (`ambiguous_court`).

### Scorer must be the booker (owner's decision, 30 Oct 2026)

If a friend scores, the lights stay dark and the log says `scorer_not_booker`.
Naming a delegate later is one nullable column, `light_entitlements.scorer_id`,
and one changed condition. Not in v1. Revisit it if the log shows paid slots
being scored by someone else.

### The check is a separate function, called from `record_delivery`

`record_delivery` gets one guarded call and nothing else changes. A failure in
the lights code **must never stop a ball being scored**, so the call sits in its
own exception block. `record_delivery` is the only way a ball gets in: the table
has no insert policy. A trigger would also fire on anything else that ever
inserts, and could not see the caller as clearly.

### "Paid" means a staff member said so

There is no payment system and none is being built. A grant is a row recording
who, when, how much and how it was paid. Razorpay later writes the same row.

Grants are append-only. Revoking sets `revoked_at` and regranting adds a new
row, so "who switched this on for their friends?" is always answerable.

### Venue staff is a new concept

`app_role` has only `moderator` and `superadmin`, which are global. A counter
worker must not get either, so there is a small `venue_staff` table scoped to one
venue. Superadmins can act on any venue.

### Late is the same as never

A blink 40 seconds late is worse than none. Each event carries
`expires_at = least(now() + 10 seconds, booking.end_time)`. There is one retry
inside that window and no replay after it. The slot end is therefore enforced
three times: at the check, again just before sending, and on the device.

### Undo never un-fires and never re-fires

The light has already happened. Undo deletes the delivery; the log row stays with
its `delivery_id` nulled. Re-tapping is a new ball and may fire again, which is
what the rate limit is for.

### Safety limits live in the hardware

The cloud rate limit is about cost and abuse. The eye-safety cap (how long, how
often) must be in firmware or the driver circuit, because a cloud rule cannot be
trusted with it.

## Tables (draft)

All three have RLS on and **no policies**, like `notification_jobs`. Clients reach
them only through the RPCs below.

```sql
-- Who may mark bookings paid at one venue.
create table public.venue_staff (
  venue_id  uuid not null references public.venues(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  added_by  uuid references public.profiles(id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (venue_id, user_id)
);

-- Which physical device serves which court. The token is NOT here: it is in
-- Vault under feed_secret_name, read only by the service role.
create table public.court_devices (
  venue_id          uuid not null references public.venues(id) on delete cascade,
  court_number      integer not null check (court_number >= 1),
  feed_secret_name  text not null unique,
  enabled           boolean not null default true,  -- the per-court kill switch
  updated_at        timestamptz not null default now(),
  primary key (venue_id, court_number)
);

-- Append-only: a revoke sets revoked_at, a regrant inserts a new row.
create table public.light_entitlements (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.venue_bookings(id) on delete cascade,
  amount_paise  integer not null check (amount_paise >= 0),
  method        text not null check (method in ('cash', 'upi', 'comp')),
  granted_by    uuid not null references public.profiles(id),
  granted_at    timestamptz not null default now(),
  revoked_by    uuid references public.profiles(id),
  revoked_at    timestamptz
);
create unique index light_entitlements_one_active
  on public.light_entitlements (booking_id) where revoked_at is null;

-- Every fire AND every skip, with the reason: this answers "I paid and nothing
-- blinked". Doubles as the outbox.
create table public.light_events (
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
create index light_events_court_recent
  on public.light_events (venue_id, court_number, created_at desc);
```

`delivery_id` being unique means one ball can never fire twice. `on delete set
null` keeps the log when a ball is undone.

## The check (draft)

```sql
create function public.enqueue_light_event(in_delivery public.deliveries, in_uid uuid)
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
  -- Wicket first: a run-out off a no-ball is a wicket, not runs.
  v_event := case
    when in_delivery.wicket_type is not null then 'WICKET'
    when in_delivery.runs_off_bat = 6 then 'SIX'
    when in_delivery.runs_off_bat = 4 then 'FOUR'
  end;
  if v_event is null then return; end if;

  select match_id into v_match from public.innings where id = in_delivery.innings_id;

  -- Bookings this user holds right now. Half-open, so a back-to-back booking
  -- on the same court hands over cleanly at the exact minute.
  select count(*) into v_count from public.venue_bookings b
   where b.user_id = in_uid and b.status = 'confirmed'
     and now() >= b.start_time and now() < b.end_time;

  if v_count = 0 then
    v_reason := case
      when exists (
        select 1 from public.venue_bookings b
         join public.matches m on m.id = v_match
         where b.status = 'confirmed' and b.venue_id = m.venue_id
           and now() >= b.start_time and now() < b.end_time
      ) then 'scorer_not_booker'
      else 'no_active_booking' end;
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
      if v_device.venue_id is null then v_reason := 'no_device';
      elsif not v_device.enabled then v_reason := 'device_disabled';
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
    perform public.dispatch_light_event(v_id);  -- net.http_post, read from Vault
  end if;
end;
$$;
```

The one change to `record_delivery`, straight after its insert:

```sql
  begin
    perform public.enqueue_light_event(v_row, v_uid);
  exception when others then
    -- Lights are never allowed to stop a ball being scored.
    raise warning 'enqueue_light_event failed for %: %', v_row.id, sqlerrm;
  end;
```

`net.http_post` only queues inside the transaction, so a rolled-back ball sends
nothing.

## RPCs the app calls

| RPC | Who | Does |
|---|---|---|
| `set_lights_paid(booking_id, amount_paise, method)` | venue staff, superadmin | Grants. Refuses a cancelled or finished booking. |
| `revoke_lights_paid(booking_id)` | venue staff, superadmin | Sets `revoked_by`, `revoked_at`. |
| `list_venue_bookings_for_staff(venue_id, date)` | venue staff, superadmin | Bookings with their lights status, for the counter screen. |
| `get_my_lights_status(match_id)` | the scorer | `{ active, court, until }` for a "Lights on until 7:00 PM" chip. Display only: it decides nothing. |
| `set_court_device_enabled(venue, court, enabled)` | venue staff, superadmin | The kill switch. |
| `send_test_blink(venue, court)` | venue staff, superadmin | Queues a `TEST` event through the same pipeline. |

Each raises the app's usual tokens, for example `NOT_VENUE_STAFF` and
`BOOKING_FINISHED`.

## Edge Function: `light-event`

Called by `pg_net` with `{ "event_id": "…" }`.

1. **Authenticate the caller** against Vault, as `verify_notify_wave_caller` does.
   One copy of the secret. That guard failing silently is exactly what kept
   `notify-wave` dead for weeks, so a rejected call here must log loudly.
2. **Claim** via `claim_light_event(id)` (service role only), which atomically
   flips `queued` to `sending`, re-checks `expires_at` and the booking's status and
   end time, and returns the feed token. If stale, it marks the event `expired`
   and stops.
3. **Send** to ThingsBoard with a 3-second timeout:
   `POST {TB_HOST}/api/v1/{feed_token}/telemetry`
   `{ "event": "SIX", "event_id": "…", "expires_at": 1793101104 }`
4. **Record** `sent` or `failed`. Retry once only if still before `expires_at`.

## ThingsBoard and the device

ThingsBoard carries messages and holds no business rules. It never decides who
may fire.

- **Two identities per court.** A *feed* device (its token is in Vault, used only by
  the Edge Function) and a *controller* device (its own MQTT credentials, on the
  ESP32). A stolen ESP32 then cannot inject events into the feed.
- **Rule chain:** feed telemetry → look up the related controller → one-way RPC
  `blink` with `{ event, event_id, expires_at }`. No persistent RPC, so nothing is
  queued for a reconnect.

**The ESP32 must:**

| Requirement | Why |
|---|---|
| Stay dark until its clock is set by NTP | Without a real clock it cannot judge expiry |
| Ignore a command past `expires_at` | The slot cut-off holds even if the cloud is slow |
| Remember recent `event_id`s, ignore repeats | No double blink on a redelivery |
| Hard-cap blink length and rate | Eye safety; not cloud-configurable |
| Have a physical off switch at the court | Staff can always stop it |
| Fail dark on disconnect or reboot | Never stuck on |

## Screens

- **Scorer:** a small "Lights on until 7:00 PM" chip on the scoring screen. No other
  change for players.
- **Venue staff:** today's bookings, a "Lights paid" control with amount and method,
  a per-court on/off switch and a Test blink button. This is the only real new
  screen.
- **Admin:** assign staff to a venue and map courts to devices.

Device online/offline status is **not** in v1: it needs ThingsBoard API credentials
on our side. Staff use Test blink and the ThingsBoard dashboard for now.

## Testing

`supabase/tests/` must never run on production, so this needs a Supabase branch or
a local stack. The cases that matter most:

| Case | Expected |
|---|---|
| Booker, paid, in slot, taps 6 | `queued`, sent |
| Same, taps 2 | no event row |
| Booker, paid, one minute after slot end | `no_active_booking` |
| Booker, in slot, not paid | `not_paid` |
| Grant revoked mid-slot | `not_paid` from the next ball |
| Booking cancelled mid-slot | `no_active_booking` |
| Friend scores | `scorer_not_booker` |
| Round 2 with no booking link | fires |
| Two paid courts, neither linked | `ambiguous_court` |
| 7th event in a minute | `rate_limited` |
| Undo, then re-tap | log row kept, new row for the new ball |
| `enqueue_light_event` throws | ball still saved |
| Non-staff calls `set_lights_paid` | `NOT_VENUE_STAFF` |
| Staff of venue A acts on venue B | `NOT_VENUE_STAFF` |

Then on the bench, with no court needed: a late command, a duplicate command, Wi-Fi
pulled mid-event, and a reboot.

## Build order

1. **Hardware proof of concept (separate track):** a manual blink from the
   ThingsBoard dashboard. Measure the real delay on venue Wi-Fi.
2. **Tables, the check and tests** on a branch: event rows appear with the right
   status, nothing sent yet.
3. **Edge Function and rule chain:** a tap on a test court blinks a bench ESP32.
4. **Staff screen.**
5. **Pilot:** one venue, one court, one week, with success measures agreed first.

## Open decisions

1. **Price.** Refunds will be offered; the terms are being agreed with box owners.
2. **Who owns the hardware,** and who pays for it?
3. **Laser class and legal check.** Needs someone qualified before any public use.
4. **What makes the pilot a success?** For example, the share of bookings that pay.

## Decided

- **Booker only:** a friend scoring means no lights.
- **A no-ball hit for 4 or 6 fires the lights** (owner, 31 Oct 2026). A wide run for
  4 does not: nothing came off the bat. This needs
  `20261031090000_fix_extras_double_counting.sql` applied first, because until then
  the keypad's wide also carries `runs_off_bat` = 4 and would fire.
- **ThingsBoard Cloud, Free plan, for now.** Checked on 31 Oct 2026 at
  thingsboard.io/docs/paas/subscription: 5 devices, 3 rule chains, 0.5M transport
  messages and 3M rule engine executions a month, 100K JavaScript executions, 30-day
  retention. At two devices per court (feed and controller) **that is 2 courts**,
  enough for the pilot; a third court needs a paid plan or a shared feed device.
  Shared rule engine pool, so measure the real delay; there is no latency guarantee.

## As built (18 Nov 2026)

Differences from the draft above:

- **One ThingsBoard device per court**, the ESP32 itself (owner's setup), not a
  feed + controller pair. The app posts telemetry to that device's token; its
  rule chain sends the RPC back to the same device. On the Free plan that is 5
  courts, not 2.
- **An ordinary match logs nothing.** A 4/6/W from a scorer with no booking is
  only logged (`scorer_not_booker`) when someone else holds a court at that
  match's venue right now. Otherwise every boundary in the app would add a row.
  `no_active_booking` stays in the check constraint but is not written.
- **Device tokens are entered in the app** (Court Lights → "Link ThingsBoard
  device", superadmin only). `set_court_device_token` writes Vault directly;
  the token is never readable back by any client.
- **Staff are added by phone number** on the same screen (superadmin only),
  matched on the last 10 digits of `profiles.phone` or `auth.users.phone`.
- **Test blink reports back**: the screen follows the TEST event for ~8 s and
  says whether ThingsBoard accepted it (`get_light_event_status`).
- Vault rows `light_event_url` and `light_event_secret` were created on the live
  project on 18 Nov 2026; the secret was generated inside the database and has
  never been printed.
- `TB_HOST` (Edge Function secret) defaults to `https://thingsboard.cloud`. Set
  it if the account is on another host (for example `https://eu.thingsboard.cloud`).

### Player controls (owner, 18 Nov 2026)

`20261118100000_court_lights_player_controls.sql`:

- **Lights venues are automatic.** Any venue with a linked device on any court
  shows a "Court lights" badge on the Venues tab; lit courts carry a "Lights"
  tag in the court picker (`list_light_courts`).
- **Booker opt-out.** Booking a lit court shows "Blink lights on 4, 6 and
  wickets" (on by default). Off sets `venue_bookings.lights_wanted = false`.
- **On/off by the scoreboard.** The booker gets Turn off / Turn on next to the
  lights status during the slot (`set_booking_lights`, booker only, refused
  after the slot). Off → `booker_turned_off`; a blink already queued is dropped
  at claim.
- **Everyone on the match** sees the status (`get_match_lights`): ON until X /
  turned off by booker / pay at the counter / switched off by the ground.
  Strangers see nothing.
- The counter screen shows "Booker switched lights off" on such bookings.

Verified live in a rolled-back transaction: no device → no status; link →
1 lit court; booker sees court/paid/wanted/enabled; off → `booker_turned_off`;
on → `queued`; off after queue → `expired`; stranger sees nothing and gets
`NOT_YOUR_BOOKING` on toggle.

### Verified on 18 Nov 2026 (live, inside rolled-back transactions)

Not paid → `not_paid`; paid, no device → `no_device`; paid + device → `queued`;
2 runs → no row; wicket → `WICKET`; 7th event in a minute → `rate_limited`;
device off → `device_disabled`; revoked → `not_paid`; booking cancelled before
the send → `expired/slot_over`; after the slot → no row; chip shows for the
booker only; non-staff → `NOT_VENUE_STAFF`; staff setting a token →
`NOT_SUPERADMIN`. Pipeline: pg_net → `light-event` → caller check → claim →
refused with `device_disabled` when no device is linked. `record_delivery` live
matches the migration byte for byte.

**Not yet verified:** a real blink. That needs a device token linked and the rule
chain below in ThingsBoard.

## Hardware hand-off: what ThingsBoard and the ESP32 receive

### 1. What the app sends

For every 4, 6 or wicket that passes the rule, and for every Test blink:

```
POST {TB_HOST}/api/v1/{device access token}/telemetry
{ "event": "SIX", "event_id": "8f1c…", "expires_at": 1795001234 }
```

`event` is `FOUR`, `SIX`, `WICKET` or `TEST`. `expires_at` is Unix seconds,
at most 10 seconds after the ball and never past the end of the slot.

### 2. Rule chain (ThingsBoard → Rule chains → Root, or the device profile's chain)

After the **Save Timeseries** node, add:

1. **Script filter** (`True` output continues):
   `return msg.event === 'FOUR' || msg.event === 'SIX' || msg.event === 'WICKET' || msg.event === 'TEST';`
2. **Script transformation**:
   ```js
   return {
     msg: { method: 'blink', params: { event: msg.event, event_id: msg.event_id, expires_at: msg.expires_at } },
     metadata: metadata,
     msgType: 'RPC_CALL_FROM_SERVER_TO_DEVICE'
   };
   ```
3. **RPC call request** node (sends to the originator, i.e. the same device).
   Timeout 10 s. Do not make it persistent: a late blink must be dropped.

### 3. What the ESP32 receives

Over MQTT on `v1/devices/me/rpc/request/+`:

```
{ "method": "blink", "params": { "event": "SIX", "event_id": "8f1c…", "expires_at": 1795001234 } }
```

Suggested patterns: SIX = 6 flashes, FOUR = 4, WICKET = 3 red, TEST = 1 long.

Firmware today "just blinks". Before public use it should also: ignore a
command whose `expires_at` has passed (after NTP sync), ignore a repeated
`event_id`, hard-cap blink length and rate for laser safety, and fail dark on
disconnect. The cloud still enforces the slot without these; they are defence
in depth.

### 4. Linking a court

ThingsBoard → Devices → the court's ESP32 → **Copy access token**. In the app:
Settings → Court Lights → Court N → **Link ThingsBoard device** → paste → Save
→ **Test blink**.

## Also needs updating when this ships

- `docs/PRIVACY_POLICY.md` and the live page: venue staff see bookers, and fire and
  skip events are logged.
- `delete_my_account` removes future bookings, which cascades to their grants. A
  user who paid at the counter and then deletes their account loses that record, so
  decide this alongside refunds.
- `CLAUDE.md`, with the rules above.
