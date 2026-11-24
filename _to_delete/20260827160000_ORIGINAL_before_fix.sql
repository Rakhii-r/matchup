-- ============================================================================
-- Captain-to-Captain Match Chat & Venue Coordination
--
-- 1. Creates `captain_chat_messages` for direct pre-match and post-match
--    coordination between opposing team captains.
-- 2. Enables Supabase Realtime & RLS security on chat messages.
-- 3. Adds automatic push notification enqueueing for new chat messages.
-- 4. Updates `finalise_challenge` so pre-match challenge messages automatically
--    attach their new `match_id`.
-- 5. Updates `set_match_venue` so either team captain or creator can attach/update venue.
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
    new.content,
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

-- 4. Update finalise_challenge to preserve chat history by linking match_id
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
  v_c     public.team_challenges%rowtype;
  v_to    public.teams%rowtype;
  v_venue public.venues%rowtype;
  v_match public.matches%rowtype;
  v_code  text;
  v_try   int;
  v_lat   double precision;
  v_lng   double precision;
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

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, sport, venue_id, venue_text, area_name, scheduled_at,
        total_slots, missing_count, share_code, lat, lng, match_lat, match_lng, match_name, notes,
        team_a_id, team_b_id, challenge_id
      )
      values (
        v_c.created_by, v_to.sport, v_venue.id, coalesce(v_venue.name, v_c.area_name, 'Local Ground'), coalesce(v_c.area_name, 'Local Area'), v_c.scheduled_at,
        v_c.total_slots, 0, v_code, v_lat, v_lng, v_lat, v_lng, v_c.match_name, v_c.message,
        v_c.from_team_id, in_to_team_id, v_c.id
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

-- 5. Update set_match_venue to permit both team captains or match creator
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
  v_uid        uuid := (select auth.uid());
  v_match      public.matches%rowtype;
  v_venue      public.venues%rowtype;
  v_is_captain boolean := false;
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

  -- Authorize: creator, or owner of team_a, or owner of team_b
  v_is_captain := (
    v_match.creator_id = v_uid or
    exists (
      select 1 from public.teams t
      where t.id in (v_match.team_a_id, v_match.team_b_id) and t.owner_id = v_uid
    )
  );

  if not v_is_captain then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_match.status not in ('open', 'locked') then
    raise exception 'MATCH_ALREADY_STARTED' using errcode = '23514';
  end if;

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
