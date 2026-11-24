-- Cancelling a game frees the court it booked.
--
-- A match is cancelled by a plain status update (matchRepository.setStatus),
-- and nothing touched venue_bookings, so the court stayed "Booked by you" for
-- a game that no longer exists. This trigger cancels the match's confirmed
-- bookings that have not ended yet, the same way cancel_venue_booking does.
-- A booking made on its own from the Venues tab has match_id null and is not
-- touched: it is cancelled from My Bookings.

create or replace function public.free_bookings_on_match_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.venue_bookings
     set status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   where match_id = new.id
     and status = 'confirmed'
     and end_time > now();
  return null;
end;
$$;

revoke all on function public.free_bookings_on_match_cancel() from public, anon, authenticated;

drop trigger if exists matches_free_bookings_on_cancel on public.matches;
create trigger matches_free_bookings_on_cancel
  after update of status on public.matches
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.free_bookings_on_match_cancel();
