-- ============================================================================
-- Captain-to-Captain Match Chat & Venue Coordination
--
-- 1. Creates `captain_chat_messages` for direct pre-match and post-match
--    coordination between opposing team captains.
-- 2. Enables Supabase Realtime & RLS security on chat messages.
-- 3. Adds automatic push notification enqueueing for new chat messages.
-- 4. Updates `finalise_challenge` so pre-match challenge messages automatically
--    attach their new `match_id`.
--
-- ---------------------------------------------------------------------------
-- REVIEWED AND CORRECTED 27 Aug 2026 before first application. Three changes
-- against the original draft (kept at _to_delete/20260827160000_ORIGINAL_before_fix.sql):
--
--   a) `finalise_challenge` was rebuilt from a PRE-25-Aug copy. Its insert
--      dropped `end_time`, `game_type`, `search_radius_m`, `match_type` and the
--      `matches_end_after_start` stale-slot guard, all of which are live in
--      prod. Applying it would have re-introduced the null-end_time bug that
--      20260825120000_slot_multi_match exists to fix — every team-challenge
--      match would lose its slot cutoff and Play Again would never expire.
--      The body below is prod's current one with ONLY the chat-linking update
--      added.
--
--   b) `notification_jobs.body` is capped at 240 characters by
--      `notification_jobs_body_check`, but `captain_chat_messages.content`
--      allows 1000. The trigger passed the raw content through, so any message
--      over 240 chars would abort its own INSERT and be unsendable. Truncated.
--
--   c) The original also widened `set_match_venue` from creator-only to
--      creator-or-either-team-owner. Dropped: the owner's 26 Aug rule stands
--      (`matches.creator_id` is the only account that may act on a match) and
--      the client gates on `isCreator`, so widening the server alone would put
--      the two out of step. See 20260826120000_creator_only_toss_and_scoring.
-- ============================================================================

-- 1. Create captain_chat_messages table
create table if not exists public.captain_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.team_challenges(id) on delete cascade,
  match_id     uuid references public.matches(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  content      text not null check (char_length(trim(content)) between 1 and 1000),
  is_read      boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint challenge_or_match_required check (
    challenge_id is not null or match_id is not null
  )
);

create index if not exists idx_captain_chat_challenge on public.captain_chat_messages(challenge_id, created_at);
create index if not exists idx_captain_chat_match on public.captain_chat_messages(match_id, created_at);
create index if not exists idx_captain_chat_users on public.captain_chat_messages(sender_id, recipient_id);

-- 2. Enable RLS
alter table public.captain_chat_messages enable row level security;

drop policy if exists "captain_chat_select" on public.captain_chat_messages;
create policy "captain_chat_select" on public.captain_chat_messages
  for select to authenticated
  using (
    (auth.uid() in (sender_id, recipient_id))
    and not public.is_blocked_between(sender_id, recipient_id)
  );

drop policy if exists "captain_chat_insert" on public.captain_chat_messages;
create policy "captain_chat_insert" on public.captain_chat_messages
  for insert to authenticated
  with check (
    (auth.uid() = sender_id)
    and not public.is_blocked_between(sender_id, recipient_id)
  );

drop policy if exists "captain_chat_update" on public.captain_chat_messages;
create policy "captain_chat_update" on public.captain_chat_messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captain_chat_messages'
  ) then
    alter publication supabase_realtime add table public.captain_chat_messages;
  end if;
end;
$$;

-- 3. Push notification trigger on new message
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
    -- notification_jobs_body_check caps body at 240; content allows 1000. The
    -- trigger is AFTER INSERT, so an over-length body would abort the message
    -- itself rather than just the push.
    left(new.content, 240),
    jsonb_build_object(
      'route', '/chat/' || coalesce(new.match_id::text, new.challenge_id::text),
      'challengeId', new.challenge_id,
      'matchId', new.match_id,
      'senderId', new.sender_id
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_captain_chat_notify on public.captain_chat_messages;
create trigger trg_captain_chat_notify
  after insert on public.captain_chat_messages
  for each row execute function public.notify_captain_chat_message();

-- 4. finalise_challenge — prod's current body, plus chat linking.
--    Everything from `v_end`/`v_radius` down to `match_type` is load-bearing;
--    see the header note. Do not rebuild this from an older copy.
create or replace function public.finalise_challenge(
  in_challenge_id uuid,
  in_to_team_id   uuid
)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_c      public.team_challenges%rowtype;
  v_to     public.teams%rowtype;
  v_venue  public.venues%rowtype;
  v_match  public.matches%rowtype;
  v_code   text;
  v_try    int;
  v_lat    double precision;
  v_lng    double precision;
  v_end    timestamptz;
  v_radius integer;
begin
  if in_to_team_id is null then
    raise exception 'NO_OPPONENT' using errcode = '23514';
  end if;

  select * into v_c from public.team_challenges where id = in_challenge_id;
  if not found then
    raise exception 'CHALLENGE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if in_to_team_id = v_c.from_team_id then
    raise exception 'SELF_CHALLENGE' using errcode = '23514';
  end if;

  select * into v_to from public.teams where id = in_to_team_id;
  if not found then
    raise exception 'OPPONENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_c.venue_id is not null then
    select * into v_venue from public.venues where id = v_c.venue_id;
  end if;

  v_lat := coalesce(v_venue.lat, v_c.match_lat, (select st_y(tl::geometry) from public.team_location(v_c.from_team_id) tl), 18.5204);
  v_lng := coalesce(v_venue.lng, v_c.match_lng, (select st_x(tl::geometry) from public.team_location(v_c.from_team_id) tl), 73.8567);

  -- matches_end_after_start refuses an end_time that is not strictly after
  -- scheduled_at. A stale row that violates it must not abort the accept:
  -- losing the fixture is worse than losing the slot limit.
  v_end := v_c.end_time;
  if v_end is not null and v_end <= v_c.scheduled_at then
    v_end := null;
  end if;

  v_radius := v_c.search_radius_m;
  if v_radius is not null and (v_radius < 1000 or v_radius > 50000) then
    v_radius := null;
  end if;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id,
        end_time, game_type, search_radius_m, match_type
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name, 'Local Ground'), coalesce(v_c.area_name, 'Local Area'), v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id,
        v_end, coalesce(v_c.game_type, 'friendly'), v_radius, 'team_vs_team'
      )
      returning * into v_match;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Seat both team owners as captains
  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, owner_id, 'confirmed', 'browse', role
    from (
      select distinct on (t.owner_id)
             t.owner_id,
             case when t.id = v_c.from_team_id then 'creator' else 'opponent_captain' end as role
        from public.teams t
       where t.id in (v_c.from_team_id, in_to_team_id)
       order by t.owner_id, (t.id <> v_c.from_team_id)
    ) captains
  on conflict (match_id, user_id) do update set status = 'confirmed';

  -- Seat squad members as invited
  insert into public.match_players (match_id, user_id, status, joined_via, role)
  select v_match.id, tm.user_id, 'invited', 'browse', 'player'
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where tm.team_id in (v_c.from_team_id, in_to_team_id)
     and tm.user_id <> t.owner_id
  on conflict (match_id, user_id) do nothing;

  update public.team_challenges
     set match_id = v_match.id
   where id = v_c.id;

  -- Link any pre-match chat messages to this match
  update public.captain_chat_messages
     set match_id = v_match.id
   where challenge_id = v_c.id and match_id is null;

  return v_match;
end;
$$;
