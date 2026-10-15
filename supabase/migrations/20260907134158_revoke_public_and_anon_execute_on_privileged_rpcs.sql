-- Postgres grants EXECUTE to PUBLIC on every new function by default, and
-- PUBLIC includes `anon`. A `revoke ... from anon, authenticated` does NOT
-- remove it, which is why these stayed reachable logged-out: the ACLs read
-- {authenticated, service_role, postgres, PUBLIC}.
--
-- Nothing here was exploitable — delete_match, set_motm and rate_venue all
-- raise NOT_AUTHENTICATED on a null auth.uid() — but a privileged SECURITY
-- DEFINER function should not be dialable by a stranger at all, and the read
-- functions genuinely returned real data to logged-out callers.
--
-- Every function below is called by the app only from an authenticated screen,
-- so `authenticated` keeps its grant except on the trigger functions, which no
-- caller invokes directly.

-- Trigger functions. These only ever run from a trigger; direct execution is
-- meaningless at best.
revoke execute on function public.assert_roster_not_full()      from public, anon, authenticated;
revoke execute on function public.notify_captain_chat_message() from public, anon, authenticated;
revoke execute on function public.sync_innings_totals()         from public, anon, authenticated;
revoke execute on function public.sync_venue_rating()           from public, anon, authenticated;

-- Maintenance. Belongs to the scheduler, not to clients.
revoke execute on function public.expire_stale_matches() from public, anon, authenticated;

-- Writes. Guarded internally, but signed-in callers only.
revoke execute on function public.delete_match(uuid)              from public, anon;
revoke execute on function public.set_motm(uuid, uuid)            from public, anon;
revoke execute on function public.rate_venue(uuid, smallint)      from public, anon;

-- Reads that return real user, team and match data.
revoke execute on function public.get_team_overview(uuid)         from public, anon;
revoke execute on function public.my_venue_rating(uuid)           from public, anon;
revoke execute on function public.is_on_match_sheet(uuid, uuid)   from public, anon;
revoke execute on function public.nearby_matches(double precision, double precision, integer, text)
  from public, anon;

-- Re-assert the intended grant, so a later default-privilege change cannot
-- leave any of these unreachable for the app.
grant execute on function public.delete_match(uuid)            to authenticated;
grant execute on function public.set_motm(uuid, uuid)          to authenticated;
grant execute on function public.rate_venue(uuid, smallint)    to authenticated;
grant execute on function public.get_team_overview(uuid)       to authenticated;
grant execute on function public.my_venue_rating(uuid)         to authenticated;
grant execute on function public.is_on_match_sheet(uuid, uuid) to authenticated;
grant execute on function public.nearby_matches(double precision, double precision, integer, text)
  to authenticated;

-- NOT CHANGED, deliberately: public.public_profiles stays SECURITY DEFINER.
-- The advisor flags it, but `profiles` is self-read-only under RLS and the view
-- exposes only id, full_name, area_name, avatar_url, sport_pref, created_at of
-- active users — no email, phone or home coordinates. Flipping it to
-- security_invoker would break every roster, opponent and player-card name
-- lookup in the app and would protect nothing.
