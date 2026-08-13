# P24 — Product Roadmap

**Date:** 5 August 2026 · **Basis:** the six goals stated by the product owner on
5 Aug, mapped against `MatchUp_Phase1/2/3_Requirements.docx`, the live database,
and the current codebase.

This document exists because the six goals span all three planned phases. It
names what is done, what each remaining goal actually costs, and — more
importantly — which ones are **blocked by a dependency rather than by effort**.

---

## The six goals, mapped

| # | Goal | Status | Spec home |
|---|---|---|---|
| 1 | User logs in and makes a profile | **Done** | Phase 1 |
| 2 | View matches posted by others, join them | **Done** | Phase 1 |
| 3a | Create own team | **Done** (5 Aug) | not in any phase doc |
| 3b | Challenge another team | **Done** (backend 5 Aug, client since built) | not in any phase doc |
| 4 | Team posts a challenge, system finds an opponent | Not started | **FR-201**, Phase 2 |
| 5 | Profile with performance, match history and grade | Not started | **FR-206 + FR-207**, Phase 2 |
| 6a | In-app toss | Not started | **FR-204**, Phase 2 |
| 6b | Ball-by-ball + individual scores (CricHeroes-style) | Not started | **FR-301**, Phase 3 |

Goals 4, 5 and 6 are Phase 2 and Phase 3 work. `CLAUDE.md` lists the matching
engine and the computed reliability score under "NOT in Phase 1".

---

## The dependency chain

This is the part that matters more than the estimates.

```
push notifications  →  matches actually fill  →  attendance gets marked
                                                        │
                                                        ▼
                                          reliability grade becomes meaningful
```

Nothing in that chain is optional, and it starts with a thing that does not
exist. There is no `supabase/functions/` directory, no FCM device registration,
and no writer for the `devices` table. Realtime join popups only fire while the
app is open and foregrounded, so an organiser with the app closed never learns
that someone asked to join.

**Update, 8 August 2026.** The chain above is no longer broken at the first
link. `supabase/functions/notify-wave/` and the `notification_jobs` queue exist,
the triggers are applied and verified, and the client registers devices. Three
non-code steps remain before a phone actually buzzes — see
[`docs/PUSH_NOTIFICATIONS.md`](docs/PUSH_NOTIFICATIONS.md). The Edge Function
infrastructure FR-206 depends on now exists.

### Why goal 5 cannot be built yet

Production data on 5 Aug 2026:

```
players 3 · matches 7 · completed 1 · confirmed 3 · attendance rows 1 · teams 1
```

FR-206 defines the grade as "based on my attendance history". One attendance
record, across three accounts that all belong to the same person, is noise. The
feature would ship and display a meaningless number.

FR-206's own NFR adds: *"Reliability score computation is server-only; no client
write path exists to profiles."* That requires an Edge Function, and there are
currently none — so building push notifications also builds the infrastructure
goal 5 depends on.

### Why goal 6b is the largest item in the set

FR-301 is **dual-entry** scoring: *"the match result to be recorded ball-by-ball
by two independent scorers, so that neither side can unilaterally misreport the
outcome."* Its NFR requires *"scorecard reconciliation and finalisation logic
runs server-side; neither scorer's client can force a result."*

That means an innings/over/ball data model, two live clients, conflict
reconciliation, and a server authority. It is a product in itself, not a screen.

A single-scorer cut-down version is possible in days rather than weeks, but it
is explicitly **not FR-301** — one scorer is trusted, which is the exact property
FR-301 exists to prevent. Building it means rebuilding it later.

---

## Recommended order

1. **Team challenge client** — finishes 3b. Backend is applied and verified.
2. **Push notifications** — FCM registration, `devices` writer, `notify-wave`
   Edge Function. Unblocks the chain above and creates the Edge Function
   infrastructure FR-206 needs.
3. **CAPTCHA + MSG91/DLT** — launch gates from `PRODUCTION_PLAN.md`. DLT has a
   1–2 week external approval lead time; start the paperwork early.
4. **RLS smoke tests in CI** — the security model is entirely RLS and it changed
   substantially on 3 and 5 Aug. Nothing currently re-checks it.
5. **Toss (6a)** — FR-204, small and self-contained once matches are being played.
6. **Match history (FR-207)** — the honest half of goal 5. Shows real past
   matches and attendance outcomes without inventing a grade.
7. **Reliability grade (FR-206)** — only once real attendance data exists.
8. **Matching engine (4, FR-201)** — `PRODUCTION_PLAN.md`: do not build before
   density data. With three players there is nothing to match.
9. **Ball-by-ball scoring (6b, FR-301)** — last, and scoped as its own project.

---

## Rough sizing

| Item | Estimate | Blocked by |
|---|---|---|
| Team challenge client | ~~1 day~~ **done** | — |
| Push notifications | ~~3–4 days~~ **built 8 Aug** | EAS project id + deploy |
| CAPTCHA | ~half day | — |
| MSG91 + DLT | ~1 day work, 1–2 weeks approval | external |
| RLS tests in CI | ~1 day | — |
| Toss (FR-204) | ~1 day | matches being played |
| Match history (FR-207) | ~1 day | — |
| Reliability grade (FR-206) | ~3 days | real attendance data |
| Matching engine (FR-201) | ~1 week | player density |
| Ball-by-ball (FR-301) | 3–4 weeks | everything above |

Sum of goals 4, 5 and 6 alone is roughly 6–7 weeks. Push notifications is 3–4
days and unblocks most of the rest.
