# MatchUp — Admin Roles, Venue Management & Slot Booking (Design Spec)

**Status:** REVIEWED — decisions recorded 2026-07-17 (see §10). Full calendar deferred to **Phase 2**; Phase 1 builds the fallback (request → admin approve). Nothing has been built or migrated.
**Author:** Claude (with ASR Digi Solutions)
**Date:** 2026-07-17
**Supersedes:** extends the static venue directory described in `MatchUp_Phase1_Requirements.docx`.

---

## 1. Purpose

Add two capabilities to MatchUp:

1. An **admin role** that manages the venue directory and controls all bookings from inside the same mobile app (admins see extra screens; normal users do not).
2. A **full slot-booking calendar**: every venue exposes bookable time slots, users book a slot while creating a match, and the database automatically prevents double bookings.

## 2. Scope conflict — read before approving

`CLAUDE.md` and the Phase 1 docs explicitly exclude **live venue availability** from Phase 1 (the Phase 1 venue directory is static, "call to confirm"). A full slot calendar is that excluded feature. Approving this spec means consciously pulling a Phase 2/3 feature forward.

**Impact estimate:** roughly 2–3 additional sprint-weeks versus the "request → admin approves" model (which needs no slot generation, no conflict engine, and no calendar UI).

**Simpler fallback (recorded for the record):** user requests a venue + time as free text, admin approves/rejects. If timelines slip, this spec's data model degrades gracefully to that flow — build the `bookings` table without the slot engine and add the calendar later.

**DECIDED (2026-07-17):** fallback (request → admin approve) ships in **Phase 1**; full slot calendar moves to **Phase 2**. The data model below is written so the calendar drops in later without schema rework — Phase 1 builds `bookings` without the slot engine (`get_venue_slots`, on-grid validation, exclusion constraint on time ranges); admin approval replaces auto-conflict blocking.

## 3. Roles & permissions

| Capability | User | Admin |
|---|---|---|
| Create profile, create/join match | ✅ | ✅ |
| Browse venues & slots | ✅ | ✅ |
| Book a slot (for own match) | ✅ | ✅ |
| Cancel own booking | ✅ | ✅ |
| Add / edit / archive venues | ❌ | ✅ |
| Set venue hours, slot length, courts | ❌ | ✅ |
| Block slots (maintenance, offline bookings) | ❌ | ✅ |
| View / cancel / override any booking | ❌ | ✅ |
| Promote a user to admin | ❌ | ❌ (SQL only, deliberately) |

- Roles live in a core `roles` table (`admin`, `user`) with a `user_roles` mapping table (§4.1).
- First admin is set manually via SQL. No in-app promotion path — smaller attack surface.
- All enforcement is in **Postgres RLS**; the client is untrusted per project architecture rules. Admin screens hidden in UI is cosmetic only.

## 4. Data model

Minimal design: three changed/new tables. No separate `slots` table — slots are **computed** from venue settings; only *taken* time is stored. This avoids generating and maintaining thousands of empty slot rows.

### 4.1 Roles — `roles` lookup + `user_roles` mapping (new)

Roles live in a core lookup table; users map to roles via a junction table (allows more roles later — e.g. `venue_owner` in a future phase — without schema change).

```sql
create table roles (
  id   smallint primary key,
  name text not null unique          -- 'admin', 'user'
);
insert into roles (id, name) values (1, 'admin'), (2, 'user');

create table user_roles (
  user_id  uuid not null references profiles(id) on delete cascade,
  role_id  smallint not null references roles(id),
  primary key (user_id, role_id)
);
```

- Every new profile gets the `user` role via trigger on profile creation.
- Admin assignment: manual SQL insert into `user_roles` only (no in-app path).
- RLS on both tables: SELECT own rows (or all if admin); no client INSERT/UPDATE/DELETE.
- `is_admin()` (§5) checks `user_roles` join `roles` for `name='admin'`.

### 4.2 `venues` (change — booking settings added)

| Column | Type | Notes |
|---|---|---|
| `sport` | text | `'box_cricket'` \| `'badminton'` |
| `courts_count` | int | boxes/courts available in parallel, default 1 |
| `open_time` / `close_time` | time | e.g. 06:00 / 23:00 IST |
| `slot_minutes` | int | e.g. 60; slots start on the hour from `open_time` |
| `open_days` | int[] | ISO weekday numbers, e.g. `{1,2,3,4,5,6,7}` |
| `is_bookable` | boolean | `false` = directory-only ("call to confirm") venue |
| `price_per_slot` | numeric, nullable | display only, ₹; no payment collection (§10 decision) |
| `price_notes` | text, nullable | e.g. "₹800/hr weekdays, ₹1000/hr weekends" |

Existing directory columns (name, address, geo point, phone, photos) unchanged. `is_bookable=false` keeps the Phase 1 static-directory behaviour available per venue.

### 4.3 `bookings` (new)

One table stores both user bookings **and** admin blocks.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `venue_id` | uuid fk → venues | |
| `court_no` | int | 1..`courts_count`; assigned at booking time |
| `time_range` | tstzrange | slot start/end, UTC in DB, IST in UI |
| `kind` | text | `'booking'` \| `'admin_block'` |
| `status` | text | `'confirmed'` \| `'cancelled'` |
| `match_id` | uuid fk → matches, nullable | null for admin blocks |
| `booked_by` | uuid fk → profiles | |
| `cancelled_by` / `cancelled_at` / `cancel_reason` | | audit trail |

### 4.4 Double-booking prevention (the core mechanism)

A Postgres **exclusion constraint** makes conflicts impossible at the database level — not app logic, not a race-prone check-then-insert:

```sql
create extension if not exists btree_gist;

alter table bookings add constraint no_double_booking
  exclude using gist (
    venue_id with =,
    court_no with =,
    time_range with &&
  ) where (status = 'confirmed');
```

Two confirmed rows can never overlap on the same court. Cancelled rows free the slot automatically. Concurrent booking attempts: one succeeds, the other gets a constraint error mapped to "slot just taken — pick another".

### 4.5 Booking is an RPC, not a direct insert

`book_slot(venue_id, starts_at, match_id)` — `security definer` Postgres function that validates the slot against venue settings (inside hours, on-grid start, open day, `is_bookable`), finds a free `court_no`, and inserts. Client never chooses `court_no` and never inserts into `bookings` directly. Slot-grid rules live in one place.

### 4.6 Availability query

`get_venue_slots(venue_id, date)` — RPC returning the day's computed slot grid with `available_courts` per slot (venue settings minus confirmed bookings). Client renders this directly; no client-side slot math.

## 5. RLS outline

| Table | Policy |
|---|---|
| `venues` | SELECT: any authenticated. INSERT/UPDATE/DELETE: `role='admin'` only. |
| `bookings` | SELECT: own rows, or any row if admin, or rows of matches user has joined. INSERT: **none** (RPC only). UPDATE: user may set own `status='cancelled'` before slot start; admin may update any row. |
| `roles` / `user_roles` | SELECT: own mapping (admin: all). No client INSERT/UPDATE/DELETE — role changes via SQL only. |

Admin check helper (avoids recursive-policy pitfalls):

```sql
create function is_admin() returns boolean language sql stable
security definer as $$
  select exists (
    select 1 from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.name = 'admin'
  );
$$;
```

## 6. User flows

### 6.1 User — book while creating a match

1. Create match → pick sport → venue list shows bookable venues (nearest first, paginated).
2. Pick venue → day picker → slot grid from `get_venue_slots` (available / full / blocked).
3. Pick slot → confirm → `book_slot` RPC → match saved with `booking_id`.
4. Conflict error → "Slot just taken" → grid refreshes.
5. Cancelling the match cancels the booking (single transaction / RPC).

Matches at non-bookable venues keep the Phase 1 flow: venue attached as directory info, "call to confirm" label, no slot step.

### 6.2 Admin — manage venues

Admin tab (visible only when `role='admin'`, enforcement in RLS):

- **Venues:** list + add/edit form (details, photos, geo via map pin, sport, courts, hours, slot length, open days, `is_bookable` toggle). Archive instead of delete once bookings exist.
- **Bookings:** day view per venue of all bookings; cancel with reason (booker notified via FCM); create `admin_block` rows for maintenance/offline bookings (blocks all or specific courts).

## 7. Edge cases

| Case | Handling |
|---|---|
| Two users, same slot, same moment | Exclusion constraint — second gets clean error. |
| User cancels near slot start | Cancellation cutoff (default 2h, per-venue override). After cutoff, only admin can cancel. |
| Admin changes venue hours with future bookings | Existing bookings stand; new grid applies to new bookings only. Admin sees warning listing affected bookings. |
| Match deleted / all players leave | Booking auto-cancelled, admin notified. |
| Timezone | Store UTC (`tstzrange`), render IST. No DST in India. |
| Admin books for someone | Allowed: admin creates booking with `booked_by` = target user. |
| Venue archived with future bookings | Blocked until bookings cancelled/completed. |

## 8. What is deliberately NOT included

- Payments / advance collection.
- Venue-owner accounts or venue-side app.
- Live sync with venues' own calendars (offline bookings entered manually by admin as blocks).
- Multi-admin permission tiers.
- Recurring bookings.
- In-app admin promotion UI.

## 9. Build plan (when approved)

1. **Migration** — role column, venue columns, `bookings`, exclusion constraint, RLS, `is_admin`, `book_slot`, `get_venue_slots` → verify: SQL tests prove double-book rejected, non-admin writes to `venues` rejected.
2. **Feature module `src/features/venues` + `bookings`** — repositories + TanStack Query hooks → verify: typecheck + unit tests against local Supabase.
3. **User UI** — slot grid in match-creation flow → verify: book/conflict/cancel paths on device.
4. **Admin UI** — admin tab, venue CRUD, bookings day view, blocks → verify: non-admin account sees nothing and RLS blocks direct API calls.
5. **Notifications** — FCM on admin cancel / auto-cancel → verify: delivered on physical device.

Estimate: ~2.5–3 sprint-weeks on top of current Phase 1 plan.

## 10. Decisions (answered by ASR, 2026-07-17)

1. **Calendar timing:** full slot calendar → **Phase 2**. Phase 1 ships request → admin approve (fallback in §2).
2. **Cancellation cutoff:** **2 hours** confirmed (per-venue override stays).
3. **Slot privacy:** other users' bookings show only **"unavailable"** — never who booked.
4. **Pricing:** **info only** — venues display price (`price_per_slot`, `price_notes`); **no payment collection** in this phase.

## 11. Phase 1 build slice (what "build it" means now)

Reduced from §9 for the fallback model:

1. **Migration** — `roles` + `user_roles` (+ default-role trigger), venue columns (incl. pricing, `is_bookable`), `bookings` table with `status in ('pending','confirmed','rejected','cancelled')`, RLS, `is_admin()` → verify: non-admin venue writes rejected; user sees only own bookings.
2. **Booking request flow** — user picks venue + preferred date/time when creating match → row with `status='pending'`.
3. **Admin UI** — admin tab: venue CRUD, pending-requests list with Approve / Reject (+ reason) → FCM notify requester.
4. **No slot engine yet** — no `get_venue_slots`, no exclusion constraint, no `book_slot` RPC. Those arrive in Phase 2 with zero schema rework.
