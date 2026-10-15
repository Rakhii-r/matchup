-- Tagging a venue now tells the other captain.
--
-- WHY: set_match_venue is organiser-only, and nothing told the opposing captain
-- a ground had been chosen. The organiser picked in silence and the other squad
-- found out on match day, or not at all. Captain chat and its push chain
-- already exist, so the notice costs one insert — no new table, no new push
-- plumbing, no accept/reject state machine. If the other captain disagrees they
-- reply in the same thread and the organiser re-tags; that is what two people
-- with a chat already do.
--
-- The message is sent AS the organiser, because that is true — they picked it.
--
-- Rebuilt from prod's current body (pg_get_functiondef, 30 Aug). Everything
-- above the notice is byte-identical; only the block marked NEW is added.
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
  v_prev  uuid;      -- NEW
  v_other uuid;      -- NEW
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

  if v_match.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_match.status not in ('open', 'locked') then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;

  v_prev := v_match.venue_id;   -- NEW: captured before the update overwrites it

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

  -- NEW ---------------------------------------------------------------------
  -- Only on a real change, so re-tapping the same ground does not re-notify.
  -- The whole block is best-effort: a match with one team, or an open match
  -- whose two shells are both owned by the organiser, has no counterpart to
  -- tell. Losing the notice must never lose the venue tag, so any failure here
  -- is swallowed.
  if v_prev is distinct from v_venue.id then
    begin
      v_other := public._resolve_chat_counterpart(in_match_id, null, null, null);

      if v_other is not null and v_other <> v_uid then
        insert into public.captain_chat_messages
          (match_id, sender_id, recipient_id, content)
        values (
          in_match_id, v_uid, v_other,
          'Ground set: ' || v_venue.name
            || coalesce(' — ' || nullif(btrim(v_venue.address), ''), '')
            || '. sixfour24 has not reserved this turf, so call the ground to confirm the slot.'
        );
      end if;
    exception when others then
      null;
    end;
  end if;
  -- END NEW -----------------------------------------------------------------

  return v_match;
end;
$function$;
