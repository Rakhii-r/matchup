-- Re-roll the toss.
--
-- perform_toss is deliberately idempotent — it returns the existing row if one
-- exists — so it can never re-roll, and a "flip again" button wired to it would
-- land on the same face forever. This is the explicit, auditable way to do it.
--
-- The guard that matters: once the winning captain has chosen bat or bowl the
-- toss is spent, and re-rolling would silently undo a decision the other side
-- has already seen. Refused with TOSS_ALREADY_DECIDED.
--
-- Both captains are notified, because the other captain was told who won by the
-- original toss notification and must not be left believing a stale result.
create or replace function public.redo_toss(in_match_id uuid)
returns public.match_toss
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid    uuid := (select auth.uid());
  v_m      public.matches%rowtype;
  v_row    public.match_toss%rowtype;
  v_winner uuid;
  v_heads  boolean;
  v_cap    record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_m from public.matches where id = in_match_id for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_m.status not in ('open', 'locked') then
    raise exception 'MATCH_NOT_PLAYABLE' using errcode = '23514';
  end if;
  if not public.is_match_captain(in_match_id, v_uid) then
    raise exception 'NOT_A_CAPTAIN' using errcode = '42501';
  end if;

  select * into v_row from public.match_toss where match_id = in_match_id for update;
  if not found then
    raise exception 'TOSS_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.decision is not null then
    raise exception 'TOSS_ALREADY_DECIDED' using errcode = '23514';
  end if;

  v_heads  := (random() < 0.5);
  v_winner := case when v_heads then v_m.team_a_id else v_m.team_b_id end;

  update public.match_toss
     set outcome        = case when v_heads then 'heads' else 'tails' end,
         winner_team_id = v_winner,
         called_by      = v_uid,
         created_at     = now()
   where match_id = in_match_id
   returning * into v_row;

  for v_cap in
    select t.owner_id, (t.id = v_winner) as won
      from public.teams t
     where t.id in (v_m.team_a_id, v_m.team_b_id)
  loop
    perform public.enqueue_notification(
      v_cap.owner_id,
      'toss_ready',
      'Toss re-flipped',
      case when v_cap.won
           then 'The toss was flipped again and you won it. Choose to bat or bowl.'
           else 'The toss was flipped again. The other captain is choosing.' end,
      jsonb_build_object('route', '/match/' || in_match_id::text || '/toss')
    );
  end loop;

  return v_row;
end;
$function$;

revoke execute on function public.redo_toss(uuid) from anon, public;
grant execute on function public.redo_toss(uuid) to authenticated;
