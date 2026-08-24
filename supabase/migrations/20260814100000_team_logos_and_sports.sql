-- Team logos are immutable after creation in the app, while database updates
-- remain owner-authorised for the existing team-detail fields.
alter table public.teams add column if not exists description text;
alter table public.teams add column if not exists logo_url text;
alter table public.teams add column if not exists home_ground text;

insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

create policy "team_logos_public_read" on storage.objects for select
  using (bucket_id = 'team-logos');
create policy "team_logos_owner_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and exists (
    select 1 from public.teams t
     where t.id::text = split_part(name, '/', 1) and t.owner_id = (select auth.uid())
  ));

-- A managed catalogue controls which existing sport keys are available for new
-- selection. Historical match/team rows retain their stored sport unaffected.
create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  sport text not null unique check (sport in ('box_cricket', 'badminton')),
  name text not null unique check (char_length(btrim(name)) between 2 and 50),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.sports (sport, name) values
  ('box_cricket', 'Cricket'), ('badminton', 'Badminton')
on conflict (sport) do nothing;
alter table public.sports enable row level security;
create policy "sports_read_active_or_superadmin" on public.sports for select to authenticated
  using (is_active or public.is_superadmin());
create policy "sports_superadmin_write" on public.sports for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- Declining is per-recipient: never cancel the poster's open challenge.
-- The status column must accept 'declined' before the function below can write
-- it — the original constraint allowed only offered/accepted/expired, so every
-- decline failed on a check violation.
alter table public.challenge_candidates drop constraint if exists challenge_candidates_status_check;
alter table public.challenge_candidates add constraint challenge_candidates_status_check
  check (status = any (array['offered', 'accepted', 'declined', 'expired']));

create or replace function public.decline_open_challenge(in_challenge_id uuid, in_team_id uuid)
returns public.challenge_candidates language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_row public.challenge_candidates%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_team_owner(in_team_id, v_uid) then raise exception 'NOT_TEAM_OWNER' using errcode = '42501'; end if;
  select * into v_row from public.challenge_candidates where challenge_id=in_challenge_id and team_id=in_team_id for update;
  if not found or v_row.status <> 'offered' then raise exception 'NOT_OFFERED' using errcode = '42501'; end if;
  update public.challenge_candidates set status='declined', responded_at=now() where id=v_row.id returning * into v_row;
  return v_row;
end; $$;
revoke execute on function public.decline_open_challenge(uuid, uuid) from anon, public;
grant execute on function public.decline_open_challenge(uuid, uuid) to authenticated;
