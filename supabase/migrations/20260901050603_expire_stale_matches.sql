-- A game whose time has passed stayed 'open' forever. nearby_matches already
-- hid it (scheduled_at > now() - 6h), so it vanished from discovery while the
-- row still claimed to be open everywhere else -- My Games, the organiser's
-- list, the team fixture list. 17 rows were sitting in that state.
--
-- 'expired' rather than reusing 'cancelled': cancelled means a person called it
-- off and the UI says so. team_challenges already has exactly this status and
-- expire_open_challenges() to set it, so this mirrors an established pattern.
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status = any (array['open', 'locked', 'completed', 'cancelled', 'expired']));

-- coalesce, not end_time alone: only 5 of 17 open games had a booked slot end,
-- so an end_time-only rule would never close the other 12 -- which is the bug.
-- The 6 hour fallback is deliberately the same grace nearby_matches uses to
-- hide stale games, so what the list shows and what the row says finally agree.
create or replace function public.match_expiry_at(in_end_time timestamptz, in_scheduled_at timestamptz)
returns timestamptz
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(in_end_time, in_scheduled_at + interval '6 hours');
$function$;

revoke execute on function public.match_expiry_at(timestamptz, timestamptz) from anon;

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
       and now() >= (
         public.match_expiry_at(m.end_time, m.scheduled_at)
         -- A game with deliveries recorded is being played, and a real one can
         -- overrun its booked slot. Those get a further 24 hours so the scorer
         -- is never cut off mid-innings; an abandoned one still stops sitting
         -- in the list forever.
         + case
             when exists (select 1 from public.innings i where i.match_id = m.id)
               then interval '24 hours'
             else interval '0'
           end
       )
    returning m.id
  )
  select count(*) into v_n from closed;

  return coalesce(v_n, 0);
end;
$function$;

revoke execute on function public.expire_stale_matches() from anon, authenticated;

-- Same cadence as expire-open-challenges. A game does not need minute accuracy
-- to stop being listed, and this is a full-table update.
select cron.unschedule('expire-stale-matches')
 where exists (select 1 from cron.job where jobname = 'expire-stale-matches');

select cron.schedule('expire-stale-matches', '*/15 * * * *',
  'select public.expire_stale_matches();');
