-- 0012: Server-authoritative, race-free match joining.
--
-- Before this migration the only way to join was a direct INSERT into
-- match_players, guarded by the `match_players_insert_self` policy. That policy
-- can check "this row is mine", but RLS cannot take a row lock, so two players
-- tapping Join on the last slot at the same moment both succeeded and the match
-- silently oversubscribed. Eligibility (is the match open? already started? am I
-- the creator? are we blocked?) was also decided entirely on the client.
--
-- Fix: one SECURITY DEFINER function that locks the match row with FOR UPDATE,
-- re-checks every rule server-side, and inserts the queue row itself. Direct
-- INSERT is then revoked so join_match() is the ONLY way into match_players —
-- the function bypasses RLS because it runs as the owner.
--
-- Failures raise with a stable machine token as the message (MATCH_FULL, etc.)
-- so the client can show a specific, actionable error instead of a generic one.
-- The SQLSTATE is chosen so PostgREST maps it to a sensible HTTP status.

create or replace function public.join_match(
  in_match_id   uuid,
  in_joined_via text default 'browse'
)
returns public.match_players
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := (select auth.uid());
  v_match          public.matches%rowtype;
  v_existing       public.match_players%rowtype;
  v_inserted       public.match_players%rowtype;
  v_confirmed      integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if in_joined_via not in ('code', 'browse', 'alert') then
    raise exception 'INVALID_JOIN_SOURCE' using errcode = '23514';
  end if;

  -- Deliberately NOT public.is_active_user(): that helper is created in
  -- 0006_security_hardening, which is not deployed everywhere. Reading
  -- profiles.is_active directly keeps this migration self-contained. Safe from
  -- here because the function is SECURITY DEFINER and bypasses RLS on profiles.
  if not exists (
    select 1 from public.profiles p where p.id = v_uid and p.is_active
  ) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  -- FOR UPDATE serialises concurrent joins on the same match: the second caller
  -- blocks here until the first has committed, so it sees the true slot count.
  select * into v_match
  from public.matches
  where id = in_match_id
  for update;

  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_match.creator_id = v_uid then
    raise exception 'OWN_MATCH' using errcode = '42501';
  end if;

  if public.is_blocked_between(v_uid, v_match.creator_id) then
    -- Deliberately indistinguishable from "not found" in the UI copy: never
    -- confirm to a blocked user that a specific match or organiser exists.
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_match.status <> 'open' then
    raise exception 'MATCH_NOT_OPEN' using errcode = '23514';
  end if;

  if v_match.scheduled_at <= now() then
    raise exception 'MATCH_STARTED' using errcode = '23514';
  end if;

  -- Idempotent: joining twice (double tap, or code + nearby) is not an error.
  -- Return the row already in the queue, unchanged — re-joining must never
  -- reset an 'approved' or 'confirmed' player back to 'interested'.
  select * into v_existing
  from public.match_players
  where match_id = in_match_id and user_id = v_uid;

  if found then
    return v_existing;
  end if;

  -- Capacity: the creator occupies one slot, each confirmed player one more.
  -- 'interested' players do not consume a slot, but there is no point queueing
  -- for a team that is already full.
  select count(*) into v_confirmed
  from public.match_players
  where match_id = in_match_id and status = 'confirmed';

  if (1 + v_confirmed) >= v_match.total_slots then
    raise exception 'MATCH_FULL' using errcode = '23514';
  end if;

  insert into public.match_players (match_id, user_id, status, joined_via)
  values (in_match_id, v_uid, 'interested', in_joined_via)
  returning * into v_inserted;

  return v_inserted;
end;
$$;

revoke execute on function public.join_match(uuid, text) from anon, public;
grant  execute on function public.join_match(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct-INSERT path.
--
-- With the policy dropped and no other INSERT policy on the table, RLS denies
-- every client-side insert into match_players. join_match() is SECURITY DEFINER
-- and runs as the table owner, which bypasses RLS, so it keeps working. This is
-- what makes the capacity check above authoritative rather than advisory.
-- ---------------------------------------------------------------------------
drop policy if exists "match_players_insert_self" on public.match_players;
