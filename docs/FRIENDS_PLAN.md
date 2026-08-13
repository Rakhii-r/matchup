# Friends — implementation plan

**Date:** 11 August 2026 · **Status:** proposed, not built

## Why this exists, and what it replaces

The open question was "there should be a user ID for inviting a user into a team."
Every user already has a unique ID (`profiles.id`, a UUID keyed to `auth.users.id`),
but it is not shareable and there is no way to refer to a *person* — only to a team,
via `teams.invite_code`.

Building a user search directory to solve that is the wrong shape: value scales with
density, and a search box over strangers is an enumeration and harassment surface.

A **friend graph** is the right shape. It gives every user a person-level identifier
worth having, and it makes targeted team invites fall out for free — "invite to team"
becomes a picker over your friends list, never a search over strangers.

So the dependency runs:

```
friend_code  →  friend requests  →  friends list  →  targeted team invite
```

Not `user directory → team invite`.

---

## 1. Data model

### 1.1 `profiles` additions

```sql
alter table public.profiles
  add column friend_code text unique check (char_length(friend_code) = 6),
  add column discoverable_by_phone boolean not null default false;
```

`friend_code` reuses `gen_share_code()` — the same 32-character unambiguous alphabet
(`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, no I/O/0/1) already used for team invite codes
and match share codes. 32^6 ≈ 1.07 billion, which is enough given the rate limit in §3.

`gen_share_code()` is random and volatile, so it cannot be a column DEFAULT — a
collision would fail the insert. Assign it in a BEFORE INSERT trigger that loops
until the unique index accepts it, and backfill existing rows the same way.

`discoverable_by_phone` defaults to **false** and ships unused. The column exists now
so that enabling phone lookup later is a feature flag rather than a migration on a
live table. See §7.

### 1.2 `friendships`

One row per relationship, not per direction.

```sql
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending','accepted','declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,

  -- Canonical pair ordering so A→B and B→A cannot both exist.
  -- CASE rather than LEAST/GREATEST: generated columns require a provably
  -- immutable expression and plain comparison operators are the safe form.
  user_lo uuid generated always as
    (case when requester_id < addressee_id then requester_id else addressee_id end) stored,
  user_hi uuid generated always as
    (case when requester_id < addressee_id then addressee_id else requester_id end) stored,

  constraint friendship_not_self check (requester_id <> addressee_id)
);

create unique index friendships_pair_uidx    on public.friendships (user_lo, user_hi);
create index friendships_requester_idx        on public.friendships (requester_id);
create index friendships_addressee_idx        on public.friendships (addressee_id);
create index friendships_addressee_pending_ix on public.friendships (addressee_id)
  where status = 'pending';
```

**Why `declined` is stored rather than deleted.** Deleting on decline lets a rejected
user re-send immediately and forever. Keeping the row with `responded_at` lets
`send_friend_request` enforce a cooldown (§2.2). The requester is never told they were
declined — the request simply stays pending from their side until the cooldown lapses.
This is the standard anti-harassment behaviour and matters more here than elsewhere,
because the app is location-based.

### 1.3 `lookup_attempts` (rate limiting)

```sql
create table public.lookup_attempts (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  window_start timestamptz not null default date_trunc('hour', now()),
  attempts     integer not null default 0,
  primary key (user_id, window_start)
);
alter table public.lookup_attempts enable row level security;
-- No policies. Server-only, exactly like notification_jobs.
```

---

## 2. RPCs

All `SECURITY DEFINER`, `set search_path = public`, `revoke execute ... from anon,
public` then `grant ... to authenticated`. All raise stable error tokens the client
maps to copy — the same contract as `join_team` and `respond_to_challenge`.

### 2.1 `find_player_by_code(in_code text)`

Returns at most one row: `id, full_name, avatar_url, area_name`. Never the phone
number, never the friend code of anyone else.

Order of checks:

1. `NOT_AUTHENTICATED` if `auth.uid()` is null
2. `RATE_LIMITED` if the caller is over budget (§3)
3. `PLAYER_NOT_FOUND` if no match, if the account is inactive, **or if
   `is_blocked_between(caller, target)`** — one indistinguishable error for all three.
   Same discipline `join_team` already uses for blocked team owners: never confirm a
   person exists to someone they have blocked or been blocked by.

### 2.2 `send_friend_request(in_addressee_id uuid)`

Takes a UUID, not a code. `profiles.id` is already visible to any signed-in user
through match rosters and team member lists, so this is not a new disclosure — and it
means the highest-value entry point works: *add the person you just played with*,
straight from the match roster, no code exchange at all.

Checks, in order: authenticated · both accounts active · not self · not blocked either
way · no existing `accepted` row (idempotent, return it) · no existing `pending` row
(idempotent, return it) · if an existing `declined` row is younger than 7 days, raise
`REQUEST_COOLDOWN`; if older, reset it to `pending` and re-notify.

Lock the pair row `for update` before deciding, so two simultaneous requests in
opposite directions cannot both insert.

### 2.3 `respond_to_friend_request(in_request_id uuid, in_accept boolean)`

Only the **addressee** may call it, and only on a `pending` row. Sets `status` and
`responded_at`. Enqueues a notification on accept, and **nothing on decline**.

### 2.4 `cancel_friend_request(in_request_id uuid)`

Requester-only, `pending`-only. Deletes the row outright — a withdrawn request should
not create a cooldown against the addressee.

### 2.5 `unfriend(in_user_id uuid)`

Either party. Deletes the `accepted` row. No notification.

### 2.6 `are_friends(a uuid, b uuid) returns boolean`

`SECURITY DEFINER`, `stable`. Needed so that any future policy referencing friendship
does not recurse — the same reason `is_team_member` exists.

---

## 3. Rate limiting

`find_player_by_code` increments `lookup_attempts` for the caller's current hour and
raises `RATE_LIMITED` past **30 per hour / 100 per day**. A friend code is one of 1.07
billion; at 100 lookups a day, enumerating a meaningful fraction takes millions of
account-years.

This matters more than the arithmetic suggests, because there is currently **no CAPTCHA
on the OTP endpoint** — an attacker who can mint free accounts can parallelise any
lookup budget across them. Ship Turnstile before this feature is public, or the rate
limit is per-account theatre. See the launch-gate list in the project backlog.

---

## 4. RLS

```sql
alter table public.friendships enable row level security;

create policy "friendships_select" on public.friendships for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

create policy "friendships_delete" on public.friendships for delete to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));
```

**No INSERT policy and no UPDATE policy — deliberately.** The RPCs are the only write
path, exactly as `join_team` is for `team_members` and `join_match` is for
`match_players`. An INSERT policy would let a client fabricate an `accepted` row and
befriend anyone whose UUID it could read off a match roster.

### 4.1 `friend_code` must NOT go on `public_profiles`

`public_profiles` is SELECT-able by every authenticated user. Putting `friend_code`
there would let anyone read everyone's code and friend-request the entire user base,
which defeats the whole design. `friend_code` stays on the base `profiles` table
(self-only RLS) and is resolvable by others **only** through
`find_player_by_code`, which is rate-limited and block-aware.

### 4.2 Blocking must tear down friendship

Add an AFTER INSERT trigger on `blocks` that deletes any `friendships` row between the
pair. Blocking someone you are friends with must actually unfriend them, or block is
cosmetic.

---

## 5. Push notifications

Reuse the existing queue — `enqueue_notification` plus a trigger, exactly as
`tg_notify_join_requested` and `tg_notify_challenge_received` already do. No new
infrastructure.

| Trigger | Recipient | Title | `data.route` |
|---|---|---|---|
| `friendships` INSERT, status `pending` | addressee | New friend request | `/friends/requests` |
| `friendships` UPDATE → `accepted` | requester | `<Name>` accepted your friend request | `/friends` |
| `friendships` UPDATE → `declined` | — | *(nothing, by design)* | — |

**Prerequisite:** none of these fire on a real phone until the three outstanding push
deployment steps are done — EAS project id, `notify-wave` deploy plus Vault secrets,
and FCM credentials. See `docs/PUSH_NOTIFICATIONS.md`. Jobs will queue correctly in the
meantime and simply sit.

---

## 6. Client

New feature module, same shape as the existing eight:

```
src/features/friends/
  data/friendRepository.ts        find / send / respond / cancel / unfriend
  domain/friendSchema.ts          Zod types, status enum, error-token → copy map
  presentation/useFriends.ts      TanStack Query hooks
```

Screens:

| Route | Contents |
|---|---|
| `app/friends/index.tsx` | Friends list. Pending-request count as a badge. |
| `app/friends/requests.tsx` | Incoming pending, Accept / Ignore. Outgoing pending, Cancel. |
| `app/friends/add.tsx` | Enter a friend code. Shows the resolved player for confirmation before sending. |
| `app/(tabs)/profile.tsx` | Own `friend_code` with copy + OS share sheet. |

**The entry point that actually matters:** an "Add friend" affordance on each row of a
match roster and each row of a team member list. Someone you just played box cricket
with is a far warmer target than a code exchange, and it needs no code at all —
`send_friend_request(uuid)` straight from the row.

All new screens use the dark `mockTheme` tokens. Do not add to the light-theme half of
the app; the split is already a known problem.

---

## 7. Targeted team invites — the payoff

Once friends exist, this is nearly free and needs **no `team_invites` table**:

Team owner opens the team → "Invite" → picks from their friends list → the server
enqueues a notification carrying `route: /teams/join?code=<invite_code>`. Tapping it
opens the Join screen pre-filled; the existing `join_team` RPC does the rest, unchanged,
with all its locking and block checks intact.

That is a genuine push-based targeted invite, and accept/decline is just "tap the
notification or don't." A pending-invite table with explicit accept/decline can come
later if the simple version proves insufficient — but it probably won't.

**Deep-link caveat.** A tappable `https://` link that opens the app (or falls back to
the Play Store for someone who doesn't have it) needs a verified domain and an
`assetlinks.json`. A custom-scheme link works today with no setup but does nothing for
a non-user. Also: **the app scheme is still `matchup`, not `p24`.** Finish that rename
*before* any link is printed or shared, because links you put in the world are permanent.

---

## 8. Deliberately deferred

| Item | Why not now |
|---|---|
| Phone-number lookup | Column ships (`discoverable_by_phone`, default false), feature does not. Indian mobile numbers are a 10-digit space with known prefixes — trivially enumerable. Revisit behind an explicit opt-in toggle, after CAPTCHA. |
| Contacts intersection | The privacy-preserving version is genuinely hard; naive phone hashing over a 10-digit space is reversible in seconds. Not a solo-dev afternoon. |
| Friend suggestions / mutual friends | Density feature. Meaningless below a few hundred real users. |
| Friends-only match visibility | Scope creep. Phase 1 is a public nearby feed. |

---

## 9. Sequencing and effort

Do the launch gates first — none of this is testable on a real phone without push, and
none of it is safe to expose without CAPTCHA.

| # | Step | Effort |
|---|---|---|
| 0 | Launch gates: commit the repo, file MSG91/DLT paperwork, Turnstile CAPTCHA, three push deploy steps, Sentry + PostHog keys | ~2 days |
| 1 | Migration: `friend_code` + backfill trigger, `friendships`, `lookup_attempts`, RLS, block teardown trigger | ~1 day |
| 2 | RPCs §2 with stable error tokens | ~1 day |
| 3 | pgTAP or SQL smoke tests for the new policies — non-negotiable, since RLS *is* the security model and there are currently zero tests | ~half day |
| 4 | Client feature module + 4 screens | ~1.5 days |
| 5 | Push kinds + notification routing | ~half day |
| 6 | Invite-friend-to-team (§7), reusing `join_team` | ~half day |

**~5 days after the gates**, of which step 3 is the one most likely to get skipped and
the one most likely to be regretted.

---

## 10. Open questions for the product owner

1. Should friendship be required before seeing another player's match history and
   reliability grade once those exist, or is that public to all signed-in users?
2. Should a friend request be possible from the nearby-players list (people you have
   not played with), or only from a shared match, team, or an explicit code?
   Restricting it to shared context is the strongest anti-harassment default.
3. Is there a cap on friend count? Not urgent, but unbounded lists eventually need
   pagination — and every list in this codebase is meant to be paginated.
