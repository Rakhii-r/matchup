-- ============================================================================
-- MatchUp — Security hardening (originally authored as 0006)
-- Fixes from the July 2026 audit (AUDIT_REPORT.md §2 and §5.1):
--   S2  profiles PII exposure  -> base table self-only + public_profiles view
--   S5  anon-callable SECURITY DEFINER functions -> revoke EXECUTE
--   S3  is_active enforcement on writes
--   S7  attendance only for actual match players
--   S9  venue inserts admin-only
--   S10 length CHECK constraints mirroring client Zod caps
--   S11 set_updated_at mutable search_path
--   Perf: (select auth.uid()) in all policies (auth_rls_initplan, 31 warnings)
--   Perf: missing indexes (blocks reverse lookup, 9 unindexed FKs, partial GiST)
--
-- ---------------------------------------------------------------------------
-- RESEQUENCED 3 August 2026. Read this before editing.
--
-- This migration was written to run sixth, before avatars_storage, the roles
-- normalisation, venues_admin_only, filled_slots_trigger and join_match_rpc.
-- It was never applied to the remote project, and a later renaming exercise
-- mapped local files onto remote timestamps without accounting for the gap,
-- which shifted six files by one slot and left the ledger claiming this had
-- run when it had not. Timestamp moved to 20260803080000 so it applies LAST.
--
-- Running last changes two things, both handled below:
--   * Every DROP POLICY is now IF EXISTS. Later migrations already removed
--     venues_insert / venues_update_owner / venues_delete_owner (venues_admin_only)
--     and match_players_insert_self (join_match_rpc). Bare DROPs would abort.
--   * The match_players_insert_self policy is deliberately NOT recreated.
--     join_match_rpc removed client-side INSERT on purpose so the locking
--     join_match() RPC is the only way into the table. Recreating the policy
--     here would silently reopen the capacity race. See section 7.
--
-- CLIENT CHANGES REQUIRED — already done alongside this file:
--   matchRepository.listPlayers() and availabilityRepository.nearby() now read
--   public_profiles instead of profiles.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: is the calling user active? (used to make deactivation real)
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.is_active);
$$;

-- ---------------------------------------------------------------------------
-- 2. S5 — SECURITY DEFINER functions: authenticated-only, never anon/public
-- ---------------------------------------------------------------------------
revoke execute on function public.is_blocked_between(uuid, uuid)                                        from anon, public;
revoke execute on function public.nearby_matches(double precision, double precision, integer, text)     from anon, public;
revoke execute on function public.nearby_available(double precision, double precision, integer, text)   from anon, public;
revoke execute on function public.has_role(public.app_role, uuid)                                        from anon, public;
revoke execute on function public.is_admin(uuid)                                                         from anon, public;
revoke execute on function public.is_superadmin(uuid)                                                    from anon, public;
revoke execute on function public.is_match_creator(uuid, uuid)                                           from anon, public;
revoke execute on function public.is_match_player(uuid, uuid)                                            from anon, public;
revoke execute on function public.is_active_user(uuid)                                                   from anon, public;
grant  execute on function public.is_active_user(uuid)                                                   to authenticated;
-- Added by the resequencing: these landed after this migration was authored.
revoke execute on function public.sync_filled_slots()                                                    from anon, public;
revoke execute on function public.join_match(uuid, text)                                                 from anon, public;
grant  execute on function public.join_match(uuid, text)                                                 to authenticated;
-- (st_estimatedextent is PostGIS-owned; revoking may need superuser — handled
--  by moving PostGIS out of public at a later maintenance window, lint 0014.)

-- ---------------------------------------------------------------------------
-- 3. S11 — pin search_path on the trigger helper
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. S2 — profiles: self-only base table + safe public view
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select"      on public.profiles;
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
-- (profiles_admin_select from roles_admin still grants admins full read.)

-- Safe, non-PII projection for everyone else. The view runs with the owner's
-- rights (security_invoker off) so it still reads the locked-down base table;
-- it exposes ONLY the columns below and only active users. No phone, no home
-- coordinates.
create or replace view public.public_profiles
  with (security_invoker = off) as
  select id, full_name, area_name, avatar_url, sport_pref, created_at
  from public.profiles
  where is_active;

-- CRITICAL: this view is a single-table projection, so Postgres makes it
-- auto-updatable, and with security_invoker off any write would execute as the
-- owner and bypass RLS on profiles. Supabase's default privileges grant ALL on
-- new objects in public to `authenticated`, so `authenticated` MUST be named in
-- the revoke — revoking from anon/public alone leaves the view writable and
-- hands every signed-in user UPDATE/DELETE on other people's profile rows.
revoke all    on public.public_profiles from authenticated, anon, public;
grant  select on public.public_profiles to authenticated;

-- Belt and braces: refuse writes even if a privilege is re-granted by accident.
create or replace rule public_profiles_no_insert as
  on insert to public.public_profiles do instead nothing;
create or replace rule public_profiles_no_update as
  on update to public.public_profiles do instead nothing;
create or replace rule public_profiles_no_delete as
  on delete to public.public_profiles do instead nothing;

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. S9 — venues: creation is admin-only in Phase 1 (directory is curated)
-- Already removed by venues_admin_only; IF EXISTS keeps this file order-safe.
-- ---------------------------------------------------------------------------
drop policy if exists "venues_insert"       on public.venues;
drop policy if exists "venues_update_owner" on public.venues;
drop policy if exists "venues_delete_owner" on public.venues;
-- Reads stay open to all authenticated users via "venues_select" (unchanged).

-- ---------------------------------------------------------------------------
-- 6. matches — initplan fix + is_active on writes
-- ---------------------------------------------------------------------------
drop policy if exists "matches_select" on public.matches;
create policy "matches_select" on public.matches for select to authenticated
  using (
    not public.is_blocked_between((select auth.uid()), creator_id)
    and (
      status = 'open'
      or creator_id = (select auth.uid())
      or public.is_match_player(id, (select auth.uid()))
    )
  );

drop policy if exists "matches_insert_creator" on public.matches;
create policy "matches_insert_creator" on public.matches for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy if exists "matches_update_creator" on public.matches;
create policy "matches_update_creator" on public.matches for update to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

drop policy if exists "matches_delete_creator" on public.matches;
create policy "matches_delete_creator" on public.matches for delete to authenticated
  using (creator_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. match_players — initplan fix
--
-- NOTE: no INSERT policy is created here, by design. join_match_rpc dropped
-- match_players_insert_self so that the SECURITY DEFINER join_match() function,
-- which takes a row lock before checking capacity, is the only write path.
-- Re-adding an INSERT policy would let clients bypass that lock and
-- oversubscribe a match. Do not "restore" it.
-- ---------------------------------------------------------------------------
drop policy if exists "match_players_select" on public.match_players;
create policy "match_players_select" on public.match_players for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

drop policy if exists "match_players_update_creator" on public.match_players;
create policy "match_players_update_creator" on public.match_players for update to authenticated
  using (public.is_match_creator(match_id, (select auth.uid())))
  with check (public.is_match_creator(match_id, (select auth.uid())));

drop policy if exists "match_players_delete" on public.match_players;
create policy "match_players_delete" on public.match_players for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 8. attendance — initplan fix + S7 (target must be an actual match player)
-- ---------------------------------------------------------------------------
drop policy if exists "attendance_select" on public.attendance;
create policy "attendance_select" on public.attendance for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

drop policy if exists "attendance_insert_creator" on public.attendance;
create policy "attendance_insert_creator" on public.attendance for insert to authenticated
  with check (
    marked_by = (select auth.uid())
    and public.is_match_creator(match_id, (select auth.uid()))
    and public.is_match_player(match_id, user_id)        -- S7: no ghost attendance
  );

drop policy if exists "attendance_update_creator" on public.attendance;
create policy "attendance_update_creator" on public.attendance for update to authenticated
  using (public.is_match_creator(match_id, (select auth.uid())))
  with check (
    marked_by = (select auth.uid())
    and public.is_match_player(match_id, user_id)
  );

-- ---------------------------------------------------------------------------
-- 9. availability — initplan fix + is_active on writes
-- ---------------------------------------------------------------------------
drop policy if exists "availability_select" on public.availability;
create policy "availability_select" on public.availability for select to authenticated
  using (
    user_id = (select auth.uid())
    or not public.is_blocked_between((select auth.uid()), user_id)
  );

drop policy if exists "availability_insert_self" on public.availability;
create policy "availability_insert_self" on public.availability for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy if exists "availability_update_self" on public.availability;
create policy "availability_update_self" on public.availability for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "availability_delete_self" on public.availability;
create policy "availability_delete_self" on public.availability for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. devices — initplan fix
-- ---------------------------------------------------------------------------
drop policy if exists "devices_select_self" on public.devices;
create policy "devices_select_self" on public.devices for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "devices_insert_self" on public.devices;
create policy "devices_insert_self" on public.devices for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "devices_update_self" on public.devices;
create policy "devices_update_self" on public.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "devices_delete_self" on public.devices;
create policy "devices_delete_self" on public.devices for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 11. reports & blocks — initplan fix + is_active on report inserts
-- ---------------------------------------------------------------------------
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "blocks_insert_self" on public.blocks;
create policy "blocks_insert_self" on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy if exists "blocks_delete_self" on public.blocks;
create policy "blocks_delete_self" on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 12. user_roles — initplan fix
-- ---------------------------------------------------------------------------
drop policy if exists "user_roles_select" on public.user_roles;
create policy "user_roles_select" on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 13. S10 — length CHECKs mirroring the client Zod caps.
-- Verified against live data before writing: zero existing rows violate these.
-- Dropped first so re-running the file is safe.
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_full_name_len,
  drop constraint if exists profiles_area_name_len,
  add  constraint profiles_full_name_len check (char_length(full_name) between 1 and 60),
  add  constraint profiles_area_name_len check (area_name is null or char_length(area_name) <= 80);

alter table public.matches
  drop constraint if exists matches_venue_text_len,
  drop constraint if exists matches_notes_len,
  drop constraint if exists matches_share_code_len,
  add  constraint matches_venue_text_len check (venue_text is null or char_length(venue_text) <= 120),
  add  constraint matches_notes_len      check (notes is null or char_length(notes) <= 400),
  add  constraint matches_share_code_len check (char_length(share_code) = 6);

alter table public.reports
  drop constraint if exists reports_reason_len,
  drop constraint if exists reports_details_len,
  add  constraint reports_reason_len  check (char_length(reason) <= 60),
  add  constraint reports_details_len check (details is null or char_length(details) <= 280);

alter table public.availability
  drop constraint if exists availability_note_len,
  add  constraint availability_note_len check (note is null or char_length(note) <= 200);

alter table public.venues
  drop constraint if exists venues_name_len,
  drop constraint if exists venues_address_len,
  drop constraint if exists venues_phone_len,
  add  constraint venues_name_len    check (char_length(name) <= 80),
  add  constraint venues_address_len check (address is null or char_length(address) <= 160),
  add  constraint venues_phone_len   check (phone is null or char_length(phone) <= 20);

-- ---------------------------------------------------------------------------
-- 14. Indexes — blocks reverse lookup, unindexed FKs, hot-path partial GiST
-- ---------------------------------------------------------------------------
create index if not exists blocks_blocked_blocker_idx on public.blocks (blocked_id, blocker_id);
create index if not exists attendance_user_idx        on public.attendance (user_id);
create index if not exists attendance_marked_by_idx   on public.attendance (marked_by);
create index if not exists matches_venue_idx          on public.matches (venue_id) where venue_id is not null;
create index if not exists reports_reporter_idx       on public.reports (reporter_id);
create index if not exists reports_reported_idx       on public.reports (reported_user_id);
create index if not exists reports_match_idx          on public.reports (match_id) where match_id is not null;
create index if not exists reports_status_idx         on public.reports (status);
create index if not exists user_roles_granted_by_idx  on public.user_roles (granted_by);
create index if not exists venues_created_by_idx      on public.venues (created_by);
-- Discovery hot path: only open matches are searched by location.
create index if not exists matches_open_location_gix  on public.matches using gist (location) where status = 'open';
