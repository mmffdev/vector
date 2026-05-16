---
name: solo-dev-mode
description: Project is in solo-dev mode since 2026-05-17 — WIP cap 5, stories simplified, no new PLAs, indexes frozen, retros auto-only. Hard rails unchanged.
metadata:
  type: feedback
---

Vector is in **solo-dev mode** since 2026-05-17. Process scaffolding designed for a multi-engineer team is dialled down to what one person actually needs. All governance infrastructure preserved as-is for re-activation when prod-ready mode is triggered.

**Why:** Solo hobby project against a single owner; no humans to coordinate. The 7-gate story system, 53 PLA files, three indexes, formal feature-area taxonomy, and 44-item scope tracker were imposing friction without payoff. The dev-process layer drifted toward the shape of a 20-person team. Solo-dev mode rebalances it.

**How to apply:**

- WIP cap **5** items in `Vector_Scope.md`. Anything beyond goes to a `## Parked` section. Touching a parked item requires parking something else.
- Stories: title + acceptance criteria (the red-green test) is enough. The full 7-gate `/stories` flow is behind a `--full` flag.
- Plans: no new `dev/plans/PLA-*.json` files. New work lives as a one-line entry in `Vector_Scope.md`. Existing 53 PLA files preserved as archaeology — not deleted, not renamed.
- Indexes (`docs/c_plan_index.md`, `docs/c_story_index.md`) carry a `## FROZEN — solo-dev mode (since 2026-05-17)` header at the top. No new entries.
- Retros: auto-loop only (loop-detector circuit breaker stays). Manual `<r>` warns and offers to append a one-liner to root `lessons.md` instead. Full retro cadence resumes in prod-ready mode.
- Design exploration and scratch artefacts live in `~/Vector-scratch/`, not in the repo. SessionStart hook surfaces untracked files for relocation.
- One named ★ FORCING FUNCTION pinned at the top of `Vector_Scope.md` — the slice that gets daily use. Everything else must justify itself against keeping it healthy.

**Hard rails (unchanged in either mode):**

- Human accounts off limits (gadmin@/padmin@/user@)
- No destructive git without explicit confirmation
- No `git stash` ever
- Backend pinned to `dev`
- Never assume a database — trace handler → main.go → routing doc
- CSS/HTML naming convention — propose chain before writing
- Dev-UI `.dui-*` primitives only on `/dev` pages
- Backend-driven validation
- Loop-detector auto-retro circuit breaker
- File-based ordered SQL migrations
- Bracket-tag commits with scope ref

**Switch criterion to prod-ready:** explicit decision, written into MEMORY.md, dated — triggered by the first external user being committed OR a launch date being set. Re-activation path documented in `.claude/scratch/correction-prompt.md` (the bridge document).

Related: [[wip-cap-5]], [[no-new-pla-plans]], [[scratch-outside-repo]], [[retros-auto-only]], [[never-git-stash]], [[never-change-passwords]], [[dev-only]], [[never-assume-database]].
