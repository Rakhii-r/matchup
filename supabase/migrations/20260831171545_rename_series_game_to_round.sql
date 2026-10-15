-- The UI vocabulary changed: a "game" is now what used to be called a match,
-- and the Nth game inside one booked slot is a "round". create_rematch is the
-- only place the server generates that user-visible text, so it moves too.
--
-- The strip regex accepts BOTH the old "(Game N)" and the new "(Round N)"
-- suffix. Existing rows are named "... (Game 2)"; without the old alternative
-- the next rematch would append and produce "... (Game 2) (Round 3)".
create or replace function public.create_rematch(in_match_id uuid)
returns matches
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := (select auth.uid());
  v_orig      public.matches%rowtype;
  v_new       public.matches%rowtype;
  v_open      public.matches%rowtype;
  v_now       timestamptz := now();
  v_root      uuid;
  v_code      text;
  v_try       integer;
  v_count     integer;
  v_game_num  integer;
  v_suffix    text;
  v_new_name  text;
  v_base_name text;
  v_player    record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_orig from public.matches where id = in_match_id;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Was organiser OR captain OR any player.
  if v_orig.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_orig.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;

  v_root := coalesce(v_orig.rematch_of, v_orig.id);

  perform pg_advisory_xact_lock(hashtextextended(v_root::text, 0));

  if v_orig.end_time is not null and v_orig.end_time <= v_now then
    raise exception 'SLOT_EXPIRED' using errcode = '23514';
  end if;

  select * into v_open
    from public.matches
   where (id = v_root or rematch_of = v_root)
     and status in ('open', 'locked')
   order by created_at desc
   limit 1;
  if found then
    return v_open;
  end if;

  select count(*) into v_count
    from public.matches
   where id = v_root or rematch_of = v_root;

  v_game_num := v_count + 1;

  v_base_name := regexp_replace(
    coalesce(v_orig.match_name, 'Game'),
    '\s*(\((Game|Round)\s*\d+\)|·\s*(Game|Round)\s*\d+)\s*$', '', 'i');
  v_base_name := trim(v_base_name);
  if v_base_name = '' then
    v_base_name := 'Game';
  end if;

  v_suffix := ' (Round ' || v_game_num || ')';
  v_new_name := left(v_base_name, 80 - char_length(v_suffix)) || v_suffix;

  for v_try in 1..5 loop
    begin
      v_code := public.gen_share_code();
      insert into public.matches (
        creator_id, match_name, sport, game_type, match_type, area_name,
        lat, lng, match_lat, match_lng, venue_id, venue_text, search_radius_m,
        scheduled_at, end_time, total_slots, filled_slots, missing_count,
        status, share_code, team_a_id, team_b_id, rematch_of, overs, notes
      )
      values (
        v_uid, v_new_name, v_orig.sport, v_orig.game_type, v_orig.match_type,
        v_orig.area_name, v_orig.lat, v_orig.lng, v_orig.match_lat, v_orig.match_lng,
        v_orig.venue_id, v_orig.venue_text, v_orig.search_radius_m,
        v_now, v_orig.end_time, v_orig.total_slots, 0, 0,
        'locked', v_code, v_orig.team_a_id, v_orig.team_b_id,
        v_root, v_orig.overs, coalesce(v_orig.notes, 'Next round in this slot')
      )
      returning * into v_new;
      exit;
    exception when unique_violation then
      if v_try = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (
    match_id, user_id, team_id, status, role, joined_via
  )
  select v_new.id, mp.user_id, mp.team_id, 'confirmed', mp.role, mp.joined_via
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.status = 'confirmed'
  on conflict (match_id, user_id) do nothing;

  update public.matches
     set filled_slots = (
           select count(*) from public.match_players
            where match_id = v_new.id and status = 'confirmed'
         )
   where id = v_new.id
  returning * into v_new;

  for v_player in
    select distinct mp.user_id
      from public.match_players mp
     where mp.match_id = v_new.id
       and mp.status = 'confirmed'
       and mp.user_id <> v_uid
  loop
    perform public.enqueue_notification(
      v_player.user_id,
      'next_game_started',
      'Round ' || v_game_num || ' is starting now',
      'Same teams, same ground. Tap to follow the score.',
      jsonb_build_object('route', '/match/' || v_new.id::text || '/toss', 'match_id', v_new.id)
    );
  end loop;

  return v_new;
end;
$function$;
