-- The chat push routed to '/chat/<match_id or challenge_id>' and nothing else.
-- On a challenge that is ambiguous: the poster has many challenge_candidates,
-- so a tap landed on a thread the screen could not resolve and
-- get_captain_chat raised NEED_OPPONENT_TEAM. The payload already carried
-- senderId; putting it in the route as well means the tap resolves.
--
-- Rebuilt from prod's current body (pg_get_functiondef, 30 Aug) with only the
-- 'route' value changed. Everything else -- the 240-char truncation that keeps
-- notification_jobs_body_check from aborting the message's own insert -- is
-- load-bearing and unchanged.
create or replace function public.notify_captain_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
begin
  select full_name into v_sender_name from public.profiles where id = new.sender_id;

  perform public.enqueue_notification(
    new.recipient_id,
    'chat_message',
    'Message from ' || coalesce(v_sender_name, 'Opponent Captain'),
    left(new.content, 240),
    jsonb_build_object(
      'route', '/chat/' || coalesce(new.match_id::text, new.challenge_id::text)
                        || '?otherUserId=' || new.sender_id::text,
      'challengeId', new.challenge_id,
      'matchId', new.match_id,
      'senderId', new.sender_id
    )
  );
  return new;
end;
$$;
