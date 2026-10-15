-- Player of the Game could never be awarded: finish_match accepts
-- in_motm_user_id but the client always passed null, and because the second
-- innings auto-completes from record_delivery there is frequently no "Finish"
-- tap to hang a picker on. The award moves to the result screen behind its own
-- RPC. finish_match also never checked the id belonged to this game.

-- Deliberately NOT filtered on status='confirmed': under team-only scoring most
-- of a box-cricket sheet never reaches 'confirmed', and filtering on it is what
-- left the striker/bowler pickers permanently empty.
create or replace function public.is_on_match_sheet(p_match_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.match_players mp
     where mp.match_id = p_match_id and mp.user_id = p_uid
  );
$function$;
revoke execute on function public.is_on_match_sheet(uuid, uuid) from anon;

create or replace function public.set_motm(in_match_id uuid, in_user_id uuid default null)
returns matches language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_m   public.matches%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.creator_id <> v_uid and coalesce(v_m.scorer_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;
  if v_m.status <> 'completed' then
    raise exception 'MATCH_NOT_COMPLETED' using errcode = '23514';
  end if;
  if in_user_id is not null and not public.is_on_match_sheet(in_match_id, in_user_id) then
    raise exception 'NOT_A_MATCH_PLAYER' using errcode = '23514';
  end if;
  update public.matches set motm_user_id = in_user_id
   where id = in_match_id returning * into v_m;
  return v_m;
end;
$function$;
revoke execute on function public.set_motm(uuid, uuid) from anon;

create or replace function public.finish_match(in_match_id uuid, in_motm_user_id uuid default null)
returns matches language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_m public.matches%rowtype; v_i1 public.innings%rowtype; v_i2 public.innings%rowtype;
  v_txt text; v_a text; v_b text;
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
  select name into v_a from public.teams where id = v_i1.batting_team_id;
  select name into v_b from public.teams where id = v_i2.batting_team_id;
  if v_i2.runs > v_i1.runs then
    v_txt := v_b || ' won';
  elsif v_i1.runs > v_i2.runs then
    v_txt := v_a || ' won by ' || (v_i1.runs - v_i2.runs) || ' runs';
  else
    v_txt := 'Game tied';
  end if;
  update public.matches
     set status = 'completed', result_text = v_txt,
         motm_user_id = coalesce(in_motm_user_id, motm_user_id)
   where id = in_match_id returning * into v_m;
  return v_m;
end;
$function$;
