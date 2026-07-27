# P24

Mobile community platform for organising casual **Box Cricket** and **Badminton (Shuttle)**
matches with nearby players. Built with React Native + Expo and Supabase. iOS + Android,
Android-first.

This repository is the **Phase 1 (Prove the Loop)** scaffold. See
`MatchUp_Architecture_and_Structure.docx` and `MatchUp_Phase1_Build_Plan.docx`.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Align native package versions to the installed Expo SDK
npx expo install --fix

# 3. Configure environment
cp .env.example .env        # then fill in your Supabase URL + anon key

# 4. Run (scan the QR with Expo Go, or use a dev build)
npm start
```

### Database (Supabase)

```bash
# Requires the Supabase CLI: https://supabase.com/docs/guides/cli
supabase start                                  # local stack
supabase db reset                               # apply migrations in supabase/migrations
npm run db:types                                # regenerate src/shared/types/database.types.ts
```

Migrations:

- `supabase/migrations/0001_phase1_schema.sql` — tables, PostGIS, `nearby_matches` RPC
- `supabase/migrations/0002_phase1_rls.sql` — Row-Level Security on every table
- `supabase/seed.sql` — sample venues for local dev

## Project layout

```
app/          Expo Router routes (screens)
src/
  core/       infrastructure (Supabase client, auth, storage, config, logging…)
  features/   feature modules (auth, profile, matches, players, attendance…)
  shared/     ui, theme, hooks, utils, types
  app-providers/  React Query + Auth + analytics providers
supabase/     migrations, functions, seed
```

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start Expo dev server |
| `npm run android` / `ios` | Launch on a device/emulator |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:types` | Regenerate Supabase types |

## Conventions

Clean Architecture per feature (`presentation → domain → data`); the UI never calls Supabase
directly. Access control is enforced server-side via RLS. See `CLAUDE.md` for the full rule set.
