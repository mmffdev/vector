---
name: no-new-pla-plans
description: Solo-dev mode rule — no new dev/plans/PLA-*.json files; new work lives as a one-line entry in Vector_Scope.md. Existing 53 PLA files preserved as archaeology.
metadata:
  type: feedback
---

In **solo-dev mode** (since 2026-05-17), no new `dev/plans/PLA-*.json` files. New work is captured as a one-line sub-item under the relevant theme in `Vector_Scope.md` via `/stories` (solo-dev mode default — title + AC only).

**Why:** The 53 existing PLA files were built for a multi-engineer team's coordination needs — `tracker_group` provisioning, feature_test parity, RFC-style scope/value sections, acceptance_criteria tables, risk register entries. In a solo hobby project against a single owner, that ceremony was friction without payoff. A line in `Vector_Scope.md` does the same job: name the thing, name how you'll know it's done, ship it. The whole cycle fits a single commit, no JSON to maintain.

**How to apply:**

- When a new piece of work appears, default to a `Vector_Scope.md` sub-item (`/stories` without `--full`). Do NOT scaffold a `PLA-NNNN.json`.
- The existing 53 files are **preserved as archaeology**. Do not delete, rename, or "tidy". They remain readable in the Plans tab; they remain referenced by every story already shipped. They are the dev history of how Vector got here.
- `docs/c_plan_index.md` carries a `## FROZEN — solo-dev mode (since 2026-05-17)` header at the top. The `Last issued` counter is **paused** at PLA-0055. The registry table is not extended.
- If you find yourself wanting a PLA file because the work feels "too big for a scope line", that is a signal — either (a) split the work into smaller scope sub-items, or (b) the work doesn't fit solo-dev mode at all and should wait for prod-ready.
- **Prod-ready re-activation** (when first external user is committed or launch dated): remove the FROZEN header from `c_plan_index.md`, resume the counter from PLA-0056, switch `/stories` default back to `--full`.

**Edge cases:**

- **Existing PLA file gets a new acceptance criterion or sub-task in solo-dev mode** — fine to extend in place; the file isn't "frozen" as immutable, just no NEW files. Adding a row to PLA-0048's `work_item_backlog` is OK if the work is a direct continuation of that plan.
- **Refactor crossing multiple themes** — still a scope sub-item, but flagged in the title so it's obvious. Don't promote to PLA just because it has more than one touchpoint.
- **`<addpaper-stories>`** still creates work — but each piece of work lands in scope (or as an extension to an existing PLA), not as a new PLA.

Related: [[solo-dev-mode]], [[wip-cap-5]], [[stories-shortcut-mandatory]], [[scope-commit-bracket-ref]].
