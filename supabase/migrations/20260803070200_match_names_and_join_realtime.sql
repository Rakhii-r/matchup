-- Give every match a dedicated display name. The default keeps older deployed
-- clients compatible while updated clients require a meaningful name.
alter table public.matches
  add column if not exists match_name text not null default 'Match';

alter table public.matches
  drop constraint if exists matches_match_name_len;
alter table public.matches
  add constraint matches_match_name_len check (char_length(trim(match_name)) between 1 and 80);

-- Join-request and approval popups subscribe to match_players changes. Add the
-- table to Supabase Realtime once, without failing if it is already present.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_players'
  ) then
    alter publication supabase_realtime add table public.match_players;
  end if;
end $$;
