-- 0011: Keep matches.filled_slots correct.
--
-- filled_slots was never maintained, so player counts on cards were always wrong.
-- The creator counts as 1; each confirmed player adds one. Recompute on every change to
-- match_players. Capped at total_slots so the filled_not_over CHECK can't abort a write.

create or replace function public.sync_filled_slots()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mid uuid := coalesce(new.match_id, old.match_id);
  confirmed_count int;
begin
  select count(*) into confirmed_count
  from public.match_players
  where match_id = mid and status = 'confirmed';

  update public.matches
  set filled_slots = least(1 + confirmed_count, total_slots)
  where id = mid;

  return null;
end;
$$;

create trigger match_players_sync_filled
after insert or update or delete on public.match_players
for each row execute function public.sync_filled_slots();

-- Backfill existing rows.
update public.matches m
set filled_slots = least(
  1 + (select count(*) from public.match_players mp
       where mp.match_id = m.id and mp.status = 'confirmed'),
  m.total_slots
);
