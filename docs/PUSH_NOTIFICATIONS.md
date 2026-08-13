# Push notifications — how it works and how to finish deploying it

**Added:** 8 August 2026 · **Migration:** `20260808084324_push_notifications.sql`
· **Function:** `supabase/functions/notify-wave/`

Realtime popups (`MatchJoinAlerts`) only fire while the app is open and
foregrounded. This path is what reaches an organiser whose app is closed — the
thing `ROADMAP.md` names as the head of the dependency chain.

## The path a notification takes

```
match_players INSERT/UPDATE          (or team_challenges INSERT)
        │  trigger
        ▼
notification_jobs row                 status = pending
        │  pg_cron, every minute, only when something is pending
        ▼
dispatch_notification_jobs()          reads URL + key from Vault
        │  pg_net POST
        ▼
notify-wave Edge Function             claims a batch, service role
        │
        ▼
Expo Push API  ──►  FCM / APNs  ──►  device
```

Jobs are queued as rows, never sent inline from the request path. A join that
rolls back takes its notification with it, and Expo being slow never slows down
a user's tap.

### What triggers what

| Event | Recipient | Title |
|---|---|---|
| Player requests to join | match creator | New join request |
| Creator approves a request | that player | You are in |
| Creator confirms a player | that player | Your spot is confirmed |
| Team is challenged | challenged team's owner | Match challenge |

Tapping a notification routes to `data.route` — the match screen, or the
challenges list. Only app-relative paths are accepted, so a malformed payload
cannot open an external URL.

## Status: what is done, what is left

**Done and verified against the live database:**

- Migration applied. All four triggers fire with the correct recipient and text.
- `register_device` / `unregister_device` RPCs; `authenticated` can call them,
  `anon` cannot.
- `notification_jobs` is unreadable by any client role (RLS on, zero policies).
- The trigger functions are no longer exposed as `/rest/v1/rpc/tg_notify_*`
  endpoints. `sync_filled_slots` and `add_team_owner_as_member` had the same
  exposure from earlier migrations and were closed at the same time.
- Both cron jobs scheduled and active.
- Client registers on sign-in and unregisters before sign-out.

**Three steps remain, and none of them are code.**

### 1. Get an EAS project id

`getExpoPushTokenAsync` requires one. Without it the client logs a warning and
skips registration — the app still works, it just receives nothing.

```powershell
npx.cmd eas init
```

Then put the id in `.env` (and in EAS project secrets for real builds):

```
EXPO_PUBLIC_EAS_PROJECT_ID=<the id eas init printed>
```

### 2. Deploy the function and give the database its secrets

```powershell
npx.cmd supabase functions deploy notify-wave
```

Then, in the SQL editor, store the URL and service role key in Vault. They are
deliberately not in any migration file:

```sql
select vault.create_secret(
  'https://izqknyzmeyiowbwmcfes.supabase.co/functions/v1/notify-wave',
  'notify_wave_url'
);
select vault.create_secret('<your service role key>', 'notify_wave_service_key');
```

Until these exist, `dispatch_notification_jobs()` logs a warning and returns.
Jobs still queue — nothing is lost, they simply sit until you set this up.

### 3. Android delivery credentials

Push on Android needs an FCM server key uploaded to Expo (`eas credentials`).
Expo Go can receive test pushes without it; a standalone build cannot.

## Testing it

1. Build a dev client or standalone build (`eas build --profile development
   --platform android`). **Push does not work on an emulator** — the client
   checks `Device.isDevice` and skips.
2. Sign in on a real phone, accept the permission prompt.
3. Confirm the row exists: `select user_id, platform, last_seen from devices;`
4. From a second account, request to join the first account's match.
5. Within a minute the first phone should get "New join request".

To watch the queue while testing:

```sql
select kind, status, attempts, last_error, created_at
from notification_jobs order by created_at desc limit 20;
```

`status = 'sent'` with `last_error = 'no registered device'` means the queue and
triggers are fine and the recipient simply has no device row yet — that is the
expected state before step 1 is done.

## Failure behaviour, deliberately

- **No device registered** → marked sent immediately. Not an error, and not
  retried five times over something that will never change.
- **Expo rejects one message** (bad token, etc.) → that job is marked `failed`
  with the reason. `DeviceNotRegistered` also deletes the token, so uninstalled
  apps stop accumulating dead rows.
- **Network or 5xx against Expo** → the job is left in `processing` on purpose.
  `reap_stuck_notification_jobs` (cron, every 5 min) returns it to `pending`,
  and it retries. This is the only case that retries.
- **Function crashes mid-run** → same reaper handles it.
- **Five failed attempts** → `failed`, permanently. A bad recipient cannot loop.
- Sent and failed rows are deleted after 14 days by the same reaper.

## Operational notes

- `claim_notification_jobs` uses `FOR UPDATE SKIP LOCKED`, so a slow run
  overlapping the next cron tick cannot double-send.
- `devices.fcm_token` holds an **Expo** push token, not a raw FCM token. The
  column name predates the decision to use Expo's relay; it was left alone
  rather than renamed under live data. There is a comment on the column saying
  so.
- Sign-out unregisters the token *before* `supabase.auth.signOut()`, because
  `unregister_device` is scoped by `auth.uid()`. Reordering those two lines
  would leak the previous user's notifications to whoever signs in next.
