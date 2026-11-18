-- book_venue_slot accepted any slot that had not yet ENDED, so at 11:12 the
-- 11:00 slot was still bookable. A slot that has started is refused.
-- The client's getSlotStatus was changed to match (slotUtils.ts).
-- Applied to the live project on 13 Nov 2026.
do $mig$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_venue_slot';
  v_new := replace(v_def, E'  if in_end_time <= now() then\n    raise exception ''CANNOT_BOOK_PAST''',
                          E'  if in_start_time <= now() then\n    raise exception ''CANNOT_BOOK_PAST''');
  if v_new = v_def then raise exception 'book_venue_slot: past check not found'; end if;
  execute v_new;
end
$mig$;
