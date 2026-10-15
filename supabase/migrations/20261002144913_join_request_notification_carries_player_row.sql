-- ============================================================================
-- join_requested notifications carry the match_players row id.
--
-- The app's in-app popup for a join request offers a one-tap "Accept". It used
-- to get the row id from its own Realtime listener on match_players, which
-- cannot be filtered per user and raised a second popup beside the one this
-- notification already produces. The listener is gone; the id travels here.
--
-- Only `playerRowId` is new. Older app builds ignore keys they do not read.
-- ============================================================================

create or replace function public.tg_notify_join_requested()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_match public.matches%rowtype; v_name text;
begin
  if new.status <> 'interested' then return new; end if;
  select * into v_match from public.matches where id = new.match_id;
  if not found or v_match.creator_id = new.user_id then return new; end if;
  select coalesce(full_name, 'A player') into v_name from public.profiles where id = new.user_id;
  perform public.enqueue_notification(
    v_match.creator_id, 'join_requested', 'New join request',
    v_name || ' wants to join ' || v_match.match_name,
    jsonb_build_object(
      'matchId', new.match_id,
      'playerRowId', new.id,
      'route', '/match/' || new.match_id));
  return new;
end;
$function$;
