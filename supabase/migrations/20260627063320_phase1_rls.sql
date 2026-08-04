-- ============================================================================
-- MatchUp — Phase 1 Row-Level Security
-- RLS is enabled on EVERY table. The client only holds the user's JWT, so these
-- policies are the real access-control boundary. auth.uid() = the signed-in user.
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.venues        enable row level security;
alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.attendance    enable row level security;
alter table public.availability  enable row level security;
alter table public.devices       enable row level security;
alter table public.reports       enable row level security;
alter table public.blocks        enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles_select" on public.profiles for select to authenticated
  using (auth.uid() = id or not public.is_blocked_between(auth.uid(), id));

create policy "profiles_insert_self" on public.profiles for insert to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_self" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- venues  (any signed-in user can read; only the creator can edit)
-- ---------------------------------------------------------------------------
create policy "venues_select" on public.venues for select to authenticated using (true);

create policy "venues_insert" on public.venues for insert to authenticated
  with check (auth.uid() = created_by);

create policy "venues_update_owner" on public.venues for update to authenticated
  using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "venues_delete_owner" on public.venues for delete to authenticated
  using (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
create policy "matches_select" on public.matches for select to authenticated
  using (
    not public.is_blocked_between(auth.uid(), creator_id)
    and (
      status = 'open'
      or creator_id = auth.uid()
      or exists (
        select 1 from public.match_players mp
        where mp.match_id = matches.id and mp.user_id = auth.uid()
      )
    )
  );

create policy "matches_insert_creator" on public.matches for insert to authenticated
  with check (auth.uid() = creator_id);

create policy "matches_update_creator" on public.matches for update to authenticated
  using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "matches_delete_creator" on public.matches for delete to authenticated
  using (auth.uid() = creator_id);

-- ---------------------------------------------------------------------------
-- match_players
-- ---------------------------------------------------------------------------
create policy "match_players_select" on public.match_players for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = match_players.match_id and m.creator_id = auth.uid()
    )
  );

-- A player adds only their own row (express interest / join).
create policy "match_players_insert_self" on public.match_players for insert to authenticated
  with check (user_id = auth.uid());

-- Only the match creator changes a player's status (approve / reject / confirm).
create policy "match_players_update_creator" on public.match_players for update to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_players.match_id and m.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_players.match_id and m.creator_id = auth.uid()
    )
  );

-- A player can withdraw their own row; the creator can remove anyone.
create policy "match_players_delete" on public.match_players for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = match_players.match_id and m.creator_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- attendance  (only the match creator records it)
-- ---------------------------------------------------------------------------
create policy "attendance_select" on public.attendance for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
      where m.id = attendance.match_id and m.creator_id = auth.uid()
    )
  );

create policy "attendance_insert_creator" on public.attendance for insert to authenticated
  with check (
    marked_by = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = attendance.match_id and m.creator_id = auth.uid()
    )
  );

create policy "attendance_update_creator" on public.attendance for update to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = attendance.match_id and m.creator_id = auth.uid()
    )
  )
  with check (marked_by = auth.uid());

-- ---------------------------------------------------------------------------
-- availability  (read by all for discovery, block-aware; write only your own)
-- ---------------------------------------------------------------------------
create policy "availability_select" on public.availability for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked_between(auth.uid(), user_id));

create policy "availability_insert_self" on public.availability for insert to authenticated
  with check (user_id = auth.uid());

create policy "availability_update_self" on public.availability for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "availability_delete_self" on public.availability for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- devices  (strictly your own)
-- ---------------------------------------------------------------------------
create policy "devices_select_self" on public.devices for select to authenticated
  using (user_id = auth.uid());

create policy "devices_insert_self" on public.devices for insert to authenticated
  with check (user_id = auth.uid());

create policy "devices_update_self" on public.devices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "devices_delete_self" on public.devices for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reports  (you see and create only your own)
-- ---------------------------------------------------------------------------
create policy "reports_select_own" on public.reports for select to authenticated
  using (reporter_id = auth.uid());

create policy "reports_insert_self" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- blocks  (you manage only your own block list)
-- ---------------------------------------------------------------------------
create policy "blocks_select_own" on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

create policy "blocks_insert_self" on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid());

create policy "blocks_delete_self" on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());
