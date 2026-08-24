-- Team profile fields, the vice-captain badge and the four team read models.
--
-- Reconstructed on 15 Aug 2026 from the deployed definitions on
-- izqknyzmeyiowbwmcfes. These objects were applied to production out of band
-- and had no migration file, so `supabase db reset` produced a database the
-- teams UI could not run against. Everything below matches production exactly;
-- applying this file to an already-migrated database is a no-op.

alter table public.teams add column if not exists description text;
alter table public.teams add column if not exists logo_url text;
alter table public.teams add column if not exists home_ground text;

-- Vice captain is a badge only. Every owner-only rule keys off teams.owner_id,
-- not this column, so widening the check does not widen any permission.
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members add constraint team_members_role_check
  check (role = any (array['owner', 'vice_captain', 'member']));

-- teams is members-only and profiles is self-only, so a plain select cannot
-- resolve the captain's name. This is why the overview is a definer function.
create or replace function public.get_team_overview(in_team_id uuid)
returns table (
  id uuid, name text, sport text, invite_code text, created_at timestamptz,
  description text, logo_url text, home_ground text, owner_id uuid,
  captain_name text, captain_avatar text, player_count integer,
  my_role text, i_am_owner boolean
) language sql stable security definer set search_path to 'public' as $function$
  select t.id, t.name, t.sport, t.invite_code, t.created_at,
         t.description, t.logo_url, t.home_ground,
         t.owner_id, p.full_name, p.avatar_url,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         (select tm.role from public.team_members tm
           where tm.team_id = t.id and tm.user_id = (select auth.uid())),
         t.owner_id = (select auth.uid())
    from public.teams t
    left join public.profiles p on p.id = t.owner_id
   where t.id = in_team_id
     and public.is_team_member(in_team_id, (select auth.uid()));
$function$;

create or replace function public.get_team_stats(in_team_id uuid)
returns table (
  team_id uuid, matches_played integer, wins integer, losses integer,
  ties integer, win_rate integer, highest_score integer, lowest_score integer
) language sql stable security definer set search_path to 'public' as $function$
  with played as (
    select m.id, m.winner_team_id
      from public.matches m
     where m.status = 'completed'
       and in_team_id in (m.team_a_id, m.team_b_id)
  ),
  scores as (
    select i.runs
      from public.innings i
      join played p on p.id = i.match_id
     where i.batting_team_id = in_team_id
  )
  select in_team_id,
         (select count(*) from played)::integer,
         (select count(*) from played where winner_team_id = in_team_id)::integer,
         (select count(*) from played
           where winner_team_id is not null and winner_team_id <> in_team_id)::integer,
         (select count(*) from played where winner_team_id is null)::integer,
         coalesce((
           select round(100.0 * count(*) filter (where winner_team_id = in_team_id)
                  / nullif(count(*), 0)) from played
         ), 0)::integer,
         (select max(runs) from scores)::integer,
         (select min(runs) from scores)::integer
   where public.is_team_member(in_team_id, (select auth.uid()));
$function$;

-- The opponent is resolved relative to in_team_id, so the client never has to
-- work out which of team_a / team_b is "us".
create or replace function public.get_team_fixtures(in_team_id uuid)
returns table (
  match_id uuid, match_name text, scheduled_at timestamptz, venue_text text,
  status text, is_upcoming boolean, opponent_id uuid, opponent_name text,
  is_home boolean, our_runs integer, our_wickets integer,
  their_runs integer, their_wickets integer, outcome text, result_text text
) language sql stable security definer set search_path to 'public' as $function$
  select m.id, m.match_name, m.scheduled_at, m.venue_text, m.status,
         (m.status in ('open', 'locked') and m.scheduled_at > now() - interval '3 hours'),
         opp.id, opp.name,
         (m.team_a_id = in_team_id),
         ours.runs, ours.wickets,
         theirs.runs, theirs.wickets,
         case
           when m.status <> 'completed' then null
           when m.winner_team_id is null then 'tied'
           when m.winner_team_id = in_team_id then 'won'
           else 'lost'
         end,
         m.result_text
    from public.matches m
    left join public.teams opp
      on opp.id = case when m.team_a_id = in_team_id then m.team_b_id else m.team_a_id end
    left join public.innings ours
      on ours.match_id = m.id and ours.batting_team_id = in_team_id
    left join public.innings theirs
      on theirs.match_id = m.id and theirs.batting_team_id <> in_team_id
   where in_team_id in (m.team_a_id, m.team_b_id)
     and m.status <> 'cancelled'
     and public.is_team_member(in_team_id, (select auth.uid()))
   order by
     (m.status in ('open', 'locked') and m.scheduled_at > now() - interval '3 hours') desc,
     m.scheduled_at desc
   limit 50;
$function$;

-- team_members has no UPDATE policy by design, so the role change goes through
-- a definer function that re-checks ownership itself.
create or replace function public.set_member_role(in_team_id uuid, in_user_id uuid, in_role text)
returns public.team_members
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row public.team_members%rowtype;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if in_role not in ('vice_captain', 'member') then
    raise exception 'INVALID_ROLE' using errcode = '23514';
  end if;
  if not public.is_team_owner(in_team_id, v_uid) then
    raise exception 'NOT_TEAM_OWNER' using errcode = '42501';
  end if;
  if in_user_id = (select owner_id from public.teams where id = in_team_id) then
    raise exception 'CANNOT_DEMOTE_OWNER' using errcode = '23514';
  end if;

  update public.team_members set role = in_role
   where team_id = in_team_id and user_id = in_user_id
   returning * into v_row;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_row;
end;
$function$;

revoke execute on function public.get_team_overview(uuid) from anon, public;
revoke execute on function public.get_team_stats(uuid) from anon, public;
revoke execute on function public.get_team_fixtures(uuid) from anon, public;
revoke execute on function public.set_member_role(uuid, uuid, text) from anon, public;
grant execute on function public.get_team_overview(uuid) to authenticated;
grant execute on function public.get_team_stats(uuid) to authenticated;
grant execute on function public.get_team_fixtures(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
