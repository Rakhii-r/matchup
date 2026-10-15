-- 1. ALL OUT ---------------------------------------------------------------
-- Wickets were counted by sync_innings_totals all along, but nothing ever
-- ended an innings on them: only overs-exhausted and target-reached, and only
-- for innings 2. A side could lose every wicket and keep batting.
--
-- Real cricket: the last batter has no partner, so N a side is all out at
-- N-1 wickets. N comes from total_slots / 2 -- the create wizard always sets
-- total_slots as players-per-side x 2.
create or replace function public.wickets_to_end_innings(in_match_id uuid)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  -- greatest(...,1) so a malformed 1-or-2-slot game still ends on one wicket
  -- instead of returning 0 and closing the innings before a ball is bowled.
  select greatest((m.total_slots / 2) - 1, 1)
    from public.matches m
   where m.id = in_match_id;
$function$;

revoke execute on function public.wickets_to_end_innings(uuid) from anon;

create or replace function public.record_delivery(
  in_innings_id uuid, in_striker_id uuid, in_non_striker_id uuid, in_bowler_id uuid,
  in_runs_off_bat smallint default 0, in_extra_type text default null,
  in_extra_runs smallint default 0, in_wicket_type text default null,
  in_out_player_id uuid default null
)
returns deliveries
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_i public.innings%rowtype; v_m public.matches%rowtype; v_row public.deliveries%rowtype;
  v_seq integer; v_legal boolean; v_over integer; v_ball smallint;
  v_all_out integer; v_done boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;

  select * into v_i from public.innings where id = in_innings_id for update;
  if not found then raise exception 'INNINGS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_i.status <> 'in_progress' then raise exception 'INNINGS_ENDED' using errcode = '23514'; end if;

  select * into v_m from public.matches where id = v_i.match_id;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  if in_striker_id = in_non_striker_id then
    raise exception 'SAME_BATTER_BOTH_ENDS' using errcode = '23514';
  end if;

  v_legal := in_extra_type is null or in_extra_type in ('bye', 'leg_bye');
  v_over := v_i.legal_balls / 6;
  v_ball := (v_i.legal_balls % 6) + 1;

  if v_m.overs is not null and v_legal and v_i.legal_balls >= v_m.overs * 6 then
    raise exception 'OVERS_EXHAUSTED' using errcode = '23514';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from public.deliveries where innings_id = in_innings_id;

  insert into public.deliveries (
    innings_id, seq, over_number, ball_in_over,
    striker_id, non_striker_id, bowler_id,
    runs_off_bat, extra_type, extra_runs, wicket_type, out_player_id
  ) values (
    in_innings_id, v_seq, v_over, v_ball,
    in_striker_id, in_non_striker_id, in_bowler_id,
    coalesce(in_runs_off_bat, 0), in_extra_type, coalesce(in_extra_runs, 0),
    in_wicket_type, in_out_player_id
  ) returning * into v_row;

  -- Re-read: the AFTER INSERT trigger has already recomputed runs/wickets/balls.
  select * into v_i from public.innings where id = in_innings_id;
  v_all_out := public.wickets_to_end_innings(v_i.match_id);

  -- All out closes EITHER innings. Overs and target still only close the
  -- second -- the first is deliberately ended by hand, because the sides swap
  -- and the scorer confirms it.
  v_done := v_i.wickets >= v_all_out;

  if v_i.number = 2 then
    v_done := v_done
      or (v_i.target is not null and v_i.runs >= v_i.target)
      or (v_m.overs is not null and v_i.legal_balls >= v_m.overs * 6);
  end if;

  if v_done then
    update public.innings
       set status = 'completed', ended_at = now()
     where id = in_innings_id;

    if v_i.number = 2 then
      perform public.finish_match(v_i.match_id, null);
    end if;
  end if;

  return v_row;
end;
$function$;

-- 2. DELETE A GAME ----------------------------------------------------------
-- There was no delete path at all. A hard delete is allowed only while the
-- organiser is the sole person on the sheet: once anyone else has joined,
-- removing the row would strand them with no record and no explanation, and
-- cancelling is the honest action instead.
create or replace function public.delete_match(in_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_m   public.matches%rowtype;
  v_others integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_m.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  if v_m.status in ('completed', 'expired') then
    raise exception 'MATCH_ALREADY_PLAYED' using errcode = '23514';
  end if;

  select count(*) into v_others
    from public.match_players mp
   where mp.match_id = in_match_id
     and mp.user_id <> v_uid;

  if v_others > 0 then
    raise exception 'MATCH_HAS_PLAYERS' using errcode = '23514';
  end if;

  if exists (select 1 from public.innings i where i.match_id = in_match_id) then
    raise exception 'MATCH_ALREADY_PLAYED' using errcode = '23514';
  end if;

  -- The organiser's own seat has no FK cascade from matches, so it goes first.
  delete from public.match_players where match_id = in_match_id;
  delete from public.matches where id = in_match_id;
end;
$function$;

revoke execute on function public.delete_match(uuid) from anon;
