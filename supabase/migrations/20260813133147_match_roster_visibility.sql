-- ============================================================================
-- Match roster visibility — two defects found on a real device, 12 Aug 2026.
--
-- DEFECT 1 (live in production). `match_players_select` is
--     user_id = auth.uid() OR is_match_creator(match_id, auth.uid())
-- so anyone who is not the organiser sees exactly ONE row: their own. In a team
-- fixture that means the opposing captain opens the match and cannot see who
-- they are playing, how many turned up, or that their own squad is even on the
-- sheet. The rule was written for the join-request queue, where a stranger
-- genuinely should not see other people's pending requests, and was never
-- revisited when team challenges landed.
--
-- The privacy intent is still right and is preserved below: the REQUEST QUEUE
-- ('interested') stays organiser-only. What changes is that a player who has
-- actually been seated may see the other seated players.
--
-- DEFECT 2. The roster rendered as one flat list with both squads mixed
-- together, because match_players had no team column. open_challenges adds
-- `team_id`; this migration backfills the rows that already exist.
--
-- Team NAMES are a third problem: `teams` is members-only, so the opposing
-- captain cannot read your team's name even once they can see your players.
-- That is why the roster is served by a SECURITY DEFINER RPC here rather than a
-- direct select — the same reason list_my_challenges exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Backfill team_id for fixtures created before the column existed.
-- ---------------------------------------------------------------------------
update public.match_players mp
   set team_id = tm.team_id
  from public.matches m
  join public.team_members tm on tm.team_id in (m.team_a_id, m.team_b_id)
 where mp.match_id = m.id
   and tm.user_id = mp.user_id
   and mp.team_id is null
   and m.challenge_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Seated-player helper.
--
-- SECURITY DEFINER for the same reason is_match_player is: a policy on
-- match_players that queried match_players directly would recurse.
-- 'interested' is deliberately NOT seated — asking to join must not reveal the
-- roster to someone the organiser has not accepted.
-- ---------------------------------------------------------------------------
create or replace function public.is_seated_match_player(p_match_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_players
     where match_id = p_match_id
       and user_id = p_uid
       and status in ('confirmed', 'invited', 'approved')
  );
$$;

revoke execute on function public.is_seated_match_player(uuid, uuid) from anon, public;
grant  execute on function public.is_seated_match_player(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The corrected policy.
-- ---------------------------------------------------------------------------
drop policy if exists "match_players_select" on public.match_players;
create policy "match_players_select" on public.match_players
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_match_creator(match_id, (select auth.uid()))
    or (
      -- A seated player sees the other seated players. The pending request
      -- queue stays organiser-only, which was the original point of this rule.
      status in ('confirmed', 'invited', 'approved')
      and public.is_seated_match_player(match_id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 4. list_match_players — roster with side and team name resolved.
--
-- `teams` is members-only and `profiles` is self-only behind public_profiles,
-- so a plain select can never produce "Kavya · maintain easy strikers" for the
-- opposing captain. This resolves both, applying the same visibility rule as
-- the policy above rather than bypassing it.
-- ---------------------------------------------------------------------------
create or replace function public.list_match_players(in_match_id uuid)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  area_name text,
  avatar_url text,
  status text,
  joined_via text,
  team_id uuid,
  team_name text,
  side text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select mp.id,
         mp.user_id,
         p.full_name,
         p.area_name,
         p.avatar_url,
         mp.status,
         mp.joined_via,
         mp.team_id,
         t.name,
         case
           when mp.team_id is null            then null
           when mp.team_id = m.team_a_id      then 'a'
           when mp.team_id = m.team_b_id      then 'b'
           else null
         end,
         mp.created_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.teams t on t.id = mp.team_id
    left join public.profiles p on p.id = mp.user_id
   where mp.match_id = in_match_id
     and (
       -- Organiser sees everything, including the request queue.
       public.is_match_creator(in_match_id, (select auth.uid()))
       -- A seated player sees the seated squads, never the queue.
       or (
         mp.status in ('confirmed', 'invited', 'approved')
         and public.is_seated_match_player(in_match_id, (select auth.uid()))
       )
       -- Everyone else sees only themselves.
       or mp.user_id = (select auth.uid())
     )
   order by
     case when mp.team_id = m.team_a_id then 0
          when mp.team_id = m.team_b_id then 1
          else 2 end,
     mp.created_at asc;
$$;

revoke execute on function public.list_match_players(uuid) from anon, public;
grant  execute on function public.list_match_players(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_match_sides — the two team names for the header.
--
-- Separate from the roster so the screen can label "ASR WARRIORS vs maintain
-- easy strikers" even before any player row loads, and so a fixture whose
-- opponent squad is empty still shows both names.
-- ---------------------------------------------------------------------------
create or replace function public.get_match_sides(in_match_id uuid)
returns table (team_a_id uuid, team_a_name text, team_b_id uuid, team_b_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.team_a_id, ta.name, m.team_b_id, tb.name
    from public.matches m
    left join public.teams ta on ta.id = m.team_a_id
    left join public.teams tb on tb.id = m.team_b_id
   where m.id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     );
$$;

revoke execute on function public.get_match_sides(uuid) from anon, public;
grant  execute on function public.get_match_sides(uuid) to authenticated;
