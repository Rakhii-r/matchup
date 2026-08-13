-- Fixes for four defects found reviewing team_challenges, all reproduced on prod:
--   1. block list bypassed: only the two OWNERS were checked, then every member
--      of both squads was force-confirmed. A user who had blocked someone ended
--      up confirmed on a match with them.
--   2. no capacity check: sync_filled_slots clamps with least(), so an oversized
--      double roster displayed as full while being silently over-rostered.
--   3. a lapsed pending challenge could never be accepted, declined or replaced,
--      permanently blocking that pair from challenging each other again.
--      'cancelled' was in the CHECK constraint with no code path reaching it.
--   4. the opponent could read the challenge but not the challenger's team row
--      (teams_select is members-only), so a challenges screen could not render
--      anything but a raw uuid.
-- Defects 1 and 2 are fixed in the RPCs (next two migrations); 3 and 4 here.

-- 'browse' was factually false for a challenge-created roster.
alter table public.match_players drop constraint if exists match_players_joined_via_check;
alter table public.match_players add constraint match_players_joined_via_check
  check (joined_via in ('code','browse','alert','challenge'));

-- Head-to-head context. Cheap now, unreconstructable later; also gives Phase 2
-- FR-204 the two identified sides it needs.
alter table public.matches
  add column if not exists team_a_id     uuid references public.teams (id) on delete set null,
  add column if not exists team_b_id     uuid references public.teams (id) on delete set null,
  add column if not exists challenge_id  uuid references public.team_challenges (id) on delete set null;
create index if not exists matches_team_a_idx on public.matches (team_a_id) where team_a_id is not null;
create index if not exists matches_team_b_idx on public.matches (team_b_id) where team_b_id is not null;

-- Defect 3: withdraw a challenge you sent.
create or replace function public.cancel_challenge(in_challenge_id uuid)
returns public.team_challenges
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_c   public.team_challenges%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_c from public.team_challenges where id = in_challenge_id for update;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'CHALLENGE_ALREADY_ANSWERED' using errcode = '23514';
  end if;
  if not public.is_team_owner(v_c.from_team_id, v_uid) then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;
  update public.team_challenges
     set status = 'cancelled', responded_at = now()
   where id = v_c.id
   returning * into v_c;
  return v_c;
end;
$$;

-- Defect 4: everything a challenges screen needs, in one readable call.
-- SECURITY DEFINER so team names resolve despite members-only teams_select;
-- the WHERE clause re-applies the same visibility rule the RLS policy uses.
create or replace function public.list_my_challenges()
returns table (
  id uuid, status text, direction text,
  from_team_id uuid, from_team_name text,
  to_team_id uuid, to_team_name text,
  match_name text, venue_name text, scheduled_at timestamptz,
  total_slots integer, message text, match_id uuid,
  is_expired boolean, i_can_respond boolean, i_can_cancel boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.status,
    case when public.is_team_member(c.from_team_id, (select auth.uid()))
         then 'outgoing' else 'incoming' end,
    c.from_team_id, ft.name,
    c.to_team_id,   tt.name,
    c.match_name, v.name, c.scheduled_at,
    c.total_slots, c.message, c.match_id,
    c.scheduled_at <= now(),
    c.status = 'pending' and c.scheduled_at > now()
      and public.is_team_owner(c.to_team_id, (select auth.uid())),
    c.status = 'pending'
      and public.is_team_owner(c.from_team_id, (select auth.uid())),
    c.created_at
  from public.team_challenges c
  join public.teams  ft on ft.id = c.from_team_id
  join public.teams  tt on tt.id = c.to_team_id
  join public.venues v  on v.id  = c.venue_id
  where public.is_team_member(c.from_team_id, (select auth.uid()))
     or public.is_team_member(c.to_team_id,   (select auth.uid()))
  order by c.created_at desc
  limit 100;
$$;

revoke execute on function public.cancel_challenge(uuid)  from anon, public;
revoke execute on function public.list_my_challenges()    from anon, public;
grant  execute on function public.cancel_challenge(uuid)  to authenticated;
grant  execute on function public.list_my_challenges()    to authenticated;
