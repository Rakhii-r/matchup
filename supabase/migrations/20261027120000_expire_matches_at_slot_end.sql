-- A match is over when its booked slot is over. The 24-hour overrun grace for
-- matches with scoring recorded (20260901050603) kept a played game LIVE on
-- Home for a full day after its slot, which is exactly what organisers read as
-- "yesterday's match is still showing". Product call, 27 Oct 2026: no grace.
--
-- match_expiry_at is unchanged: end_time, or scheduled_at + 6h when no slot
-- end was booked.
create or replace function public.expire_stale_matches()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  with closed as (
    update public.matches m
       set status = 'expired'
     where m.status in ('open', 'locked')
       and now() >= public.match_expiry_at(m.end_time, m.scheduled_at)
    returning m.id
  )
  select count(*) into v_n from closed;

  return coalesce(v_n, 0);
end;
$function$;

revoke execute on function public.expire_stale_matches() from anon, authenticated;
