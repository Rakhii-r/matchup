-- ============================================================================
-- Toss: Captain Heads/Tails Call Selection & Winner Decision Logic
-- ============================================================================

-- 1. Add called_face and calling_team_id to public.match_toss if not exists
alter table public.match_toss
  add column if not exists called_face text check (called_face is null or called_face in ('heads', 'tails')),
  add column if not exists calling_team_id uuid references public.teams (id) on delete set null;

-- 2. perform_toss with in_call parameter
drop function if exists public.perform_toss(uuid, integer);
drop function if exists public.perform_toss(uuid, text, integer);

create or replace function public.perform_toss(
  in_match_id uuid,
  in_call     text default 'heads',
  in_overs    integer default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid            uuid := (select auth.uid());
  v_m              public.matches%rowtype;
  v_row            public.match_toss%rowtype;
  v_winner         uuid;
  v_outcome        text;
  v_call           text := lower(coalesce(in_call, 'heads'));
  v_calling_team   uuid;
  v_other_team     uuid;
  v_cap            record;
  v_team_a         uuid;
  v_team_b         uuid;
  v_player         record;
  v_idx            integer := 0;
  v_half           integer;
  v_total_p        integer;
  v_base           text;
  v_try            integer;
  v_p_team         uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if v_call not in ('heads', 'tails') then
    v_call := 'heads';
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

  -- If open match with no squads, create casual shells
  if v_m.team_a_id is null or v_m.team_b_id is null then
    v_base := left(trim(coalesce(nullif(trim(v_m.match_name), ''), 'Match')), 50 - char_length(' · Side A'));

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code)
        values (v_base || ' · Side A', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code())
        returning id into v_team_a;
        exit;
      exception when unique_violation then
        if v_try = 5 then raise; end if;
      end;
    end loop;

    for v_try in 1..5 loop
      begin
        insert into public.teams (name, sport, owner_id, home_ground, invite_code)
        values (v_base || ' · Side B', v_m.sport, v_m.creator_id, left(v_m.area_name, 120), public.gen_share_code())
        returning id into v_team_b;
        exit;
      exception when unique_violation then
        if v_try = 5 then raise; end if;
      end;
    end loop;

    update public.matches
       set team_a_id = v_team_a,
           team_b_id = v_team_b
     where id = in_match_id;

    v_m.team_a_id := v_team_a;
    v_m.team_b_id := v_team_b;

    select count(*) into v_total_p from public.match_players where match_id = in_match_id;
    v_half := ceil(v_total_p::numeric / 2.0);

    for v_player in (select id from public.match_players where match_id = in_match_id order by created_at asc) loop
      v_idx := v_idx + 1;
      if v_idx <= v_half then
        update public.match_players set team_id = v_team_a where id = v_player.id;
      else
        update public.match_players set team_id = v_team_b where id = v_player.id;
      end if;
    end loop;
  end if;

  -- Idempotent check
  select * into v_row from public.match_toss where match_id = in_match_id;
  if found then
    return v_row;
  end if;

  if in_overs is not null then
    update public.matches set overs = in_overs where id = in_match_id;
  end if;

  -- Determine which team is calling
  select mp.team_id into v_p_team
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id = v_uid
   limit 1;

  if v_p_team is not null and v_p_team = v_m.team_b_id then
    v_calling_team := v_m.team_b_id;
    v_other_team   := v_m.team_a_id;
  else
    -- Default to Team A or caller's team
    v_calling_team := coalesce(v_m.team_a_id, v_p_team);
    v_other_team   := case when v_calling_team = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  end if;

  -- Server-side random coin flip
  v_outcome := case when (random() < 0.5) then 'heads' else 'tails' end;

  -- Winner logic based on whether outcome matches caller's call
  if v_outcome = v_call then
    v_winner := v_calling_team;
  else
    v_winner := v_other_team;
  end if;

  insert into public.match_toss (
    match_id,
    called_by,
    calling_team_id,
    called_face,
    winner_team_id,
    outcome
  )
  values (
    in_match_id,
    v_uid,
    v_calling_team,
    v_call,
    v_winner,
    v_outcome
  )
  returning * into v_row;

  -- Notifications
  for v_cap in
    select distinct on (t.owner_id) t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
     order by t.owner_id, (t.id = v_winner) desc
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

revoke execute on function public.perform_toss(uuid, text, integer) from anon, public;
grant  execute on function public.perform_toss(uuid, text, integer) to authenticated;

-- 3. redo_toss with optional in_call parameter
drop function if exists public.redo_toss(uuid);
drop function if exists public.redo_toss(uuid, text);

create or replace function public.redo_toss(
  in_match_id uuid,
  in_call     text default null
)
returns public.match_toss
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_uid          uuid := (select auth.uid());
  v_m            public.matches%rowtype;
  v_row          public.match_toss%rowtype;
  v_winner       uuid;
  v_outcome      text;
  v_call         text;
  v_calling_team uuid;
  v_other_team   uuid;
  v_cap          record;
  v_p_team       uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_match_captain(in_match_id, v_uid) or public.is_match_player(in_match_id, v_uid)) then
    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'TOSS_ALREADY_DECIDED' using errcode = '23514';
  end if;

  v_call := lower(coalesce(in_call, v_row.called_face, 'heads'));
  if v_call not in ('heads', 'tails') then
    v_call := 'heads';
  end if;

  -- Determine calling team
  select mp.team_id into v_p_team
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id = v_uid
   limit 1;

  if v_p_team is not null and v_p_team = v_m.team_b_id then
    v_calling_team := v_m.team_b_id;
    v_other_team   := v_m.team_a_id;
  else
    v_calling_team := coalesce(v_row.calling_team_id, v_m.team_a_id);
    v_other_team   := case when v_calling_team = v_m.team_a_id then v_m.team_b_id else v_m.team_a_id end;
  end if;

  v_outcome := case when (random() < 0.5) then 'heads' else 'tails' end;

  if v_outcome = v_call then
    v_winner := v_calling_team;
  else
    v_winner := v_other_team;
  end if;

  update public.match_toss
     set called_by       = v_uid,
         calling_team_id = v_calling_team,
         called_face     = v_call,
         winner_team_id  = v_winner,
         outcome         = v_outcome,
         created_at      = now()
   where match_id = in_match_id
  returning * into v_row;

  for v_cap in
    select distinct on (t.owner_id) t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
     order by t.owner_id, (t.id = v_winner) desc
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      case when v_cap.won then 'Toss re-flipped: You won' else 'Toss re-flipped' end,
      case when v_cap.won
           then 'Choose to bat or bowl.'
           else 'The other captain is choosing bat or bowl.' end,
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$fn$;

revoke execute on function public.redo_toss(uuid, text) from anon, public;
grant  execute on function public.redo_toss(uuid, text) to authenticated;

-- 4. get_toss updated with call metadata
drop function if exists public.get_toss(uuid);

create or replace function public.get_toss(in_match_id uuid)
returns table (
  match_id          uuid,
  winner_team_id    uuid,
  winner_team_name  text,
  outcome           text,
  called_face       text,
  calling_team_id   uuid,
  calling_team_name text,
  decision          text,
  overs             integer,
  batting_team_id   uuid,
  bowling_team_id   uuid,
  i_am_captain      boolean,
  i_am_winner       boolean,
  i_am_caller       boolean,
  created_at        timestamptz,
  decided_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select mt.match_id,
         mt.winner_team_id,
         w.name as winner_team_name,
         mt.outcome,
         mt.called_face,
         mt.calling_team_id,
         ct.name as calling_team_name,
         mt.decision,
         m.overs,
         case when mt.decision is null then null
              when mt.decision = 'bat' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end as batting_team_id,
         case when mt.decision is null then null
              when mt.decision = 'bowl' then mt.winner_team_id
              else case when mt.winner_team_id = m.team_a_id then m.team_b_id else m.team_a_id end
         end as bowling_team_id,
         public.is_match_captain(mt.match_id, (select auth.uid())),
         (w.owner_id = (select auth.uid()) or m.creator_id = (select auth.uid())),
         (mt.called_by = (select auth.uid())),
         mt.created_at,
         mt.decided_at
    from public.match_toss mt
    join public.matches m on m.id = mt.match_id
    join public.teams   w on w.id = mt.winner_team_id
    left join public.teams ct on ct.id = mt.calling_team_id
   where mt.match_id = in_match_id
     and (
       public.is_match_creator(in_match_id, (select auth.uid()))
       or public.is_match_player(in_match_id, (select auth.uid()))
     );
$fn$;

revoke execute on function public.get_toss(uuid) from anon, public;
grant  execute on function public.get_toss(uuid) to authenticated;
