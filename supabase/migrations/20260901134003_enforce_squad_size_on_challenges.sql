-- The squad rule was CLIENT-SIDE ONLY. create_challenge checked it, but
-- post_open_challenge did not, so a 1-player squad could still post a 4 v 4
-- from a stale screen, an older build, or a direct API call. The button was
-- gating something the server was happy to accept.
--
-- A BEFORE INSERT trigger rather than an edit to post_open_challenge: that
-- function has TWO live overloads (in_venue_id and in_area_name), and a rule
-- copied into both is a rule that will drift. The trigger covers every path
-- into the table, including any future one.
create or replace function public.assert_squad_big_enough()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_have integer;
  v_need integer;
begin
  -- total_slots is players-per-side x 2, so a side needs half of it.
  v_need := greatest(new.total_slots / 2, 1);

  select count(*) into v_have
    from public.team_members tm
   where tm.team_id = new.from_team_id;

  if v_have < v_need then
    raise exception 'SQUAD_TOO_SMALL' using errcode = '23514',
      detail = format('%s of %s players', v_have, v_need);
  end if;

  return new;
end;
$function$;

-- A trigger function must never be callable as an RPC.
revoke execute on function public.assert_squad_big_enough() from anon, authenticated;

drop trigger if exists team_challenges_squad_check on public.team_challenges;
create trigger team_challenges_squad_check
  before insert on public.team_challenges
  for each row execute function public.assert_squad_big_enough();
