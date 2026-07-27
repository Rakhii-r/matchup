-- ============================================================================
-- MatchUp — fix infinite recursion in matches / match_players RLS
-- matches_select checks match_players (RLS-protected), whose own select policy
-- checks matches (RLS-protected) right back — Postgres detects the cycle and
-- raises "infinite recursion detected in policy for relation matches" on every
-- matches insert/select. security definer helpers run as the function owner
-- (exempt from RLS), so cross-table policy checks no longer re-enter the
-- other table's RLS. Same pattern as public.is_blocked_between in 0001.
-- ============================================================================

create or replace function public.is_match_creator(p_match_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.matches where id = p_match_id and creator_id = p_uid
  );
$$;

create or replace function public.is_match_player(p_match_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.match_players where match_id = p_match_id and user_id = p_uid
  );
$$;

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
drop policy "matches_select" on public.matches;
create policy "matches_select" on public.matches for select to authenticated
  using (
    not public.is_blocked_between(auth.uid(), creator_id)
    and (
      status = 'open'
      or creator_id = auth.uid()
      or public.is_match_player(id, auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- match_players
-- ---------------------------------------------------------------------------
drop policy "match_players_select" on public.match_players;
create policy "match_players_select" on public.match_players for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_creator(match_id, auth.uid())
  );

drop policy "match_players_update_creator" on public.match_players;
create policy "match_players_update_creator" on public.match_players for update to authenticated
  using (public.is_match_creator(match_id, auth.uid()))
  with check (public.is_match_creator(match_id, auth.uid()));

drop policy "match_players_delete" on public.match_players;
create policy "match_players_delete" on public.match_players for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_creator(match_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
drop policy "attendance_select" on public.attendance;
create policy "attendance_select" on public.attendance for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_creator(match_id, auth.uid())
  );

drop policy "attendance_insert_creator" on public.attendance;
create policy "attendance_insert_creator" on public.attendance for insert to authenticated
  with check (
    marked_by = auth.uid()
    and public.is_match_creator(match_id, auth.uid())
  );

drop policy "attendance_update_creator" on public.attendance;
create policy "attendance_update_creator" on public.attendance for update to authenticated
  using (public.is_match_creator(match_id, auth.uid()))
  with check (marked_by = auth.uid());
