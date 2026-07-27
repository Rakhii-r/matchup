-- ============================================================================
-- MatchUp — 0006 Security hardening
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
-- CLIENT CHANGES REQUIRED AFTER APPLYING (see end-of-file note):
--   profiles joins for OTHER users must read public_profiles, not profiles.
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
-- (st_estimatedextent is PostGIS-owned; revoking may need superuser — handled
--  by moving PostGIS out of public at a later maintenance window, lint 0014.)

-- ---------------------------------------------------------------------------
-- 3. S11 — pin search_path on the trigger helper
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- 4. S2 — profiles: self-only base table + safe public view
-- ---------------------------------------------------------------------------
drop policy "profiles_select" on public.profiles;
create policy "profiles_select_self" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
-- (profiles_admin_select from 0003 still grants admins full read.)

-- Safe, non-PII projection for everyone else. Owner (postgres) bypasses base
-- RLS, so this works while the base table is locked down; it exposes ONLY the
-- columns below and only active users. No phone, no home coordinates.
create or replace view public.public_profiles as
  select id, full_name, area_name, avatar_url, sport_pref, created_at
  from public.profiles
  where is_active;

revoke all    on public.public_profiles from anon, public;
grant  select on public.public_profiles to authenticated;

drop policy "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. S9 — venues: creation is admin-only in Phase 1 (directory is curated)
-- ---------------------------------------------------------------------------
drop policy "venues_insert"       on public.venues;  -- venues_admin_all (0003) covers admins
drop policy "venues_update_owner" on public.venues;
drop policy "venues_delete_owner" on public.venues;
-- Reads stay open to all authenticated users via "venues_select" (unchanged).

-- ---------------------------------------------------------------------------
-- 6. matches — initplan fix + is_active on writes
-- ---------------------------------------------------------------------------
drop policy "matches_select" on public.matches;
create policy "matches_select" on public.matches for select to authenticated
  using (
    not public.is_blocked_between((select auth.uid()), creator_id)
    and (
      status = 'open'
      or creator_id = (select auth.uid())
      or public.is_match_player(id, (select auth.uid()))
    )
  );

drop policy "matches_insert_creator" on public.matches;
create policy "matches_insert_creator" on public.matches for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy "matches_update_creator" on public.matches;
create policy "matches_update_creator" on public.matches for update to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

drop policy "matches_delete_creator" on public.matches;
create policy "matches_delete_creator" on public.matches for delete to authenticated
  using (creator_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. match_players — initplan fix + is_active on join
-- ---------------------------------------------------------------------------
drop policy "match_players_select" on public.match_players;
create policy "match_players_select" on public.match_players for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

drop policy "match_players_insert_self" on public.match_players;
create policy "match_players_insert_self" on public.match_players for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy "match_players_update_creator" on public.match_players;
create policy "match_players_update_creator" on public.match_players for update to authenticated
  using (public.is_match_creator(match_id, (select auth.uid())))
  with check (public.is_match_creator(match_id, (select auth.uid())));

drop policy "match_players_delete" on public.match_players;
create policy "match_players_delete" on public.match_players for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 8. attendance — initplan fix + S7 (target must be an actual match player)
-- ---------------------------------------------------------------------------
drop policy "attendance_select" on public.attendance;
create policy "attendance_select" on public.attendance for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
  );

drop policy "attendance_insert_creator" on public.attendance;
create policy "attendance_insert_creator" on public.attendance for insert to authenticated
  with check (
    marked_by = (select auth.uid())
    and public.is_match_creator(match_id, (select auth.uid()))
    and public.is_match_player(match_id, user_id)        -- S7: no ghost attendance
  );

drop policy "attendance_update_creator" on public.attendance;
create policy "attendance_update_creator" on public.attendance for update to authenticated
  using (public.is_match_creator(match_id, (select auth.uid())))
  with check (
    marked_by = (select auth.uid())
    and public.is_match_player(match_id, user_id)
  );

-- ---------------------------------------------------------------------------
-- 9. availability — initplan fix + is_active on writes
-- ---------------------------------------------------------------------------
drop policy "availability_select" on public.availability;
create policy "availability_select" on public.availability for select to authenticated
  using (
    user_id = (select auth.uid())
    or not public.is_blocked_between((select auth.uid()), user_id)
  );

drop policy "availability_insert_self" on public.availability;
create policy "availability_insert_self" on public.availability for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy "availability_update_self" on public.availability;
create policy "availability_update_self" on public.availability for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy "availability_delete_self" on public.availability;
create policy "availability_delete_self" on public.availability for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. devices — initplan fix
-- ---------------------------------------------------------------------------
drop policy "devices_select_self" on public.devices;
create policy "devices_select_self" on public.devices for select to authenticated
  using (user_id = (select auth.uid()));

drop policy "devices_insert_self" on public.devices;
create policy "devices_insert_self" on public.devices for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy "devices_update_self" on public.devices;
create policy "devices_update_self" on public.devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy "devices_delete_self" on public.devices;
create policy "devices_delete_self" on public.devices for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 11. reports & blocks — initplan fix + is_active on report inserts
-- ---------------------------------------------------------------------------
drop policy "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

drop policy "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and public.is_active_user((select auth.uid()))
  );

drop policy "blocks_select_own" on public.blocks;
create policy "blocks_select_own" on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy "blocks_insert_self" on public.blocks;
create policy "blocks_insert_self" on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));

drop policy "blocks_delete_self" on public.blocks;
create policy "blocks_delete_self" on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 12. user_roles — initplan fix
-- ---------------------------------------------------------------------------
drop policy "user_roles_select" on public.user_roles;
create policy "user_roles_select" on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 13. S10 — length CHECKs mirroring the client Zod caps
-- ---------------------------------------------------------------------------
alter table public.profiles
  add constraint profiles_full_name_len check (char_length(full_name) between 1 and 60),
  add constraint profiles_area_name_len check (area_name is null or char_length(area_name) <= 80);

alter table public.matches
  add constraint matches_venue_text_len check (venue_text is null or char_length(venue_text) <= 120),
  add constraint matches_notes_len      check (notes is null or char_length(notes) <= 400),
  add constraint matches_share_code_len check (char_length(share_code) = 6);

alter table public.reports
  add constraint reports_reason_len  check (char_length(reason) <= 60),
  add constraint reports_details_len check (details is null or char_length(details) <= 280);

alter table public.availability
  add constraint availability_note_len check (note is null or char_length(note) <= 200);

alter table public.venues
  add constraint venues_name_len    check (char_length(name) <= 80),
  add constraint venues_address_len check (address is null or char_length(address) <= 160),
  add constraint venues_phone_len   check (phone is null or char_length(phone) <= 20);

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

-- ============================================================================
-- CLIENT CHANGES REQUIRED (do in the same PR as applying this migration):
--   1. src/features/matches/data/matchRepository.ts  listPlayers():
--        'profile:profiles(full_name, area_name)'  ->  'profile:public_profiles(full_name, area_name)'
--   2. src/features/availability/data/availabilityRepository.ts  nearby():
--        .from('profiles')  ->  .from('public_profiles')
--   3. Own-profile reads (AuthProvider, profileRepository.getMine) unchanged —
--      self policy still allows them.
--   4. Venue creation UI: admin screen only (already the case) — the user-facing
--      repo method venueRepository.create() will now fail for non-admins.
-- ============================================================================
