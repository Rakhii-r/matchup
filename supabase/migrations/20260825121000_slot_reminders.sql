-- ============================================================================
-- Booked-slot reminders: "30 minutes left", "10 minutes left".
--
-- A minute-resolution cron scan rather than one scheduled job per match: slots
-- are created and cancelled constantly, and per-match jobs would need creating,
-- rescheduling on every edit and reaping on every cancel. One scan over the
-- handful of matches whose end_time is inside the next half hour is cheaper
-- than that bookkeeping and cannot leak orphaned jobs.
--
-- `slot_reminders` is the dedupe ledger. Its primary key is what makes the scan
-- idempotent: the job runs every minute and the same slot stays inside the
-- 30-minute window for twenty-odd consecutive runs, so without a unique key on
-- (root, threshold) every player would get twenty pushes. The insert is
-- ON CONFLICT DO NOTHING and the notifications are only enqueued when the
-- insert actually took the row, so two overlapping runs cannot double-send.
--
-- Reminders are per SLOT, not per game: the ledger is keyed on the series root
-- so playing Game 2 does not re-trigger the 30-minute warning.
-- ============================================================================

create table if not exists public.slot_reminders (
  root_match_id  uuid        not null references public.matches(id) on delete cascade,
  minutes_left   integer     not null,
  sent_at        timestamptz not null default now(),
  primary key (root_match_id, minutes_left)
);

-- Nobody reads this from the client; it exists to stop the cron double-sending.
alter table public.slot_reminders enable row level security;
revoke all on table public.slot_reminders from anon, authenticated;

comment on table public.slot_reminders is
  'Dedupe ledger for booked-slot countdown pushes. One row per (series root, threshold).';

-- ---------------------------------------------------------------------------
-- The scan.
--
-- SECURITY DEFINER and callable only by the cron owner — it reads every match
-- in the table, which no end user may do.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_slot_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $fn$
declare
  v_now       timestamptz := now();
  v_slot      record;
  v_player    record;
  v_minutes   integer;
  v_sent      integer := 0;
  v_threshold integer;
begin
  -- Candidate slots: a live series with a booked end_time still ahead of us.
  -- Grouping by the root collapses Game 1..N onto one reminder, and the
  -- `having` keeps a slot whose games are ALL completed or cancelled out of the
  -- scan — nobody is on the ground any more.
  for v_slot in
    select coalesce(m.rematch_of, m.id) as root_id,
           min(m.end_time)              as end_time
      from public.matches m
     where m.end_time is not null
       and m.end_time > v_now
       and m.end_time <= v_now + interval '31 minutes'
       and m.status <> 'cancelled'
     group by coalesce(m.rematch_of, m.id)
    having bool_or(m.status in ('open', 'locked'))
  loop
    -- Floor, so a slot 30m59s out is still "30 minutes left" and the 30-minute
    -- reminder cannot be skipped by a scan landing between whole minutes.
    v_minutes := floor(extract(epoch from (v_slot.end_time - v_now)) / 60)::integer;

    -- The threshold this scan satisfies. 30 wins when both are due, because a
    -- slot can only cross 30 before it crosses 10 and the 10-minute row will
    -- still be free on a later run.
    v_threshold := case
                     when v_minutes <= 30 and v_minutes > 10 then 30
                     when v_minutes <= 10 and v_minutes >= 0 then 10
                     else null
                   end;
    if v_threshold is null then
      continue;
    end if;

    -- Claim the (slot, threshold) pair. If another run already took it this
    -- inserts nothing and we send nothing.
    insert into public.slot_reminders (root_match_id, minutes_left)
    values (v_slot.root_id, v_threshold)
    on conflict (root_match_id, minutes_left) do nothing;

    if not found then
      continue;
    end if;

    -- Everyone confirmed on any game in this slot, deduped: a player who was on
    -- Game 1 and Game 2 is one person and gets one push.
    for v_player in
      select distinct mp.user_id
        from public.match_players mp
        join public.matches g on g.id = mp.match_id
       where (g.id = v_slot.root_id or g.rematch_of = v_slot.root_id)
         and mp.status = 'confirmed'
    loop
      perform public.enqueue_notification(
        v_player.user_id,
        'slot_ending',
        -- The real remaining minutes, not the threshold: a slot that was only
        -- created 12 minutes before its end still claims the 30 row, and
        -- telling those players "30 minutes left" would be a lie.
        v_minutes || ' minutes left in your slot',
        case
          when v_threshold = 30
            then 'Enough time for one more game. Finish this one and tap Play Next Match.'
          else 'Your booked time ends soon. No new game can start after it.'
        end,
        jsonb_build_object(
          'route', '/match/' || v_slot.root_id::text || '/result',
          'match_id', v_slot.root_id,
          'minutes_left', v_threshold
        )
      );
      v_sent := v_sent + 1;
    end loop;
  end loop;

  return v_sent;
end;
$fn$;

revoke execute on function public.enqueue_slot_reminders() from anon, authenticated, public;

comment on function public.enqueue_slot_reminders() is
  'Cron scan: pushes the 30- and 10-minutes-left warnings for booked slots. Returns rows enqueued.';

-- ---------------------------------------------------------------------------
-- Schedule. Every minute, matching notify-wave-dispatch, so a reminder waits at
-- most one further minute in the queue before it is delivered.
-- ---------------------------------------------------------------------------
select cron.unschedule('slot-ending-reminders')
 where exists (select 1 from cron.job where jobname = 'slot-ending-reminders');

select cron.schedule(
  'slot-ending-reminders',
  '* * * * *',
  $cron$select public.enqueue_slot_reminders();$cron$
);
