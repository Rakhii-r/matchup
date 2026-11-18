-- finish_match never wrote winner_team_id, so every series tally read 0-0.
-- It also named the winner by the shell team's full name
-- ("<match name> · Side A") and never said "by N wickets" on a chase.
-- Applied to the live project on 13 Nov 2026.

create or replace function public.match_side_label(in_team_id uuid)
returns text
language sql
stable
set search_path to 'public'
as $$
  select case
           when t.is_match_side then coalesce(substring(t.name from '(Side [AB])\s*$'), t.name)
           else t.name
         end
    from public.teams t
   where t.id = in_team_id;
$$;

create or replace function public.finish_match(in_match_id uuid, in_motm_user_id uuid default null::uuid)
returns matches
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches%rowtype; v_i1 public.innings%rowtype; v_i2 public.innings%rowtype;
  v_txt text; v_a text; v_b text; v_winner uuid; v_squad integer; v_left integer;
begin
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_m.scorer_id is null or v_m.scorer_id <> v_uid then
    raise exception 'NOT_THE_SCORER' using errcode = '42501';
  end if;

  if in_motm_user_id is not null and not public.is_on_match_sheet(in_match_id, in_motm_user_id) then
    raise exception 'NOT_A_MATCH_PLAYER' using errcode = '23514';
  end if;

  select * into v_i1 from public.innings where match_id = in_match_id and number = 1;
  select * into v_i2 from public.innings where match_id = in_match_id and number = 2;
  if v_i2.id is null then raise exception 'SECOND_INNINGS_MISSING' using errcode = '23514'; end if;

  v_a := coalesce(public.match_side_label(v_i1.batting_team_id), 'Team A');
  v_b := coalesce(public.match_side_label(v_i2.batting_team_id), 'Team B');

  if v_i2.runs > v_i1.runs then
    v_winner := v_i2.batting_team_id;
    select count(*) into v_squad
      from public.match_players
     where match_id = in_match_id and team_id = v_i2.batting_team_id and status = 'confirmed';
    v_left := v_squad - 1 - coalesce(v_i2.wickets, 0);
    if v_squad > 1 and v_left > 0 then
      v_txt := v_b || ' won by ' || v_left || case when v_left = 1 then ' wicket' else ' wickets' end;
    else
      v_txt := v_b || ' won';
    end if;
  elsif v_i1.runs > v_i2.runs then
    v_winner := v_i1.batting_team_id;
    v_txt := v_a || ' won by ' || (v_i1.runs - v_i2.runs) || case when v_i1.runs - v_i2.runs = 1 then ' run' else ' runs' end;
  else
    v_winner := null;
    v_txt := 'Game tied';
  end if;

  update public.matches
     set status = 'completed', result_text = v_txt, winner_team_id = v_winner,
         motm_user_id = coalesce(in_motm_user_id, motm_user_id)
   where id = in_match_id returning * into v_m;
  return v_m;
end;
$function$;

-- Backfill: winner from the two innings on every completed match.
update public.matches m
   set winner_team_id = case
         when i2.runs > i1.runs then i2.batting_team_id
         when i1.runs > i2.runs then i1.batting_team_id
       end
  from public.innings i1, public.innings i2
 where m.status = 'completed'
   and m.winner_team_id is null
   and i1.match_id = m.id and i1.number = 1
   and i2.match_id = m.id and i2.number = 2;

-- Backfill: "<match name> · Side A won ..." -> "Side A won ...".
update public.matches
   set result_text = regexp_replace(result_text, '^.*·\s*(Side [AB]) won', '\1 won')
 where result_text ~ '·\s*Side [AB] won';
