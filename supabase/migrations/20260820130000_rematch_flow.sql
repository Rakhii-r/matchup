-- ============================================================================
-- Rematch / Play Again Flow & Open Match Toss/Scoring
--
-- Enables restarting a match within the same booked time slot (rematch_of)
-- and allows open matches to participate in toss and ball-by-ball scoring.
-- ============================================================================

-- 1. Add rematch_of column to track rematch hierarchy
alter table public.matches
  add column if not exists rematch_of uuid references public.matches(id) on delete set null;

create index if not exists matches_rematch_of_idx on public.matches(rematch_of);

-- 2. Update is_match_captain to include match creator
create or replace function public.is_match_captain(p_match_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.matches m
      left join public.teams t on t.id in (m.team_a_id, m.team_b_id)
     where m.id = p_match_id
       and (t.owner_id = p_uid or m.creator_id = p_uid)
  );
$fn$;

revoke execute on function public.is_match_captain(uuid, uuid) from anon, public;
grant  execute on function public.is_match_captain(uuid, uuid) to authenticated;

-- 3. Update perform_toss to support open matches by generating sides/teams if null
create or replace function public.perform_toss(
  in_match_id uuid,
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_m       public.matches%rowtype;
  v_row     public.match_toss%rowtype;
  v_winner  uuid;
  v_heads   boolean;
  v_cap     record;
  v_team_a  uuid;
  v_team_b  uuid;
  v_player  record;
  v_idx     integer := 0;
  v_half    integer;
  v_total_p integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  -- Lock the match so two captains tapping "Flip" at once cannot both insert.
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  if not (public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  -- If match is an open match or has no teams assigned, create casual team shells and split players
  if v_m.team_a_id is null or v_m.team_b_id is null then
    insert into public.teams (name, sport, owner_id, area_name)
    values (coalesce(v_m.match_name, 'Match') || ' · Side A', v_m.sport, v_m.creator_id, v_m.area_name)
    returning id into v_team_a;

    insert into public.teams (name, sport, owner_id, area_name)
    values (coalesce(v_m.match_name, 'Match') || ' · Side B', v_m.sport, v_m.creator_id, v_m.area_name)
    returning id into v_team_b;

    update public.matches
       set team_a_id = v_team_a,
           team_b_id = v_team_b
     where id = in_match_id;

    v_m.team_a_id := v_team_a;
    v_m.team_b_id := v_team_b;

    -- Assign players to side A and side B evenly
    select count(*) into v_total_p from public.match_players where match_id = in_match_id;
    v_half := ceil(v_total_p::numeric / 2.0);

    for v_player in (select id from public.match_players where match_id = in_match_id order by created_at asc) loop
      v_idx := v_idx + 1;
      if v_idx <= v_half then
        update public.match_players
           set team_id = v_team_a, side = 'a'
         where id = v_player.id;
      else
        update public.match_players
           set team_id = v_team_b, side = 'b'
         where id = v_player.id;
      end if;
    end loop;
  end if;

  -- Idempotent: a second tap returns the existing toss rather than re-rolling.
  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  v_heads  := (random() < 0.5);
  v_winner := case when v_heads then v_m.team_a_id else v_m.team_b_id end;

  insert into public.match_toss (match_id, called_by, winner_team_id, outcome)
  values (in_match_id, v_uid, v_winner, case when v_heads then 'heads' else 'tails' end)
  returning * into v_row;

  -- Tell both captains/creator
  for v_cap in
    select t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      case when v_cap.won then 'You won the toss' else 'Toss done' end,
      case when v_cap.won
           then 'Choose to bat or bowl.'
           else 'The other captain is choosing bat or bowl.' end,
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.perform_toss(uuid, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, integer) to authenticated;

-- 4. Update set_toss_decision to allow match creator or winning team owner
create or replace function public.set_toss_decision(
  in_match_id uuid,
  in_decision text
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := (select auth.uid());
  v_row   public.match_toss%rowtype;
  v_team  public.teams%rowtype;
  v_m     public.matches%rowtype;
  v_other uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if in_decision not in ('bat', 'bowl') then
    raise exception 'INVALID_DECISION' using errcode = '23514';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_DONE' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'DECISION_ALREADY_MADE' using errcode = '23514';
  end if;

  select * into v_m from public.matches where id = in_match_id;
  select * into v_team from public.teams where id = v_row.winner_team_id;

  if v_team.owner_id <> v_uid and v_m.creator_id <> v_uid then
    raise exception 'NOT_TOSS_WINNER' using errcode = '42501';
  end if;

  update public.match_toss
     set decision = in_decision, decided_at = now()
   where match_id = in_match_id
   returning * into v_row;

  select t.owner_id into v_other
    from public.teams t
   where t.id in (v_m.team_a_id, v_m.team_b_id)
     and t.id <> v_row.winner_team_id;

  if v_other is not null and v_other <> v_uid then
    perform public.enqueue_notification(
      v_other,
      'toss_done',
      'Toss decided',
      v_team.name || ' chose to ' || in_decision || ' first.',
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end if;

  return v_row;
end;
$fn$;

revoke execute on function public.set_toss_decision(uuid, text) from anon, public;
grant  execute on function public.set_toss_decision(uuid, text) to authenticated;

-- 5. create_rematch RPC
create or replace function public.create_rematch(in_match_id uuid)
returns public.matches
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := (select auth.uid());
  v_orig      public.matches%rowtype;
  v_new       public.matches%rowtype;
  v_now       timestamptz := now();
  v_code      text;
  v_count     integer;
  v_game_num  integer;
  v_new_name  text;
  v_base_name text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_orig from public.matches where id = in_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Only organiser or match captain/player can trigger rematch
  if not (v_orig.creator_id = v_uid or public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_ALLOWED_TO_REMATCH' using errcode = '42501';
  end if;

  -- Match must be completed
  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  -- Slot end time must be defined and in the future
  if v_orig.end_time is null or v_orig.end_time <= v_now then
    raise exception 'SLOT_EXPIRED' using errcode = '23514';
  end if;

  -- Determine Game number
  select count(*) into v_count
    from public.matches
   where id = in_match_id
      or rematch_of = in_match_id
      or id = v_orig.rematch_of
      or rematch_of = v_orig.rematch_of;

  v_game_num := v_count + 1;
  v_base_name := regexp_replace(v_orig.match_name, '\s*\(Game\s*\d+\)$', '', 'i');
  v_new_name := v_base_name || ' (Game ' || v_game_num || ')';

  -- Generate unique share code
  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id,
        match_name,
        sport,
        game_type,
        match_type,
        area_name,
        lat,
        lng,
        match_lat,
        match_lng,
        venue_id,
        venue_text,
        search_radius_m,
        scheduled_at,
        end_time,
        total_slots,
        filled_slots,
        missing_count,
        status,
        share_code,
        team_a_id,
        team_b_id,
        rematch_of,
        notes
      )
      values (
        v_uid,
        v_new_name,
        v_orig.sport,
        v_orig.game_type,
        v_orig.match_type,
        v_orig.area_name,
        v_orig.lat,
        v_orig.lng,
        v_orig.match_lat,
        v_orig.match_lng,
        v_orig.venue_id,
        v_orig.venue_text,
        v_orig.search_radius_m,
        v_now,
        v_orig.end_time,
        v_orig.total_slots,
        v_orig.filled_slots,
        0,
        'locked',
        v_code,
        v_orig.team_a_id,
        v_orig.team_b_id,
        coalesce(v_orig.rematch_of, v_orig.id),
        coalesce(v_orig.notes, 'Rematch')
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  -- Copy over confirmed players from previous match
  insert into public.match_players (
    match_id,
    user_id,
    team_id,
    side,
    status,
    role,
    joined_via
  )
  select
    v_new.id,
    mp.user_id,
    mp.team_id,
    mp.side,
    'confirmed',
    mp.role,
    mp.joined_via
  from public.match_players mp
  where mp.match_id = in_match_id
    and mp.status = 'confirmed'
  on conflict (match_id, user_id) do nothing;

  -- Update filled slots to match actual confirmed roster count
  update public.matches
     set filled_slots = (select count(*) from public.match_players where match_id = v_new.id and status = 'confirmed')
   where id = v_new.id
  returning * into v_new;

  return v_new;
end;
$fn$;

revoke execute on function public.create_rematch(uuid) from anon, public;
grant  execute on function public.create_rematch(uuid) to authenticated;
