-- A plain wide or no-ball rendered as an EMPTY chip in "This over".
--
-- The label was 'wd' || nullif(extra_runs - 1, 0)::text. For a plain wide
-- extra_runs is 1, so the nullif is NULL -- and text || NULL is NULL in
-- Postgres, so the whole label vanished. Only extras with runs taken off them
-- ("wd2") ever showed. coalesce the suffix to '' so a plain one reads "wd"/"nb".
create or replace function public.get_this_over(in_innings_id uuid)
returns table(seq integer, over_number integer, ball_in_over smallint, runs_off_bat smallint,
              extra_type text, extra_runs smallint, wicket_type text, label text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with cur as (
    select coalesce(max(over_number), 0) as o
      from public.deliveries where innings_id = in_innings_id
  )
  select d.seq, d.over_number, d.ball_in_over,
         d.runs_off_bat, d.extra_type, d.extra_runs, d.wicket_type,
         -- One human-readable chip per ball, built server-side so every client
         -- renders the same thing.
         case
           when d.wicket_type is not null then 'W'
           when d.extra_type = 'wide'     then 'wd' || coalesce(nullif(d.extra_runs - 1, 0)::text, '')
           when d.extra_type = 'no_ball'  then 'nb' || coalesce(nullif(d.extra_runs - 1, 0)::text, '')
           when d.extra_type = 'bye'      then d.extra_runs::text || 'b'
           when d.extra_type = 'leg_bye'  then d.extra_runs::text || 'lb'
           else d.runs_off_bat::text
         end
    from public.deliveries d, cur
   where d.innings_id = in_innings_id
     and d.over_number = cur.o
     and exists (
       select 1 from public.innings i
        where i.id = in_innings_id
          and (
            public.is_match_creator(i.match_id, (select auth.uid()))
            or public.is_match_player(i.match_id, (select auth.uid()))
          )
     )
   order by d.seq asc;
$function$;
