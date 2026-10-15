-- list_my_challenges dropped 79% of all challenges.
--
-- The function inner-joined `venues` on `c.venue_id`. That column is NULLABLE
-- and the challenge-post screens never collect a venue — `teams/post-open.tsx`
-- and `teams/challenge.tsx` contain no venue UI at all — so every challenge
-- posted through the app has a null venue_id and was silently filtered out.
--
-- Measured on prod before the fix: 53 of 67 challenges had a null venue_id, and
-- 268 challenge_candidates rows hung off those. For a real applicant account,
-- list_my_challenges returned 0 rows where the visibility rule alone returns 7.
--
-- The user-visible symptom: an opponent who had applied to an open challenge saw
-- an empty Offers list, so there was no card and therefore no Chat button for
-- that team. It read as a missing chat feature; it was a join.
--
-- Rebuilt from prod's current body (pg_get_functiondef, 31 Aug). The ONLY change
-- is `join public.venues` -> `left join public.venues`. `venue_name` is now
-- legitimately null when no ground has been agreed, and the client types were
-- widened to string | null in the same change so callers must handle it.
create or replace function public.list_my_challenges()
returns table (
  id uuid, status text, direction text, from_team_id uuid, from_team_name text,
  to_team_id uuid, to_team_name text, match_name text, venue_name text,
  scheduled_at timestamptz, total_slots integer, message text, match_id uuid,
  is_expired boolean, i_can_respond boolean, i_can_cancel boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    c.id, c.status,
    case when public.is_team_member(c.from_team_id, (select auth.uid()))
         then 'outgoing' else 'incoming' end,
    c.from_team_id, ft.name,
    c.to_team_id,   tt.name,
    c.match_name, v.name, c.scheduled_at,
    c.total_slots, c.message, c.match_id,
    c.scheduled_at <= now(),
    (
      c.status = 'pending' and c.scheduled_at > now()
        and public.is_team_owner(c.to_team_id, (select auth.uid()))
    ) or (
      c.status = 'open' and c.scheduled_at > now()
        and exists (
          select 1 from public.challenge_candidates cc
           where cc.challenge_id = c.id
             and cc.status = 'offered'
             and public.is_team_owner(cc.team_id, (select auth.uid()))
        )
    ),
    c.status in ('pending', 'open')
      and public.is_team_owner(c.from_team_id, (select auth.uid())),
    c.created_at
  from public.team_challenges c
  join public.teams  ft on ft.id = c.from_team_id
  left join public.teams tt on tt.id = c.to_team_id
  left join public.venues v  on v.id  = c.venue_id
  where public.is_team_member(c.from_team_id, (select auth.uid()))
     or public.is_team_member(c.to_team_id,   (select auth.uid()))
     or (
       c.status = 'open'
       and exists (
         select 1 from public.challenge_candidates cc
          where cc.challenge_id = c.id
            and public.is_team_member(cc.team_id, (select auth.uid()))
       )
     )
  order by c.created_at desc
  limit 100;
$function$;
