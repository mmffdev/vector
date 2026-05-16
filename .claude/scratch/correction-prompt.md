# Correction Prompt — Solo-Dev Mode Restoration

**Status:** unpublished, scratch. Not a PLA. Not in `docs/`. Local-only.
**Date drafted:** 2026-05-17
**Purpose:** restore solo-dev velocity without losing the governance infrastructure that will be needed at prod-ready time.

---

## Why this exists (honest framing)

The dev process has hardened beyond what a solo hobby project needs: 7-gate story system, 55 PLA plan files, three parallel indexes, formal feature-area taxonomy, retros-on-demand, scope tracker with 44 in-flight items. Each piece is individually defensible. The aggregate is a process stack heavier than most 20-person teams carry.

Part of why this happened is real: prior agent (me) made serious errors with git operations and HEAD changes — that's the origin of `git stash` ban, the hard rule on destructive commands, the never-assume-DB rule, and several others. Those incident-driven rules are **not** the over-hardening. They stay. They are load-bearing safety rails earned through actual damage.

The over-hardening is the *project management* layer: planning artefacts, scoring metadata, scope tracking, story gates, indexes. Those exist to coordinate humans. There are no humans to coordinate. They are mostly friction with no payoff in a solo hobby context.

This document defines two modes, says what changes between them, and gives a future-session prompt to execute the restoration.

---

## Two modes

### Solo-dev mode (current; default until further notice)
- WIP cap: 5 in-flight items
- Stories: title + acceptance criteria (red-green test). No metadata gates.
- Plans: live as one-line entries in `Vector_Scope.md`. No new PLA files.
- Indexes (story / plan / retro): frozen. Existing entries preserved as archaeology.
- Retros: auto-loop only (loop-detector circuit breaker). Manual `<r>` discouraged; use `lessons.md` one-liner instead.
- Forcing function: one named daily-use slice that you actually use.
- Design exploration: lives outside the repo (`~/Vector-scratch/`).

### Prod-ready mode (future; activated when first external user is committed OR launch dated)
- Full 7-gate `/stories` system
- PLA plan files for cross-cutting work
- All three indexes active and maintained
- Full retro cadence
- Story acceptance gates with 85%/90% confidence thresholds
- All existing infrastructure (PLA files, indexes, taxonomies) re-activated as-is

**Switch trigger:** explicit decision, written into MEMORY.md, dated.

---

## Hard rails — always on, both modes

These do not change. Earned through incidents.

- Human accounts off limits (gadmin/padmin/user@)
- No destructive git without explicit confirmation (reset --hard, push --force, checkout ., restore ., clean -f, branch -D, rebase without review)
- No `git stash` ever (2026-05-16 incident)
- Backend pinned to `dev`
- Never assume a database — trace handler → main.go → routing doc
- CSS/HTML naming convention — propose chain before writing
- Dev-UI primitives `.dui-*` only on `/dev` pages
- Backend-driven validation (no client-side authz)
- Loop-detector auto-retro (circuit breaker)
- File-based ordered SQL migrations
- Bracket-tag commits with scope ref

---

## What we preserve (do NOT delete)

For clean prod-ready re-activation later:

- All 55 existing `dev/plans/PLA-*.json` files
- All `docs/c_*.md` substrate docs
- All `.claude/skills/*/SKILL.md` files (modified, not removed)
- All `.claude/commands/c_*.md` files
- `docs/c_plan_index.md`, `docs/c_story_index.md`, `docs/c_retro_index.md` (marked FROZEN, not deleted)
- All hard rules in `.claude/CLAUDE.md`
- The architecture (Samantha SDK, vector_artefacts, addressables, polymorphic refs, RBAC, shared methods, etc.)
- Tech debt register (`docs/c_tech_debt.md`)
- DB routing doc (`docs/c_c_db_routing.md`)

---

## What we change

| Area | Solo-dev change | Path |
|---|---|---|
| Scope tracker | WIP cap of 5; new `## Parked` section | `Vector_Scope.md` |
| Stories skill | Title + AC only; full gates behind `--full` flag | `.claude/skills/stories/SKILL.md` |
| Plans | No new PLA files; freeze registry | `dev/plans/`, `docs/c_plan_index.md` |
| Indexes | Story + plan indexes marked FROZEN | `docs/c_story_index.md`, `docs/c_plan_index.md` |
| Retros | Auto-loop only; manual `<r>` warns + offers `lessons.md` | `.claude/skills/retro/SKILL.md`, new `lessons.md` |
| Scratch | Design artefacts move out of repo | `~/Vector-scratch/` + `.gitignore` |
| Redesign branch | Fold to main behind flag OR close | `001_redesign` |
| Hooks | Add WIP>5 warning; add stale-untracked warning | `.claude/hooks/` |
| Memory | New rules for solo-dev mode | `.claude/memory/` |
| Forcing function | Name one daily-use slice; pin it | `Vector_Scope.md` |

---

## THE PROMPT — paste this into a fresh session

```
You are restoring solo-dev mode for this Vector repo. Read /Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/.claude/scratch/correction-prompt.md first — it has the full context, what to preserve, and what to change.

Constraints:
- Do NOT delete any PLA file, doc file, skill file, or hard rule.
- Do NOT touch git history, do NOT run any destructive git command without explicit confirmation.
- Do NOT modify human accounts, do NOT change backend env from dev.
- Do NOT proceed with any step that requires a user decision (parking choice, forcing-function naming, redesign-branch fate) without asking me first.

Execute in order. Confirm completion of each step with a one-line summary before moving to the next. Commit after each step using bracket-tag refs.

Step 0 — Read context (no edits):
  - .claude/scratch/correction-prompt.md (this plan)
  - Vector_Scope.md
  - .claude/memory/MEMORY.md and the index entries you'll touch
  - .claude/skills/stories/SKILL.md
  - .claude/skills/scope/SKILL.md
  - .claude/skills/retro/SKILL.md
  - .claude/CLAUDE.md
  Report: count of in-flight items, count of frozen-target indexes, list of dirty/untracked files.

Step 1 — Mode marker:
  Write .claude/memory/feedback_solo_dev_mode.md describing current mode, switch criterion to prod-ready, and the table of what differs.
  Add a one-line index entry in .claude/memory/MEMORY.md.
  Commit: "feat(memory): establish solo-dev mode marker [solo-dev]"

Step 2 — Vector_Scope.md WIP cap:
  Ask me to name the top 5 in-flight items + the one daily-use forcing function.
  Move all other items to a new ## Parked section at the bottom of Vector_Scope.md, preserving every line of content (no information loss).
  Add a ★ FORCING FUNCTION marker on the named slice.
  Commit: "chore(scope): WIP-cap at 5, park the rest [solo-dev]"

Step 3 — Stories skill — collapse gates:
  Edit .claude/skills/stories/SKILL.md so the default (solo-dev) flow requires only title + acceptance criteria (the red-green test). Move the full 7-gate spec under a "Prod-ready mode (--full flag)" heading, preserved verbatim. Update the skill description to reflect the dual mode.
  Commit: "feat(skill): stories — solo-dev mode (title + AC), --full for prod gates [solo-dev]"

Step 4 — Plans freeze:
  Write .claude/memory/feedback_no_new_pla_plans.md — new work in solo-dev mode lives as one-line entries in Vector_Scope.md, not as PLA files. Existing 55 files preserved.
  Edit docs/c_plan_index.md — add a "## FROZEN — solo-dev mode (since 2026-05-17)" header at top. Do not delete any existing entry.
  Add MEMORY.md index entry.
  Commit: "chore(plans): freeze PLA registry for solo-dev mode [solo-dev]"

Step 5 — Indexes freeze:
  Add "## FROZEN — solo-dev mode (since 2026-05-17)" header to docs/c_story_index.md.
  Leave docs/c_retro_index.md as-is for now (Step 6 will handle it).
  Commit: "chore(docs): freeze story index for solo-dev mode [solo-dev]"

Step 6 — Retros — auto only:
  Edit .claude/skills/retro/SKILL.md (or .claude/commands/c_retro.md, whichever is the source of truth): keep the auto-loop entry path (--auto-loop) unchanged; add a guard on manual <r> invocation that warns the user this is heavyweight for solo mode and offers to append a one-line entry to lessons.md instead. Do not block; just warn + offer.
  Create lessons.md at repo root with a short header explaining its purpose.
  Add docs/c_retro_index.md FROZEN header (since retros are downgraded to auto-only).
  Commit: "feat(skill): retro — auto-loop only in solo-dev mode, lessons.md as alternative [solo-dev]"

Step 7 — Scratch artefacts:
  List every untracked file/dir in the repo. For each, ask me whether to:
    (a) move to ~/Vector-scratch/ (default for design exploration)
    (b) commit (if it's actual work)
    (c) delete (if it's stale)
  Add ~/Vector-scratch/ creation step if it doesn't exist.
  Add Vector-scratch/ pattern to .gitignore if any moved-out path is symlinked back.
  Commit (for the .gitignore change only): "chore: gitignore scratch dir [solo-dev]"

Step 8 — Redesign branch decision:
  Run: git log main..001_redesign --oneline (you are on 001_redesign now)
  Run: git diff main...001_redesign --stat
  Present the diff summary and ask:
    (a) fold to main behind a feature flag (recommended if the redesign is converging)
    (b) keep diverged but commit to a merge date this week
    (c) close the branch and selectively cherry-pick the useful commits
  Do NOT act without my explicit choice. Once chosen, execute carefully — no force operations.

Step 9 — Hooks:
  Verify .claude/hooks/loop-detector.sh exists and is wired in settings.json — keep as-is.
  Add a SessionStart hook (or extend the existing one) that:
    - Counts in-flight items in Vector_Scope.md and prints a warning if >5
    - Prints the count of untracked files in the repo root
  Do NOT add stale-detection that requires persistent state across sessions unless it's trivially implementable; defer if it gets complex.
  Commit: "feat(hooks): WIP>5 warning + untracked count on SessionStart [solo-dev]"

Step 10 — Memory updates:
  Write each new memory file referenced above. Confirm MEMORY.md index entries are all present, one line each, under ~150 chars.
  Commit: "feat(memory): solo-dev mode rules [solo-dev]"

Step 11 — Confirmation:
  Re-read Vector_Scope.md and confirm WIP <= 5 with one ★ FORCING FUNCTION pinned.
  Print a final summary: what was changed, what was preserved, where to find the prod-ready re-activation path (this document).

When done: do NOT close out by suggesting more work. Stop. The point of this exercise is to remove process, not add it.
```

---

## Memory entries to be written (reference)

### `.claude/memory/feedback_solo_dev_mode.md`
- Project is in solo-dev mode since 2026-05-17
- Switch to prod-ready mode when first external user committed or launch dated
- Solo-dev mode defaults: WIP 5, stories = title+AC, no new PLAs, indexes frozen, retros auto-only
- Hard safety rails unchanged in either mode

### `.claude/memory/feedback_wip_cap_5.md`
- Vector_Scope.md max 5 in-flight items
- Anything beyond goes to `## Parked`
- If a parked item gets touched, something else must park
- Weekly: anything not moved in 7 days auto-parks

### `.claude/memory/feedback_no_new_pla_plans.md`
- Solo-dev mode: no new `dev/plans/PLA-*.json` files
- New work lives as a one-line entry in Vector_Scope.md
- Existing 55 PLA files preserved as archaeology, not deleted
- Re-enables when prod-ready mode flips

### `.claude/memory/feedback_scratch_outside_repo.md`
- Design exploration, screenshots, ad-hoc seed dumps live in `~/Vector-scratch/`
- Untracked artefacts in the repo root are surfaced on SessionStart and prompted for relocation
- Anything that survives 2 sessions untracked is suspect

### `.claude/memory/feedback_retros_auto_only.md`
- Auto-loop retro (loop-detector circuit breaker) stays
- Manual `<r>` in solo-dev mode warns; default alternative is appending one line to `lessons.md`
- Full retro cadence resumes in prod-ready mode

---

## Re-activation prompt (future, when going prod-ready)

When the time comes to flip back:

```
Flip Vector from solo-dev mode to prod-ready mode. Read .claude/scratch/correction-prompt.md for what was changed during the solo-dev period and reverse each item:
- Unfreeze docs/c_plan_index.md, docs/c_story_index.md, docs/c_retro_index.md
- Remove the --full gating in .claude/skills/stories/SKILL.md so the 7-gate flow is default again
- Remove the WIP-cap warning hook (or raise the cap)
- Update memory: replace feedback_solo_dev_mode.md with a "switched to prod-ready" entry, dated, with the trigger event recorded
- Re-enable manual <r> retros without warning
- Vector_Scope.md keeps its parked items but they may now be unparked
Do not delete any solo-dev-mode artefacts — they are useful for the next solo phase.
```

---

## Honest closing note

The point isn't that the governance you built is wrong. It's that it's *too early*. You designed a process for a 20-person team's worth of code — and then ran it solo against your own labour. That ratio doesn't work. Solo-dev mode isn't a downgrade; it's the right tool for the current stage. Prod-ready mode is the right tool for the next one. Both should exist. This document is the bridge between them.
