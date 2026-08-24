# Teams flow — handover (13 Aug 2026)

Checkpoint mid-implementation. **The database layer is done and live. No UI was
built.** Read this before continuing.

## State: DB ahead of client

Migration `team_profile_fields_and_stats` is applied to production
(`izqknyzmeyiowbwmcfes`) but has **no local file and no client code**. First
action next session:

```bash
npx supabase link --project-ref izqknyzmeyiowbwmcfes
npx supabase db pull     # writes the missing migration file
npx supabase gen types typescript --project-id izqknyzmeyiowbwmcfes \
  > src/shared/types/database.types.ts
npx tsc --noEmit
```

That also replaces the hand-written types accumulated over the last few
sessions with generated truth. Any signature I guessed wrong surfaces there.

## Audit — what already existed (reuse, do not rebuild)

| Thing | Detail |
|---|---|
| `teams` | `id, name, sport, owner_id, invite_code, created_at` |
| `team_members` | `id, team_id, user_id, role, joined_at` |
| `join_team(code)` | Row-locked, idempotent, block-aware. **Reuse as-is.** |
| teams UPDATE policy | Owner-only — Edit Team needs no RPC |
| team_members DELETE policy | Self-or-owner, owner's own row protected — Remove Member needs no RPC |
| Screens | `teams/index`, `[id]`, `create`, `join`, `challenge`, `challenges`, `offers`, `post-open`, `(tabs)/teams` |
| `get_player_stats(user_id)` | Already takes a user id — the player-profile screen should call it rather than adding anything |

## What the migration added

- `teams.description`, `teams.logo_url`, `teams.home_ground`
- `team_members.role` now allows `vice_captain`. **It is a badge only** — every
  owner-only rule keys off `teams.owner_id`, not the role, and widening that
  would mean re-deriving several policies.
- `get_team_overview(team_id)` — team row + captain name + player count +
  `my_role` + `i_am_owner`. Exists because `teams` is members-only and
  `profiles` is self-only, so a plain select cannot resolve the captain's name.
- `get_team_stats(team_id)` — played / wins / losses / ties / win rate /
  highest / lowest. Counts from `matches.winner_team_id`.
- `get_team_fixtures(team_id)` — upcoming and completed with both innings
  totals and outcome.
- `set_member_role(team_id, user_id, role)` — owner-only; refuses to demote the
  owner. Needed because `team_members` has no UPDATE policy by design.

All are SECURITY DEFINER, revoked from `anon`, and gated on
`is_team_member` / `is_team_owner`.

## Still to build (client only)

1. `app/teams/[id].tsx` → `app/teams/[id]/index.tsx` with four tabs
   (Overview / Players / Fixtures / Stats). The file move is safe: it uses
   path aliases only.
2. `app/teams/[id]/manage.tsx` — owner-only. Edit details, invite, remove
   members, set vice captain. Gate on `i_am_owner` from `get_team_overview`,
   **and** rely on the server rules above — never on the client flag alone.
3. `app/teams/[id]/invite.tsx` — show `invite_code`, WhatsApp share. QR is
   optional; no library is installed.
4. `app/player/[id].tsx` — player profile. Call the existing
   `get_player_stats(in_user_id)`. Do not write a second stats query.
5. `src/features/teams/data/teamProfileRepository.ts` + hooks for the four new
   RPCs, following `challengeRepository`'s stable-error-token pattern.

## Honest notes

- Team stats will read **0** everywhere: there are no innings rows and one
  completed match that predates scoring. That is correct, not broken — build
  the empty states the spec asks for.
- Batting average, strike rate, highest score, economy and best bowling from
  the reference are **not** computable yet. `get_player_stats` returns runs,
  wickets, matches and MVP only. Adding the rest is a real change to the
  scoring read models, not a UI task.
- There is no team-invitation table. Invites are code-only, which is what the
  spec said to keep. The "Invitations" and "Suggested Teams" sections of the
  reference have no backing data and should be omitted rather than faked.
