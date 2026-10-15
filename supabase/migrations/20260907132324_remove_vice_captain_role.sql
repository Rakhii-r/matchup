-- A squad has ONE leader: the captain, who is teams.owner_id and carries the
-- 'owner' role row in team_members. The 'vice_captain' role is removed.
--
-- It was cosmetic to begin with: no RLS policy and no RPC ever consulted it,
-- so nothing gains or loses a permission here. It only ever painted a badge and
-- gave the captain a button that promoted somebody to a title with no powers.
--
-- Order matters: demote first, THEN tighten the constraint, or the new check
-- would be rejected against the existing rows.

update public.team_members
   set role = 'member'
 where role = 'vice_captain';

alter table public.team_members
  drop constraint if exists team_members_role_check;

alter table public.team_members
  add constraint team_members_role_check
  check (role = any (array['owner', 'member']));

-- The only writer of the column. With one assignable role left there is nothing
-- for it to set, so it goes rather than lingering as a callable no-op.
drop function if exists public.set_member_role(uuid, uuid, text);
