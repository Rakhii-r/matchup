-- Toss notices piled up: every flip and re-flip queued a fresh "choosing bat
-- or bowl" row, the organiser (who owns both shell sides of an open game) was
-- told about their own taps, and once the choice was made nobody heard it.
-- Now: flips never notify the person flipping, a re-flip replaces the earlier
-- notice instead of adding one, and the decision clears the toss notices and
-- sends one "chose to bat/bowl" to everyone on the sheet.
-- Also: expire-stale-matches runs every minute instead of every 15, so a round
-- whose slot has ended stops showing as in progress within a minute.
-- Applied to the live project on 13 Nov 2026.

do $mig$
declare
  v_def text;
  v_new text;
  v_old_where constant text := E'where t.id in (v_m.team_a_id, v_m.team_b_id)\n     order by t.owner_id, (t.id = v_winner) desc';
  v_new_where constant text := E'where t.id in (v_m.team_a_id, v_m.team_b_id)\n       and t.owner_id <> v_uid\n     order by t.owner_id, (t.id = v_winner) desc';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'perform_toss';
  v_new := replace(v_def, v_old_where, v_new_where);
  if v_new = v_def then raise exception 'perform_toss: notify loop not found'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redo_toss';
  v_new := replace(v_def, v_old_where, v_new_where);
  if v_new = v_def then raise exception 'redo_toss: notify loop not found'; end if;
  v_new := replace(v_new, E'  for v_cap in\n',
    E'  delete from public.notification_jobs\n   where kind = ''toss_ready''\n     and data->>''route'' = ''/match/'' || in_match_id::text || ''/toss'';\n\n  for v_cap in\n');
  if position('delete from public.notification_jobs' in v_new) = 0 then
    raise exception 'redo_toss: loop start not found';
  end if;
  execute v_new;
end
$mig$;

create or replace function public.set_toss_decision(in_match_id uuid, in_decision text)
returns match_toss
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := (select auth.uid());
  v_row    public.match_toss%rowtype;
  v_m      public.matches%rowtype;
  v_side   text;
  v_player record;
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

  if v_m.creator_id <> v_uid then
    raise exception 'NOT_THE_ORGANISER' using errcode = '42501';
  end if;

  update public.match_toss
     set decision = in_decision, decided_at = now()
   where match_id = in_match_id
   returning * into v_row;

  delete from public.notification_jobs
   where kind = 'toss_ready'
     and data->>'route' = '/match/' || in_match_id::text || '/toss';

  v_side := coalesce(public.match_side_label(v_row.winner_team_id), 'The toss winner');

  for v_player in
    select distinct mp.user_id
      from public.match_players mp
     where mp.match_id = in_match_id
       and mp.status = 'confirmed'
       and mp.user_id <> v_uid
  loop
    perform public.enqueue_notification(
      v_player.user_id,
      'toss_done',
      'Toss decided',
      v_side || ' chose to ' || in_decision || ' first.',
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$function$;

select cron.alter_job(jobid, schedule := '* * * * *')
  from cron.job where jobname = 'expire-stale-matches';
