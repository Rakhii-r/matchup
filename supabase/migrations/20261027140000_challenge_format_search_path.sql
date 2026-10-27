-- Security advisor 0011 (function_search_path_mutable). challenge_format
-- touches no table, so an empty search_path changes nothing it does and
-- removes the role-mutable lookup the advisor flags.
--
-- public_profiles (advisor 0010, SECURITY DEFINER view) is deliberate and left
-- alone: it is the read-only public card -- id, name, area, photo, sports,
-- created_at of active players -- that other players must see past the
-- profiles RLS. No phone number or location is in it.
create or replace function public.challenge_format(in_total_slots integer)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select greatest(coalesce(in_total_slots, 0) / 2, 1);
$function$;
