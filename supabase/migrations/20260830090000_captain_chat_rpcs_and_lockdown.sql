-- Captain chat: move the whole read/write path behind RPCs, revoke the
-- client's direct table privileges, and make a thread mean (thread + pair).
--
-- Captain chat shipped 27 Aug (20260827160000) with the write path on the
-- client. Five defects followed from that decision.
--
-- 1. THE ORGANISER SIDE OF EVERY THREAD WAS UNSENDABLE. app/chat/[id].tsx
--    guessed recipient_id. On a match it used get_match_sides.team_b_id -- a
--    TEAM id written into a column whose FK points at profiles(id), so the
--    insert died on 23503. On a challenge it passed null and zod refused it.
--    Whoever ran the match could read and never reply. No entry point ever
--    passed a recipientId, so nothing covered for it.
--
-- 2. captain_chat_insert only checked `auth.uid() = sender_id`. It never
--    checked that the sender belongs to the challenge or match, nor that the
--    recipient is that thread's counterpart. Any authenticated user could
--    insert a row naming any recipient on any thread, and
--    trg_captain_chat_notify would push it to them: an open DM + push channel
--    to every account in the app.
--
-- 3. captain_chat_update was `auth.uid() = recipient_id` with no column
--    restriction. The recipient could UPDATE `content` and leave it
--    attributed to the sender. It exists only so a reader can set is_read.
--
-- 4. An open challenge has MANY challenge_candidates. Reads filtered on
--    challenge_id alone, and the poster is recipient on every applicant's
--    messages, so the poster's screen merged every applicant conversation
--    into one interleaved thread. A thread is (match or challenge) PLUS the
--    counterpart -- never the id on its own. That is why reads move server
--    side here too, not just writes.
--
-- 5. No send throttle. Every insert fires trg_captain_chat_notify, so an
--    unthrottled sender is an unthrottled push firehose aimed at one captain.
--    slot_reminders exists because this project already learned that lesson
--    with slot pushes.
--
-- Chat is TEAM OWNERS ONLY (owner's call, 15 Aug 2026). The canonical poster
-- identity is teams.owner_id of from_team_id, NOT team_challenges.created_by.
-- If a vice-captain posted the challenge, honouring created_by would split one
-- conversation across two recipient ids and neither party would see it whole.
--
-- SELECT stays granted to authenticated: supabase realtime evaluates RLS per
-- row for the subscriber, so the postgres_changes subscription in
-- useChatRealtime needs it. INSERT/UPDATE/DELETE go away.
--
-- On in_other_user_id: notify_captain_chat_message routes a push to
-- '/chat/<match_id or challenge_id>' and carries senderId. A poster tapping
-- applicant B's push therefore arrives holding a USER id and no team, which
-- would otherwise raise NEED_OPPONENT_TEAM. Every RPC accepts either
-- coordinate and validates whichever it is given.

-- ---------------------------------------------------------------------------
-- 1. Counterpart resolution -- the one place that decides who the other
--    captain is. Internal: no role holds EXECUTE. The three RPCs below are
--    SECURITY DEFINER owned by the same role, so they can still call it.
-- ---------------------------------------------------------------------------

create or replace function public._resolve_chat_counterpart(
  in_match_id       uuid,
  in_challenge_id   uuid,
  in_to_team_id     uuid,
  in_other_user_id  uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_m       public.matches%rowtype;
  v_c       public.team_challenges%rowtype;
  v_a_owner uuid;
  v_b_owner uuid;
  v_target  uuid;
  v_other   uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- A fixture: the two sides are settled, so both hints are only checked, not
  -- needed.
  if in_match_id is not null then
    select * into v_m from public.matches where id = in_match_id;
    if not found then
      raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_m.team_a_id is null or v_m.team_b_id is null then
      raise exception 'NO_OPPONENT' using errcode = '23514';
    end if;

    select owner_id into v_a_owner from public.teams where id = v_m.team_a_id;
    select owner_id into v_b_owner from public.teams where id = v_m.team_b_id;

    if v_uid = v_a_owner then
      v_other := v_b_owner;
    elsif v_uid = v_b_owner then
      v_other := v_a_owner;
    else
      raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
    end if;

    if in_other_user_id is not null and in_other_user_id <> v_other then
      raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
    end if;
    return v_other;
  end if;

  if in_challenge_id is not null then
    select * into v_c from public.team_challenges where id = in_challenge_id;
    if not found then
      raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
    end if;

    select owner_id into v_a_owner from public.teams where id = v_c.from_team_id;

    -- Poster side. Before acceptance there may be several applicants, so the
    -- caller must name one -- by team (the applicant list) or by user (a push
    -- tap, which carries senderId). After acceptance to_team_id settles it.
    if v_uid = v_a_owner then
      if in_other_user_id is not null then
        if not exists (
          select 1
            from public.teams t
           where t.owner_id = in_other_user_id
             and (
                  t.id = v_c.to_team_id
                  or exists (
                       select 1 from public.challenge_candidates cc
                        where cc.challenge_id = v_c.id and cc.team_id = t.id
                     )
                 )
        ) then
          raise exception 'NOT_A_CANDIDATE' using errcode = '42501';
        end if;
        return in_other_user_id;
      end if;

      v_target := coalesce(in_to_team_id, v_c.to_team_id);
      if v_target is null then
        raise exception 'NEED_OPPONENT_TEAM' using errcode = '23514';
      end if;
      if v_target is distinct from v_c.to_team_id
         and not exists (
           select 1 from public.challenge_candidates cc
            where cc.challenge_id = v_c.id and cc.team_id = v_target
         )
      then
        raise exception 'NOT_A_CANDIDATE' using errcode = '42501';
      end if;
      select owner_id into v_other from public.teams where id = v_target;
      if v_other is null then
        raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
      end if;
      return v_other;
    end if;

    -- Applicant side: the caller must own a team that applied or was accepted.
    if exists (
      select 1
        from public.teams t
       where t.owner_id = v_uid
         and (
              t.id = v_c.to_team_id
              or exists (
                   select 1 from public.challenge_candidates cc
                    where cc.challenge_id = v_c.id and cc.team_id = t.id
                 )
             )
    ) then
      if in_other_user_id is not null and in_other_user_id <> v_a_owner then
        raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
      end if;
      return v_a_owner;
    end if;

    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  raise exception 'NO_THREAD' using errcode = '23514';
end;
$$;

revoke all on function public._resolve_chat_counterpart(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. send_captain_message -- the only way a row enters this table.
-- ---------------------------------------------------------------------------

create or replace function public.send_captain_message(
  in_match_id      uuid,
  in_challenge_id  uuid,
  in_to_team_id    uuid,
  in_other_user_id uuid,
  in_content       text
)
returns public.captain_chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_other   uuid;
  v_content text;
  v_recent  integer;
  v_row     public.captain_chat_messages%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;

  v_content := btrim(coalesce(in_content, ''));
  if v_content = '' then
    raise exception 'EMPTY_MESSAGE' using errcode = '23514';
  end if;
  -- Mirrors SendMessageSchema. The 240-char push truncation lives in
  -- notify_captain_chat_message and is deliberately separate from this.
  if char_length(v_content) > 1000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = '23514';
  end if;

  v_other := public._resolve_chat_counterpart(
    in_match_id, in_challenge_id, in_to_team_id, in_other_user_id
  );

  if public.is_blocked_between(v_uid, v_other) then
    raise exception 'BLOCKED' using errcode = '42501';
  end if;

  -- One insert = one push. 15/minute is well past two captains sorting out a
  -- ground and well short of a usable spam channel.
  select count(*) into v_recent
    from public.captain_chat_messages c
   where c.sender_id = v_uid
     and c.created_at > now() - interval '1 minute';
  if v_recent >= 15 then
    raise exception 'RATE_LIMITED' using errcode = '53400';
  end if;

  insert into public.captain_chat_messages
    (challenge_id, match_id, sender_id, recipient_id, content)
  values
    (in_challenge_id, in_match_id, v_uid, v_other, v_content)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_captain_chat -- one pair's thread, never the whole challenge.
-- ---------------------------------------------------------------------------

create or replace function public.get_captain_chat(
  in_match_id      uuid,
  in_challenge_id  uuid,
  in_to_team_id    uuid,
  in_other_user_id uuid
)
returns table (
  id               uuid,
  challenge_id     uuid,
  match_id         uuid,
  sender_id        uuid,
  recipient_id     uuid,
  content          text,
  is_read          boolean,
  created_at       timestamptz,
  sender_name      text,
  sender_avatar    text,
  counterpart_id   uuid,
  counterpart_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_other uuid;
  v_ch    uuid := in_challenge_id;
begin
  v_other := public._resolve_chat_counterpart(
    in_match_id, in_challenge_id, in_to_team_id, in_other_user_id
  );

  -- A fixture born from a challenge keeps its pre-match history.
  -- finalise_challenge back-links the rows that existed when the fixture was
  -- created; pull the challenge in either way so nothing is stranded.
  if in_match_id is not null and v_ch is null then
    select m.challenge_id into v_ch from public.matches m where m.id = in_match_id;
  end if;

  return query
  select c.id, c.challenge_id, c.match_id, c.sender_id, c.recipient_id,
         c.content, c.is_read, c.created_at,
         p.full_name, p.avatar_url,
         v_other, o.full_name
    from public.captain_chat_messages c
    join public.profiles p on p.id = c.sender_id
    join public.profiles o on o.id = v_other
   where (
           (c.sender_id = v_uid   and c.recipient_id = v_other)
        or (c.sender_id = v_other and c.recipient_id = v_uid)
         )
     and (
           (in_match_id is not null and c.match_id = in_match_id)
        or (v_ch is not null        and c.challenge_id = v_ch)
         )
   order by c.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. mark_chat_read -- replaces the UPDATE privilege. Scoped to the same pair,
--    and it covers challenge rows, which the client's markAsRead never did.
-- ---------------------------------------------------------------------------

create or replace function public.mark_chat_read(
  in_match_id      uuid,
  in_challenge_id  uuid,
  in_to_team_id    uuid,
  in_other_user_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_other uuid;
  v_ch    uuid := in_challenge_id;
  v_n     integer;
begin
  v_other := public._resolve_chat_counterpart(
    in_match_id, in_challenge_id, in_to_team_id, in_other_user_id
  );

  if in_match_id is not null and v_ch is null then
    select m.challenge_id into v_ch from public.matches m where m.id = in_match_id;
  end if;

  update public.captain_chat_messages c
     set is_read = true
   where c.recipient_id = v_uid
     and c.sender_id    = v_other
     and c.is_read      = false
     and (
           (in_match_id is not null and c.match_id = in_match_id)
        or (v_ch is not null        and c.challenge_id = v_ch)
         );

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Lock the table down.
-- ---------------------------------------------------------------------------

revoke all on function public.send_captain_message(uuid, uuid, uuid, uuid, text) from public, anon;
revoke all on function public.get_captain_chat(uuid, uuid, uuid, uuid)            from public, anon;
revoke all on function public.mark_chat_read(uuid, uuid, uuid, uuid)              from public, anon;

grant execute on function public.send_captain_message(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.get_captain_chat(uuid, uuid, uuid, uuid)            to authenticated;
grant execute on function public.mark_chat_read(uuid, uuid, uuid, uuid)              to authenticated;

-- Nothing legitimate writes this table directly any more. Dropping the two
-- policies as well as the privileges means a future `grant` cannot silently
-- reopen the hole -- with RLS on and no policy for a command, that command is
-- denied. The RPCs above are SECURITY DEFINER owned by the table owner, so
-- they are unaffected.
drop policy if exists "captain_chat_insert" on public.captain_chat_messages;
drop policy if exists "captain_chat_update" on public.captain_chat_messages;

revoke insert, update, delete on public.captain_chat_messages from anon, authenticated;

-- captain_chat_select is unchanged and still correct: sender or recipient
-- only, block-aware. Realtime needs it.
