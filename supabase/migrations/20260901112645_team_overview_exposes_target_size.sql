-- The team page needs to show and set whether the squad is recruiting, and
-- get_team_overview is that page's read model. Without target_size here the
-- captain had no way to see the state they were toggling.
--
-- Dropped first: a RETURNS TABLE cannot gain a column via CREATE OR REPLACE.
drop function if exists public.get_team_overview(uuid);

create function public.get_team_overview(in_team_id uuid)
returns table (
  id uuid, name text, sport text, invite_code text, created_at timestamptz,
  description text, logo_url text, home_ground text, owner_id uuid,
  captain_name text, captain_avatar text, player_count integer,
  my_role text, i_am_owner boolean, target_size integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.id, t.name, t.sport, t.invite_code, t.created_at,
         t.description, t.logo_url, t.home_ground,
         t.owner_id, p.full_name, p.avatar_url,
         (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
         (select tm.role from public.team_members tm
           where tm.team_id = t.id and tm.user_id = (select auth.uid())),
         t.owner_id = (select auth.uid()),
         t.target_size
    from public.teams t
    left join public.profiles p on p.id = t.owner_id
   where t.id = in_team_id
     and public.is_team_member(in_team_id, (select auth.uid()));
$function$;

revoke execute on function public.get_team_overview(uuid) from anon;
