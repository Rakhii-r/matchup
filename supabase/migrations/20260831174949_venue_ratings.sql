-- venues.rating / rating_count were displayed but nothing could ever write
-- them. Ratings now come from real rows, and only from people who played there.
create table if not exists public.venue_ratings (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, user_id)
);
create index if not exists venue_ratings_venue_idx on public.venue_ratings(venue_id);
alter table public.venue_ratings enable row level security;

-- Writes go through rate_venue only, which is why there is no INSERT/UPDATE policy.
drop policy if exists venue_ratings_select on public.venue_ratings;
create policy venue_ratings_select on public.venue_ratings
  for select to authenticated using (true);
revoke insert, update, delete on public.venue_ratings from anon, authenticated;

-- Recomputed from the rows rather than incremented, so it can never drift.
create or replace function public.sync_venue_rating()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_venue uuid := coalesce(new.venue_id, old.venue_id);
begin
  update public.venues v
     set rating = (select round(avg(r.rating)::numeric, 1) from public.venue_ratings r where r.venue_id = v_venue),
         rating_count = (select count(*) from public.venue_ratings r where r.venue_id = v_venue)
   where v.id = v_venue;
  return null;
end;
$function$;

drop trigger if exists venue_ratings_sync on public.venue_ratings;
create trigger venue_ratings_sync
  after insert or update or delete on public.venue_ratings
  for each row execute function public.sync_venue_rating();

-- A trigger function must never be callable as an RPC.
revoke execute on function public.sync_venue_rating() from anon, authenticated;

create or replace function public.rate_venue(in_venue_id uuid, in_rating smallint)
returns venues language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_v   public.venues%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not public.is_active_user(v_uid) then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if in_rating is null or in_rating < 1 or in_rating > 5 then
    raise exception 'INVALID_RATING' using errcode = '23514';
  end if;
  select * into v_v from public.venues where id = in_venue_id;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Not filtered on status='confirmed': see is_on_match_sheet.
  if not exists (
    select 1 from public.match_players mp
      join public.matches m on m.id = mp.match_id
     where mp.user_id = v_uid and m.venue_id = in_venue_id and m.status = 'completed'
  ) then
    raise exception 'NOT_PLAYED_HERE' using errcode = '42501';
  end if;
  insert into public.venue_ratings (venue_id, user_id, rating)
  values (in_venue_id, v_uid, in_rating)
  on conflict (venue_id, user_id)
  do update set rating = excluded.rating, updated_at = now();
  select * into v_v from public.venues where id = in_venue_id;
  return v_v;
end;
$function$;
revoke execute on function public.rate_venue(uuid, smallint) from anon;

create or replace function public.my_venue_rating(in_venue_id uuid)
returns table (can_rate boolean, my_rating smallint)
language sql stable security definer set search_path to 'public'
as $function$
  select
    exists (
      select 1 from public.match_players mp
        join public.matches m on m.id = mp.match_id
       where mp.user_id = (select auth.uid())
         and m.venue_id = in_venue_id and m.status = 'completed'
    ),
    (select r.rating from public.venue_ratings r
      where r.venue_id = in_venue_id and r.user_id = (select auth.uid()));
$function$;
revoke execute on function public.my_venue_rating(uuid) from anon;
