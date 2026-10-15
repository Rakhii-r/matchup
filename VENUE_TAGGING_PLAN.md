# sixfour24 — Venue tagging plan

Written 27 Aug 2026. Repo: `App Rebranding to P24/uploads/matchup`.
Supabase project: `izqknyzmeyiowbwmcfes`. Verified against prod, not against the
migration files — 57 local files, 57 prod version rows, still in sync.

Goal: an organiser creates a match against an **area**, then attaches a **venue**
afterwards. Area stays the discovery key; venue becomes the commitment key.
Modelled on Playo's Create Game → Tag Venue flow, adapted to our slot model.

---

## 0. Read this before writing any code

**The feature is data-blocked, not code-blocked.**

`public.venues` holds **7 rows**. Five are Pune seed data (`Ace Sports Hub`,
`GreenTurf Box Cricket`, `PlayBox Turf`, `Shuttle Point`, `Smash Arena
Badminton`) roughly 500 km from where the app is actually being used. Every real
match created in the last month is in Kukatpally, Pragathi Nagar or Kondapur.

That leaves **two** Hyderabad venues, and one of them is broken:

| Venue | Address | lat, lng | Usable |
|---|---|---|---|
| `Akhil box` | Alluri trade box | 17.4949, 78.4009 | yes — ~2 km from Kukatpally |
| `varak box` | Kukatpally | **0, 0** | no — null island, ~2,000 km away by any distance sort |

So an area-scoped picker over Kukatpally at a 25 km radius returns **exactly one
venue** today. And `image_url`, `rating`, `rating_count`, `price_per_hour` and
`facilities` — added 15 Aug specifically for this kind of screen — are populated
on **zero** of the 7 rows.

Building the picker before the data exists produces a beautiful screen with one
bare card in it. **Stage B is the gate.** Stages A and C can land first because
they are correctness fixes, but do not start Stage E until real venues exist.

---

## Stage A — Unpoison `venue_text`

**Why first:** nothing downstream can render an empty state until this is fixed.

`create_open_match` currently inserts `venue_text ← in_area_name`
(`20260820120000_area_based_match_creation.sql:100`). Every match is born looking
like it already has a venue, so no screen can distinguish "not tagged yet" from
"tagged". The `venue_text || area_name` fallback in six render sites is dead code.

Current state in prod — two clean eras, which is what makes the backfill safe:

| Era | Rows | `area_name` | `venue_text` | `venue_id` |
|---|---|---|---|---|
| Pre-area | 13 | null | real venue or free text | 9 set, 4 null |
| Post-area (poisoned) | 12 | set | **= `area_name`** | all null |

### A1. Migration `20260827100000_venue_text_not_area.sql`

`create or replace` the **11-argument** `create_open_match`. Copy the body from
prod (`pg_get_functiondef`) and change only what is listed below.

> **Trap:** a stale 8-arg `create_open_match(in_sport, in_match_name,
> **in_venue_id**, ...)` overload is still live in prod alongside the 11-arg one,
> and the same is true of `post_open_challenge` (stale 9-arg beside the current
> 12-arg). Reproduce the 11-arg identity *exactly*, defaults included, or you
> create a third overload and PostgREST starts resolving ambiguously.

Add to `declare`:

```sql
  v_venue      public.venues%rowtype;
  v_venue_text text;
```

Add after the existing `END_BEFORE_START` guard:

```sql
  -- Resolve the venue only when one was supplied. venue_text stays NULL
  -- otherwise, so the match detail screen can tell "no venue yet" from
  -- "venue tagged". area_name carries the location in the meantime.
  if in_venue_id is not null then
    select * into v_venue from public.venues where id = in_venue_id;
    if not found then
      raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not (in_sport = any (v_venue.sport_types)) then
      raise exception 'VENUE_SPORT_MISMATCH' using errcode = '23514';
    end if;
    v_venue_text := v_venue.name;
  end if;
```

Change one line in the `insert ... values`:

```sql
-- was: v_uid, in_sport, in_venue_id, in_area_name,  in_area_name, ...
--  now: v_uid, in_sport, in_venue_id, v_venue_text, in_area_name, ...
```

Both error tokens are **already mapped** in `matchRepository.ts` `JOIN_ERRORS`
(lines 47–48) — they have been sitting there unused because nothing raised them.
No client error-map change needed.

### A2. Backfill, same migration

```sql
update public.matches
   set venue_text = null
 where venue_id is null
   and area_name is not null
   and venue_text = area_name;
```

Touches exactly the 12 post-area rows. It cannot reach the pre-area rows because
those have `area_name is null`. Expect `UPDATE 12`.

### A3. Client

No code change. Verify the six existing render sites now fall through to
`area_name`:

`app/match/[id]/index.tsx:499`, `app/(tabs)/index.tsx:976` and `:1099`,
`app/(tabs)/matches.tsx:418`, `app/match/[id]/result.tsx:344`,
`app/teams/matches.tsx:152`.

**Definition of "tagged" for the whole feature:**
`venue_id is not null || venue_text is not null`. Free text with no `venue_id`
(4 legacy rows: `Varak`, `Hyderabad`, `Jjj`) counts as tagged — it is a real
answer to "where are we playing", just not a linked venue.

---

## Stage B — Venue data (**the gate**)

Nothing in Stage E is worth shipping until this is done. Three jobs, in order:

1. **Fix `varak box`.** `lat, lng = 0, 0` puts it in the Gulf of Guinea and it
   will never appear in a distance-ranked query. Set real Kukatpally coordinates.
   Consider adding `check (lat <> 0 or lng <> 0)` to `venues` so this cannot
   recur — every legitimate venue in India is far from null island.
2. **Delete or quarantine the 5 Pune seed rows** once real venues exist. They are
   500 km from every real user and will only ever be noise. If they are still
   needed for testing, that is an argument for a staging project, not for
   shipping them.
3. **Populate real Hyderabad venues** — Kukatpally, KPHB, Pragathi Nagar,
   Kondapur to start, since that is where the matches are. For each row fill
   `name, address, lat, lng, sport_types, phone` **and** the 15 Aug enrichment
   columns `image_url, rating, rating_count, price_per_hour, facilities`.
   Images go in the existing public `venue-images` bucket (admin write via
   `is_admin()`).

`app/admin/venues.tsx` already exists for this. It does not yet edit the
enrichment columns — extending that form is cheaper than a one-off SQL script and
leaves the owner able to maintain the data without a developer.

**Owner decision needed:** where do `rating` and `rating_count` come from?
Options are (a) hand-entered from Google, honest but static and stale; (b) a
`venue_ratings` table fed by players after a match, real but empty for months;
(c) leave null and render no rating at all until (b) exists. Recommendation is
(c) then (b) — a hand-entered 4.1 that never moves is a number the app is
pretending to have earned. Do not copy Playo's `Featured` / `BOOKABLE` /
verified-shield badges at all: we have no columns behind them and no booking
integration, and a fake `BOOKABLE` badge is worse than no badge.

---

## Stage C — `set_match_venue` RPC

The write path. Nothing in the codebase can attach a venue after creation today:
`venue_id` / `venue_text` are written in exactly one place
(`matchRepository.create`) and read in six.

### Migration `20260827110000_set_match_venue.sql`

```sql
create or replace function public.set_match_venue(
  in_match_id uuid,
  in_venue_id uuid default null
)
returns matches
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := (select auth.uid());
  v_match public.matches%rowtype;
  v_venue public.venues%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  select * into v_match from public.matches where id = in_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Organiser-only, consistent with perform_toss / start_innings /
  -- create_rematch. See 20260826120000_creator_only_toss_and_scoring.
  if v_match.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  -- status is one of open | locked | completed | cancelled.
  if v_match.status not in ('open', 'locked') then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;

  -- Passing null clears the tag (organiser picked the wrong ground).
  if in_venue_id is null then
    update public.matches
       set venue_id = null, venue_text = null
     where id = in_match_id
    returning * into v_match;
    return v_match;
  end if;

  select * into v_venue from public.venues where id = in_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_match.sport = any (v_venue.sport_types)) then
    raise exception 'VENUE_SPORT_MISMATCH' using errcode = '23514';
  end if;

  update public.matches
     set venue_id = v_venue.id, venue_text = v_venue.name
   where id = in_match_id
  returning * into v_match;
  return v_match;
end;
$function$;

revoke execute on function public.set_match_venue(uuid, uuid) from public, anon;
grant  execute on function public.set_match_venue(uuid, uuid) to authenticated;
```

### The decision inside this RPC

**It deliberately does not touch `match_lat` / `match_lng`.**

Those drive `nearby_matches`, which is how players find the match. If tagging a
venue moved the pin, a match would silently drift into and out of people's search
radius *after* they had already joined — a player who joined a Kukatpally match
would watch it relocate. Discovery stays anchored to the area the organiser chose
at wizard step 2; the venue is display and directions only.

If the owner later wants "matches move to their venue", that is a separate,
explicit decision with a notification attached, not a side effect of this RPC.

### What comes free

`create_rematch` already copies `venue_id` and `venue_text` from the original
match (`20260826120000_creator_only_toss_and_scoring.sql:658`). Every subsequent
game in a booked slot inherits the tag with no extra work.

### Client — `matchRepository`

Add beside `createRematch` (which is the closest existing shape):

```ts
async setVenue(matchId: string, venueId: string | null): Promise<Match> {
  const { data, error } = await supabase.rpc('set_match_venue', {
    in_match_id: matchId,
    in_venue_id: venueId,
  });
  if (error) throw venueErrorToAppError(error);
  if (!data) throw new AppError('unknown', 'Could not save the venue. Please try again.');
  return data;
}
```

New token map, following `REMATCH_ERRORS`:

```ts
const VENUE_ERRORS: [string, AppErrorCode, string][] = [
  ['NOT_THE_ORGANISER',    'unauthorized', 'Only the match organiser can set the venue.'],
  ['MATCH_NOT_FOUND',      'not_found',    'That match no longer exists.'],
  ['MATCH_ALREADY_STARTED','conflict',     'This match has already finished.'],
  ['VENUE_NOT_FOUND',      'not_found',    'That venue is no longer available.'],
  ['VENUE_SPORT_MISMATCH', 'validation',   'That ground does not host this sport.'],
];
```

Hook in `useMatches.ts`, mirroring `useCreateMatch`'s `onSuccess`: invalidate
`matchKey(matchId)` plus the match lists.

`database.types.ts` is hand-written and has never been generated — add the
`set_match_venue` signature to the `Functions` block by hand, `Returns: matches`
Row.

---

## Stage D — `nearby_venues` RPC

`venueRepository.list()` fetches every venue ordered by name. Fine for a 7-row
admin table, useless for an area-scoped picker.

### Migration `20260827120000_nearby_venues.sql`

```sql
create or replace function public.nearby_venues(
  in_lat double precision,
  in_lng double precision,
  in_radius_m integer default 25000,
  in_sport text default null
)
returns table (
  id uuid, name text, address text,
  lat double precision, lng double precision,
  sport_types text[], phone text, confirm_note text,
  image_url text, rating numeric, rating_count integer,
  price_per_hour integer, facilities text[],
  distance_m double precision
)
language sql
stable
set search_path to 'public'
as $function$
  select v.id, v.name, v.address, v.lat, v.lng, v.sport_types, v.phone,
         v.confirm_note, v.image_url, v.rating, v.rating_count,
         v.price_per_hour, v.facilities,
         ST_Distance(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography
         ) as distance_m
    from public.venues v
   where (in_sport is null or in_sport = any (v.sport_types))
     and ST_DWithin(
           v.location,
           ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
           in_radius_m
         )
   order by distance_m asc, v.rating desc nulls last, v.name asc;
$function$;

grant execute on function public.nearby_venues(double precision, double precision, integer, text) to authenticated;
```

Two notes:

- **`security invoker`, on purpose.** `venues` has a `venues_select` policy of
  `true` — the table is world-readable — so this does not need `security
  definer`. Every other RPC in the project is definer, and the advisor already
  logs 68 `authenticated_security_definer_function_executable` warnings; do not
  add a 69th for no reason.
- `venues.location` is `geography`, so the point must be cast
  `::geography`. `venues_location_gix` already indexes it, and `ST_DWithin` on
  geography uses that index.

Ranking is **distance, then rating, then name**. No featured/bookable tier — see
Stage B.

---

## Stage E — Client screens (blocked on Stage B)

Expo Router is file-based and `app/match/_layout.tsx` is a plain headerless
`Stack`, so new routes need no registration.

### E1. Venue card on `app/match/[id]/index.tsx`

`isCreator` already exists at line 132 (`data.creator_id === userId`) — reuse it,
do not introduce a second gate.

Replace the muted one-liner at line 499 with a card above the fold:

| State | Who sees it | Renders |
|---|---|---|
| Untagged | organiser | Area name + prompt + primary action. The empty state **is** the CTA. |
| Untagged | player | Area name + a plain line: venue not set yet. Never a disabled button. |
| Tagged | organiser | Venue name, address, directions, quiet "Change" affordance |
| Tagged | player | Venue name, address, directions |

Non-organisers get a stated read-only line, never a disabled or failing button —
that rule is already established across `toss.tsx`, `score.tsx` and `result.tsx`.

**Copy — do not lift Playo's.** Playo tags a venue to a vague "Evening (4pm to
9pm)". We commit to a concrete `scheduled_at` plus a slot duration
(`SLOT_DURATIONS_MIN`, default 120) at creation, and `end_time` is the hard
boundary of the whole session. The ask is therefore different:

> **Where are you playing?**
> Add the ground so players know where to turn up.
> `[ Add venue ]`

not "Find and tag your venue".

### E2. `app/match/[id]/venue.tsx` — the picker

- Reads the match to get `match_lat` / `match_lng` / `sport` / `search_radius_m`.
- Calls `nearby_venues` with those, so the list is scoped to the area the
  organiser already chose.
- Card renders: name, address, distance, and — **only when non-null** — rating +
  count, price/hour, facilities. Every enrichment field renders an empty state
  rather than a fabricated value; that is the standing rule from the 15 Aug
  redesign decisions.
- Tap → `setVenue` → back to the match detail.
- Empty state matters more than usual here: with today's data most areas return
  nothing. It needs a real message and a way to proceed, not a spinner that never
  resolves.

Component kit available: `WizardScreen`, `SectionLabel`, `Chip`, `TOUCH` from
`CreateMatchWizardUI.tsx`; `AppText`, `Button`, `Screen`, `TextField` from
`shared/ui`. Follow the house theming pattern — `const { colors } = useTheme()`,
`const styles = useMemo(() => makeStyles(colors), [colors])`, hooks above early
returns, `styles` in the deps of any `renderItem`.

### E3. `app/venue/[id].tsx` — venue detail (optional, last)

Does not exist today; there is only the `(tabs)/venues.tsx` directory and the
admin screen. This is what makes tagging feel worth doing: photos, address,
map link, facilities, and "N upcoming games here".

Ship E1 and E2 first and see whether anyone asks for this. It is the most
expensive screen and the least load-bearing.

---

## Non-goals

Explicitly **not** in this plan:

- Slot booking or payments. Playo's venue page is a booking funnel; we have no
  booking integration and `MatchUp_Admin_Venue_Booking_Spec.md` is a separate
  piece of work.
- Featured / verified / bookable badges — no columns, no data, see Stage B.
- Moving match discovery coordinates to the venue — see the Stage C decision.
- Touching the team-challenge venue path. `team_challenges.venue_id` is already
  nullable (`20260820120000:9`) and 51 of the live challenges have it null. It
  works; leave it.
- Google Places autocomplete for venues. Separate decision, owner supplying the
  key, tracked in the redesign notes.

---

## Verification

Per the standing project constraints:

- `npx tsc --noEmit` **cannot** be run over the device bridge — it exceeds the
  45s timeout on the owner's Windows machine. Copy the repo into the cloud
  container and run `npm ci && npx tsc --noEmit` there (~20s).
- `eslint` baseline is **0 errors / 7 warnings** as of 26 Aug. Compare against 7,
  not against zero.
- After any `apply_migration` through the MCP, the version row is recorded under
  a *generated* timestamp, so `supabase db push` would re-run the file later.
  Always follow with:
  ```sql
  update supabase_migrations.schema_migrations
     set version = '<file version>'
   where version = '<generated version>';
  ```
- Re-verify sync afterwards — local file versions vs `schema_migrations`, both
  directions.

### Smoke tests

1. Create a match with no venue → detail shows the area and the add-venue CTA.
2. Same match as a **non-organiser** → read-only line, no button.
3. Tag a venue → name appears everywhere `venue_text` is read (home, matches
   tab, detail, result, team matches).
4. Change the venue → updates. Clear it → CTA returns.
5. Tag a badminton court on a box-cricket match → `VENUE_SPORT_MISMATCH`,
   surfaced as "That ground does not host this sport."
6. Non-organiser calls `set_match_venue` directly → `NOT_THE_ORGANISER`.
7. Completed match → `MATCH_ALREADY_STARTED`.
8. Play Again after tagging → rematch inherits the venue.
9. Confirm the 12 backfilled rows show their area, not a phantom venue.

---

## Risk register

| Risk | Why it bites | Mitigation |
|---|---|---|
| Stale function overloads | 8-arg `create_open_match` and 9-arg `post_open_challenge` are still live; a mismatched `create or replace` adds a third | Reproduce the 11-arg identity exactly; re-check `pg_proc` after applying |
| Unapplied local migration in flight | `create or replace` from an older copy silently deletes someone else's work — this nearly destroyed the toss heads/tails feature | Diff `supabase/migrations/` against `schema_migrations` **before** writing any function |
| Hand-written `database.types.ts` | Types are not generated; three RPC return shapes already name columns that do not exist and read as `undefined` with no type error | Verify `set_match_venue` and `nearby_venues` against `pg_proc` before writing client code |
| Backfill over-reaching | A naive `venue_text = area_name` update would be wrong if the eras overlapped | The `area_name is not null` clause confines it to the 12 post-area rows; check `UPDATE 12` |
| Shipping E2 before Stage B | A picker over one usable venue reads as a broken feature | Stage B is a hard gate |

---

## Order of work

```
A  unpoison venue_text        ← correctness, do now, no dependencies
C  set_match_venue RPC        ← can land alongside A
D  nearby_venues RPC          ← can land alongside A
B  venue data                 ← THE GATE
E1 venue card on match detail ← after B
E2 picker screen              ← after B
E3 venue detail screen        ← optional, last
```

A, C and D are backend correctness work and can be done immediately. B is the
one that decides whether any of this is worth shipping.
