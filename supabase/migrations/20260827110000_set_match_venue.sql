-- Attach (or clear) a venue on an existing match.
--
-- The create flow deliberately captures an AREA and defers the venue: booking a
-- ground is a spend, creating a match is only an intent, and gating the intent
-- behind the spend kills the flow. 20260820120000_area_based_match_creation
-- made venue_id nullable everywhere; this is the missing write path that lets
-- the organiser attach the ground once they have actually booked it.
--
-- Organiser-only, consistent with perform_toss / redo_toss / set_toss_decision /
-- start_innings / create_rematch (20260826120000_creator_only_toss_and_scoring).
-- One person holds the app on the ground; the opposing captain reads.
--
-- DELIBERATELY does not touch match_lat / match_lng. Those drive nearby_matches,
-- which is how players discover the match. If tagging a venue moved the pin, a
-- match would silently drift into and out of people's search radius AFTER they
-- had joined. Discovery stays anchored to the area chosen at wizard step 2; the
-- venue is display and directions only. "Matches move to their venue" would be a
-- separate decision with a notification attached, not a side effect of this.
--
-- create_rematch already copies venue_id / venue_text from the original match,
-- so every subsequent game inside a booked slot inherits the tag for free.

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

  if v_match.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  -- status is one of open | locked | completed | cancelled.
  if v_match.status not in ('open', 'locked') then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;

  -- Passing null clears the tag: the organiser picked the wrong ground, or the
  -- booking fell through. venue_text goes back to null so the detail screen
  -- shows the add-venue prompt again and falls back to area_name.
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
