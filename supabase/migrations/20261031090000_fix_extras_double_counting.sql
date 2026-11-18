-- A wide or no-ball with runs scored them twice.
--
-- sync_innings_totals adds runs_off_bat + extra_runs, but the keypad sends the
-- runs in both: a no-ball hit for six arrives as bat 6, extra 7 and scored 13
-- instead of 7. A wide run for four arrives as bat 4, extra 5 and scored 9
-- instead of 5.
--
-- Fixed here rather than in the app, so every installed version is corrected at
-- once, including the build in store review. Both shapes come out the same, so
-- an app that later sends the correct values is unaffected:
--   wide:    nothing is off the bat; everything is extras  -> bat 0, extra 1+runs
--   no-ball: runs off the bat stay there; the penalty is 1 -> bat n, extra 1
--
-- Rows already recorded are NOT changed: correcting one would change the result
-- of a finished match.
create or replace function public.record_delivery(in_innings_id uuid, in_striker_id uuid, in_non_striker_id uuid, in_bowler_id uuid, in_runs_off_bat smallint DEFAULT 0, in_extra_type text DEFAULT NULL::text, in_extra_runs smallint DEFAULT 0, in_wicket_type text DEFAULT NULL::text, in_out_player_id uuid DEFAULT NULL::uuid)
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
  v_bat smallint := coalesce(in_runs_off_bat, 0);
  v_extra smallint := coalesce(in_extra_runs, 0);
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

  -- Totals are bat + extra, so a run must be in exactly one of them.
  if in_extra_type = 'wide' then
    v_extra := greatest(v_extra, 1 + v_bat);
    v_bat := 0;
  elsif in_extra_type = 'no_ball' then
    v_extra := greatest(v_extra - v_bat, 1);
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
    v_bat, in_extra_type, v_extra,
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

-- The no-ball chip reads the bat runs now, since extra_runs is always 1 on new
-- rows: "nb6" for a six off a no-ball. Older rows (bat 2, extra 3) still read "nb2".
create or replace function public.get_this_over(in_innings_id uuid)
returns table(seq integer, over_number integer, ball_in_over smallint, runs_off_bat smallint,
              extra_type text, extra_runs smallint, wicket_type text, label text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with cur as (
    select coalesce(max(over_number), 0) as o
      from public.deliveries where innings_id = in_innings_id
  )
  select d.seq, d.over_number, d.ball_in_over,
         d.runs_off_bat, d.extra_type, d.extra_runs, d.wicket_type,
         -- One human-readable chip per ball, built server-side so every client
         -- renders the same thing.
         case
           when d.wicket_type is not null then 'W'
           when d.extra_type = 'wide'     then 'wd' || coalesce(nullif(d.extra_runs - 1, 0)::text, '')
           when d.extra_type = 'no_ball'  then 'nb' || coalesce(nullif(d.runs_off_bat, 0)::text, '')
           when d.extra_type = 'bye'      then d.extra_runs::text || 'b'
           when d.extra_type = 'leg_bye'  then d.extra_runs::text || 'lb'
           else d.runs_off_bat::text
         end
    from public.deliveries d, cur
   where d.innings_id = in_innings_id
     and d.over_number = cur.o
     and exists (
       select 1 from public.innings i
        where i.id = in_innings_id
          and (
            public.is_match_creator(i.match_id, (select auth.uid()))
            or public.is_match_player(i.match_id, (select auth.uid()))
          )
     )
   order by d.seq asc;
$function$;
