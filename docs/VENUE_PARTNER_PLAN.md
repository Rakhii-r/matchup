# Venue Partner: owner login and venue management (plan, 23 Nov 2026)

**Status:** Phase 1 BUILT (23 Nov 2026, `20261123110000_venue_partner_owners.sql`,
live). Phases 2–4 still plan. Phase 1 as built:
- `venue_staff.role` ('owner'/'staff'), `is_venue_owner`, `is_venue_member`.
- `venues_select` RLS now = approved, or admin, or the venue's own owner/staff.
  Before, pending/hidden venues were readable by everyone and showed on the
  Venues tab.
- RPCs `register_venue`, `update_venue_details`, `list_my_partner_venues`,
  `admin_assign_venue_owner`, `admin_list_venue_owners`; shared checks in
  `validate_venue_input`. Owners upload the cover photo to
  `venue-images/partner/<venue_id>/cover.jpg` (storage policy
  `venue_images_owner_write`).
- App: `app/partner/` (home, register, `[venueId]/edit`), `src/features/partner/`,
  Settings → VENUE → "List your venue" / "Venue Partner", Admin → Venues shows
  the owner and "Assign owner" (superadmin).
- Tested live in rolled-back transactions: register → pending, owner lists
  and edits it, cannot edit another venue, bad input refused, non-admin
  cannot assign, a stranger cannot see the pending venue, admin assign works.

Decided with the owner:
- **Same app.** A venue owner signs in with the normal phone OTP. A "Venue
  Partner" section appears only for people who own or staff a venue.
- **Owner registers, admin approves.** Owners submit their venue; it stays
  hidden (`status = 'pending'`) until an admin approves it. Admins can also
  hand an existing venue to an owner by phone number.
- **v1 scope:** venue details and location, prices, bookings calendar,
  walk-in / blocked slots with new-booking alerts.

Reference: Playo Partner (scheduler, pricing engine, booking alerts, reports,
memberships). Its reviews complain about slowness at the counter, so the
bookings screen must open fast and show today first. Memberships and reports
are out of v1.

## What already exists (reuse, don't rebuild)

| Piece | Where |
|---|---|
| `venues` with `status` approved/pending/hidden, hours, `slot_duration_minutes`, `courts_count`, `price_per_hour` (all null today), `image_url`, `facilities` | `20260830120000_venue_status.sql`, `20260815070000_venue_media_and_facilities.sql` |
| Venue photo bucket | `20260815070000` |
| `venue_staff` (venue_id, user_id) and `can_manage_venue_lights` | `20261118090000_court_lights.sql` |
| `venue_bookings` with an exclusion constraint per court | `20260905062131` |
| Push via `notification_jobs` / `enqueue_notification` | `20260808084324` |
| Admin approve/hide (`set_venue_status`), admin venues screen | `app/admin/venues.tsx` |
| `expo-location`, `expo-image-picker` | already installed |

## Data model

1. **Roles: extend `venue_staff`** with `role text not null default 'staff'
   check (role in ('owner','staff'))`. An owner manages everything about the
   venue; staff see bookings, block slots and run lights. One table, so an
   owner automatically gets the Court Lights screen too.
   `is_venue_owner(venue, uid)` and `is_venue_staff(venue, uid)` helpers.
2. **Prices:** `venues.price_per_hour` is the base price. New
   `venue_price_rules (id, venue_id, court_number null = all courts,
   days smallint[] (0-6), start_time, end_time, price_per_hour)` for weekend
   and peak overrides. One function, `venue_slot_price(venue, court, start,
   end)`, prices a booking; the most specific rule wins. Players see the price
   in the booking sheet.
3. **Walk-in and blocked slots live in `venue_bookings`**, so the existing
   exclusion constraint stops app players booking over them. New columns:
   `source text default 'app' check (source in ('app','walk_in','blocked'))`,
   `customer_name`, `customer_phone`, `created_by`. `get_venue_slots` shows
   them as Occupied.
4. **Alerts:** `book_venue_slot` and every cancel enqueue a notification to
   the venue's owner and staff. A cancel by the owner notifies the player.

All writes go through SECURITY DEFINER RPCs that check the role. A booker's
phone number is returned only to that venue's owner/staff.

## RPCs

- `register_venue(...)`: any signed-in user. Creates the venue as `pending`
  and makes the caller its owner.
- `admin_assign_venue_owner(venue, phone)`: superadmin. Matches the last 10
  digits, like `add_venue_staff`.
- `list_my_partner_venues()`: venues where the caller is owner/staff, with status.
- `update_venue_details(venue, ...)`: owner. Name, address, lat/lng, phone,
  sports, facilities, hours, courts, cover photo. Slot length is fixed at
  1 hour for every venue (`20261123120000_hourly_bookings_only.sql`).
- `set_venue_prices(venue, base, rules jsonb)`: owner. Replaces the rules.
- `list_partner_bookings(venue, date)`: owner/staff. Every booking that day,
  with court, time, source, player name and phone.
- `partner_block_slot(venue, court, start, end, source, name, phone)`: owner/staff.
- `partner_cancel_booking(booking, reason)`: owner/staff. Notifies the player.
- `add_venue_staff` / `remove_venue_staff` already exist; owners get to call them.

## Screens (`app/partner/`)

| Route | Screen |
|---|---|
| Settings → "List your venue" | `register.tsx`: details form, "Use my current location" pin (stand at the venue), cover photo |
| Settings → "Venue Partner" (owners/staff only) | `index.tsx`: my venues, with a Pending approval badge |
| `[venueId]/index.tsx` | **Today's bookings first**: date strip, one column per court, booking cards (player, phone tap-to-call, source), "Block slot / Walk-in" button |
| `[venueId]/edit.tsx` | Venue details, location, hours, courts, photo |
| `[venueId]/prices.tsx` | Base price, weekend price, peak-hour rules |
| `[venueId]/staff.tsx` | Add/remove staff by phone |

Location: no map library is installed, and adding Google Maps needs an API
key. v1 uses the phone's current location (owner stands at the venue) plus a
"paste Google Maps link" field that reads the coordinates out of the link.

Admin: `app/admin/venues.tsx` gains a Pending list (approve/hide) and
"Assign owner".

## Build order (each phase works on its own)

1. **Owners and venues:** role column, register, approve, assign, edit
   details and location, partner home. Verify: a new user registers a venue →
   it's hidden → admin approves → it appears in Venues and the owner can edit it.
2. **Prices:** rules table, price function, prices screen, price shown in
   the player's booking sheet. Verify: weekday vs weekend vs peak slots show
   the right amount.
3. **Bookings calendar:** `list_partner_bookings`, calendar screen,
   owner cancel with player notification.
4. **Walk-in / block + alerts:** block a slot → players see Occupied and
   can't book it; a new app booking pushes to the owner.

One APK after phase 4, or after each phase if you want to test as we go.
Payments (Razorpay advance) come after this, once owners have set prices.

## Out of v1

Memberships, reports/analytics, discounts and offers, payouts, a separate
partner app, a web dashboard.
