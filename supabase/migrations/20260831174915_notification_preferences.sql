-- Pushes fired for 14 kinds with no way to mute any. Preferences are keyed by
-- GROUP, not by kind: a new kind then falls into an existing group and honours
-- a choice the user already made instead of silently escaping it.
-- Absent key = enabled; only an explicit false mutes, so no backfill is needed.
alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notif_prefs is
  'Push mute switches keyed by notification group (see notif_group). Absent = on, false = muted.';

create or replace function public.notif_group(in_kind text)
returns text language sql immutable set search_path to 'public'
as $function$
  select case in_kind
    when 'join_requested'     then 'games'
    when 'join_approved'      then 'games'
    when 'join_confirmed'     then 'games'
    when 'match_invited'      then 'games'
    when 'challenge_offer'    then 'challenges'
    when 'challenge_interest' then 'challenges'
    when 'challenge_received' then 'challenges'
    when 'challenge_accepted' then 'challenges'
    when 'challenge_taken'    then 'challenges'
    when 'toss_ready'         then 'toss_scoring'
    when 'toss_done'          then 'toss_scoring'
    when 'next_game_started'  then 'toss_scoring'
    when 'chat_message'       then 'chat'
    when 'slot_ending'        then 'slots'
    else 'games'
  end;
$function$;

create or replace function public.enqueue_notification(
  in_user_id uuid, in_kind text, in_title text, in_body text,
  in_data jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_muted boolean;
begin
  -- Skipped entirely rather than queued-and-dropped: an unsent row in
  -- notification_jobs would look like a delivery failure to notify-wave.
  select (p.notif_prefs -> public.notif_group(in_kind)) = 'false'::jsonb
    into v_muted from public.profiles p where p.id = in_user_id;
  if coalesce(v_muted, false) then
    return;
  end if;
  insert into public.notification_jobs (user_id, kind, title, body, data)
  values (in_user_id, in_kind, in_title, in_body, coalesce(in_data, '{}'::jsonb));
end;
$function$;

revoke execute on function public.enqueue_notification(uuid, text, text, text, jsonb) from anon, authenticated;
revoke execute on function public.notif_group(text) from anon;
