-- In-app account deletion (Google Play + App Store requirement, 27 Oct 2026).
--
-- NOT a delete of auth.users / profiles. Deleting the profile row would:
--   * cascade-delete every match the user created (matches.creator_id),
--     taking other players' scorecards and history with it;
--   * cascade-delete every team they own, and with it innings (team ids);
--   * fail outright for anyone who ever batted or bowled
--     (deliveries.*_id are ON DELETE RESTRICT).
-- So the person is erased instead: personal data deleted, the profile reduced
-- to an anonymous "Deleted player" shell that keeps shared records intact, and
-- the login removed so the phone number is free and signs up as a new account.
--
-- The avatar file is removed by the client BEFORE calling this:
-- storage.objects refuses deletes from SQL (protect_objects_delete).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_team record;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Squads they own pass to their longest-standing other member. A squad with
  -- nobody else stays as it is under the anonymous shell: deleting it would
  -- cascade into innings and remove opponents' scorecards.
  for v_team in
    select t.id from public.teams t where t.owner_id = v_uid
  loop
    select tm.user_id into v_next
      from public.team_members tm
     where tm.team_id = v_team.id and tm.user_id <> v_uid
     order by tm.joined_at
     limit 1;
    if v_next is not null then
      update public.teams set owner_id = v_next where id = v_team.id;
      update public.team_members set role = 'owner'
       where team_id = v_team.id and user_id = v_next;
      delete from public.team_members where team_id = v_team.id and user_id = v_uid;
    end if;
  end loop;
  delete from public.team_members tm
   using public.teams t
   where tm.team_id = t.id and tm.user_id = v_uid and t.owner_id <> v_uid;

  -- Games that have not started: call off the ones they organise, and give up
  -- their seat in everyone else's (match_players_sync_filled frees the slot).
  update public.matches set status = 'cancelled'
   where creator_id = v_uid and status = 'open';
  delete from public.match_players mp
   using public.matches m
   where mp.match_id = m.id and mp.user_id = v_uid and m.status = 'open';

  -- Personal data with no value to anyone else.
  delete from public.devices where user_id = v_uid;
  delete from public.availability where user_id = v_uid;
  delete from public.blocks where blocker_id = v_uid or blocked_id = v_uid;
  delete from public.reports where reporter_id = v_uid;
  delete from public.venue_ratings where user_id = v_uid;
  delete from public.notification_jobs where user_id = v_uid;
  delete from public.team_join_requests where user_id = v_uid;
  delete from public.captain_chat_messages where sender_id = v_uid or recipient_id = v_uid;
  delete from public.user_roles where user_id = v_uid;
  delete from public.venue_bookings where user_id = v_uid and start_time > now();

  update public.profiles
     set full_name = 'Deleted player',
         phone = null,
         area_name = null,
         home_lat = null,
         home_lng = null,
         home_location = null,
         avatar_url = null,
         sport_pref = '{}',
         playing_role = null,
         is_active = false,
         updated_at = now()
   where id = v_uid;

  -- The login itself. With the phone gone the number can sign up again as a
  -- brand-new account; the remaining auth row is an opaque id with no way in.
  delete from auth.sessions where user_id = v_uid;
  delete from auth.refresh_tokens where user_id = v_uid::text;
  delete from auth.identities where user_id = v_uid;
  update auth.users
     set phone = null,
         email = null,
         raw_user_meta_data = '{}'::jsonb,
         -- A real date, not 'infinity': GoTrue and the dashboard parse it.
         banned_until = now() + interval '100 years'
   where id = v_uid;
end;
$function$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
