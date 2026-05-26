# Agent Handover — Artefact Dependencies (PLA063 / DEP1)

**Date:** 2026-05-25
**Branch:** `main`
**Last commit (pre-DEP1, context only):** `94533500` — `fix(sentinel): ErrNoWorkspace message + wire detail cover the no-grants case`
**Page to validate against:** `http://localhost:5101/work-items?meg=ae2d4ff5-4c8d-4839-af89-7769067476ae`
**Surface:** `<ArtefactInlineForm>` (the edit form that pops down inside `<ObjectTreeDetailFlyout>`) — specifically the **Dependencies** action-bar button that is currently wired-but-empty.
**Status:** **Planning landed, zero code written.** Plan PLA063 filed in `dev_reports` (Plan tab), 12 stories under new top-level **DEP1** theme in `Vector_Scope.md`, 12 refs registered in `.claude/scope-refs.map`. Next agent's first action is DEP1.0.1 (schema migration), not "decide what to build".

> **Read-before-acting:** the plan deliberately departs from Rally on the allow-matrix (Vector admits Defect as a first-class dependency endpoint) and adds DB-level cycle prevention that Rally doesn't document. Do not "correct" these toward Rally parity — they're intentional differentiators for the defence/finance buyer profile. See § What is DONE for rationale.

---

## What this surface is for

The action bar on `<ArtefactInlineForm>` exposes Duplicate / Add Tasks / **Dependencies** / Discussion / History / Delete. Only Duplicate and Delete are real. The Dependencies button at [`app/components/ArtefactInlineForm/ArtefactInlineForm.tsx`](../app/components/ArtefactInlineForm/ArtefactInlineForm.tsx) line 248-254 currently calls an `onDependencies` callback prop that no host passes in — clicking does nothing.

DEP1 ships a Rally-faithful **Predecessors / Successors** model behind that button:

- **Expand-in-place** below the form's body grid — not a flyout, not a modal.
- **Form-wide mode recolour** — opening Dependencies puts the whole form into a new `--dependencies` mode (purple background, white foreground). This **generalises** the existing `_Head--deleting` / `_Head--duplicate` modifiers by lifting them up from `_Head` to `Container` so all three modes share the form-wide recolour pattern. New leaf doc `docs/c_c_inline_form_modes.md` will capture this.
- **Action-bar active state** — the Dependencies button takes a new shared `_Actionbar_Btn--active` modifier when the section is open (reusable by future toggle-style actions).

Substrate is a new `artefact_dependencies` table in `vector_artefacts` (substrate confirmed via `docs/c_c_db_routing.md` — `vaPool`, not `pool`) with a BEFORE-INSERT trigger that prevents cycles via recursive-CTE walk. New Go package `backend/internal/artefactdependencies/` mounted on both `/_site` and `/samantha/v2` per PLA-0039 transport segregation, sentinel-clamped throughout.

---

## Where everything that exists today lives

### Authoritative artefacts written this session

- **Plan:** PLA063 on `/dev/reporting → Plan tab`. Synopsis, Problem, Approach, 7-phase Implementation Steps, Proposed Stories, Risks, Verification, Change Log. **This is the source of truth** for what to build and why — read it before coding.
- **Scope entries:** [`Vector_Scope.md`](../Vector_Scope.md) line 9418 → new top-level **DEP1. Artefact Dependencies (PLA063)** theme with 12 stories across 7 sub-sections (DEP1.0 → DEP1.7). All `[P2] 🔵 IN FLIGHT`. Every story keeps a multi-bullet AC list as a nested sub-list — those AC bullets are the verifiable contract, not chrome.
- **Commit-note routing:** [`.claude/scope-refs.map`](../.claude/scope-refs.map) — 12 new lines (300 → 312). Keywords drawn from title + every AC bullet, so a commit naming any column / sentinel error / endpoint will route to the right ref. Prefer explicit `[DEP1.x.y]` bracket tags in commit messages for accuracy.
- **Plan-mode scratch (background only):** `/Users/rick/.claude/plans/rustling-giggling-pretzel.md` — the in-session brainstorming plan, superseded by PLA063. Don't re-read; PLA063 is canonical.

### Files that will be modified (none touched yet)

- `db/vector_artefacts/schema/NNN_artefact_dependencies.sql` + `down/NNN_*_DOWN.sql` — schema + trigger (NNN to be picked by `<migration>` skill).
- `backend/internal/artefactdependencies/` (new package) — `doc.go`, `types.go`, `sql.go`, `service.go`, `handler.go`, `service_test.go`, `handler_test.go`, `crossdb_test.go`.
- [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) — register `artefactdependencies.NewService(vaPool, …)`; mount handler on both transport surfaces.
- [`app/components/ArtefactInlineForm/ArtefactInlineForm.tsx`](../app/components/ArtefactInlineForm/ArtefactInlineForm.tsx) — replace loose `confirmingDelete` + `isDuplicate` booleans with a single `mode: 'default' | 'dependencies' | 'duplicate' | 'deleting'` enum; lift modifier from `_Head` to `Container`; drop `onDependencies` prop after wiring.
- [`app/components/ArtefactInlineForm/types.ts`](../app/components/ArtefactInlineForm/types.ts) — drop `onDependencies` prop type.
- `app/components/ArtefactInlineForm/DependenciesSection.tsx` (new), `useDependencies.ts` (new), `ArtefactDependencyPicker.tsx` (new).
- [`app/globals.css`](../app/globals.css) — `Container--dependencies` + `_Dependencies*` chain (10 selectors) + shared `_Actionbar_Btn--active` modifier.
- `docs/c_c_artefact_dependencies.md` (new), `docs/c_c_inline_form_modes.md` (new), [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) (two pointers added).
- [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — three `TD-DEPS-*` entries (RISK-TYPE, CROSS-SCOPE, BLOCKED-ROLLUP-COMPUTED).

### Files that informed the plan (read-only context)

- [`app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout.tsx`](../app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout.tsx) — host of the inline form. Confirmed it doesn't pass `onDependencies` today; section is self-contained inside the form, so no changes needed here.
- [`db/vector_artefacts/schema/005_artefacts.sql`](../db/vector_artefacts/schema/005_artefacts.sql) — `artefacts` table; PK `artefacts_id`, tenant `subscription_id`, workspace `workspace_id`, type `artefact_type_id`, soft-delete `archived_at`. Two new FKs hang off this table.
- [`db/vector_artefacts/schema/003_artefact_types.sql`](../db/vector_artefacts/schema/003_artefact_types.sql) + [`010_seed_system_artefact_types.sql`](../db/vector_artefacts/schema/010_seed_system_artefact_types.sql) — types are identified by `prefix` (Story=US, Defect=DE, Task=TA, Epic=EP, Risk=RSK). Allow-matrix enforcement reads these prefixes.
- [`backend/internal/artefactitems/`](../backend/internal/artefactitems/) — registered twice in `main.go` (work + strategy scope). The search endpoint (DEP1.2.1) extends this package; the new dependencies package follows the same handler/service/sql.go layering.
- [`backend/internal/lintchecks/sentinel_clamp_test.go`](../backend/internal/lintchecks/sentinel_clamp_test.go) — already covers any new package touching `artefact_*` tables. Add the new package to its set if needed.
- **Rally research (this session, in-memory):** Predecessors/Successors are bare reciprocal collections, no per-edge attributes; Rally restricts to Story↔Story / Story↔portfolio-item; cross-project allowed within workspace; cycle detection undocumented; `Blocked` is manually set with display-only rollup. Vector v1 follows all of this **except** the type matrix (admits Defect) and cycle detection (we prevent at write time).

---

## What is DONE

**Planning only — code count is zero.**

- ✅ **Discovery / Phase-1 sweep** — confirmed no existing edge tables in `vector_artefacts`, no existing dependency naming in domain code (the "successor" hits in `backend/internal/auth/service.go` are session-rotation, unrelated), no existing search-to-link primitive to reuse. Clean slate.
- ✅ **Rally research** — fetched Broadcom TechDocs via web sub-agent; six axes (data model, cross-type rules, cross-project rules, cycle detection, computed state, UX pattern) summarised in the plan's Problem section.
- ✅ **PLA063 filed** — full plan POSTed to `/_site/admin/dev/reporting/`; visible on Plan tab. Synopsis through Change Log, every required section per the report template, three TD-DEPS-* deferrals named with triggers.
- ✅ **DEP1 theme added to scope** — `Vector_Scope.md` line 9418; TOC entry at line 79; `Doc version` 2.55 → 2.56; `Last updated` notes the addition. All 12 stories with full AC sub-lists preserved verbatim.
- ✅ **scope-refs.map updated** — 12 keyword lines appended (line 300 → 312). Commit-note hook will auto-route.

## Where to pick up next

Recommended order — each phase verifies before the next starts (per the "diagnose with DB and code, not the user" hard rule):

1. ⏭️ **DEP1.0.1 — Schema (vector_artefacts).** Use the `<migration>` skill: it picks the next NNN, scaffolds with the project's header + BEGIN/COMMIT, dry-runs, applies, verifies `schema_migrations`. Hand the skill **`vector_artefacts`** as the target DB — never assume. Verify with `psql -d vector_artefacts -c '\d artefact_dependencies'` and the cycle smoke (`INSERT A→B; INSERT B→A;` → expect `ARTEFACT_DEPENDENCY_CYCLE`).
2. ⏭️ **DEP1.1.1–3 — Backend service.** Scaffold `backend/internal/artefactdependencies/` following the canonical layering. Sentinel-clamp every read and write via `sentinel.WorkspaceIDFromCtx(ctx)` (the lint test will fail otherwise). Mount on `/_site` AND `/samantha/v2` in `main.go`.
3. ⏭️ **DEP1.2.1 — Search endpoint.** Lives in whichever package owns `/artefacts` reads today (likely `artefactitems`). Workspace-clamped. The `exclude_linked_to` filter is the only non-obvious bit — single LEFT JOIN against `artefact_dependencies` removes both directions.
4. ⏭️ **DEP1.3.1 → DEP1.4.3 — Frontend layers.** Data layer first (helpers + hook), then mode-enum refactor on the inline form, then the section, then the picker. The mode-enum refactor (DEP1.4.1) is a precondition for DEP1.4.2 — don't try to mount the section without the mode state in place.
5. ⏭️ **DEP1.5.1 — Playwright.** Spec is at `dev/tests/playwright/dependencies-section.spec.ts`; run against `localhost:5101`.
6. ⏭️ **DEP1.6.1 + DEP1.7.1 — Docs + tech-debt.** Close out with the two new `c_c_` leaves, the two CLAUDE.md pointers, and the three `TD-DEPS-*` entries.

## Known caveats

- **The work-scope quadrant is the v1 ceiling.** Story↔Story / Story↔Defect / Defect↔Defect only. **Do not** add Task / Risk / Strategy support without re-opening the design — they're deferred behind `TD-DEPS-RISK-TYPE` and `TD-DEPS-CROSS-SCOPE` with named triggers. The allow-matrix enforcement lives in the Go service so the matrix can evolve without a migration.
- **Cycle prevention is a Vector differentiator, not Rally parity.** The BEFORE-INSERT trigger is the actual gate; the service-layer pre-check exists only for a friendlier 4xx + UI inline error. Both must ship — pre-check alone has a race window, trigger alone gives bad UX.
- **`Blocked` stays manual.** v1 mirrors Rally — predecessor `Blocked` flag bubbles up as a display-only badge dot on the successor row. **Do not** add auto-flip of `is_blocked` based on predecessor state. That's `TD-DEPS-BLOCKED-ROLLUP-COMPUTED`, deferred until first customer asks.
- **Column-prefix naming applies (RF1.4.4).** Every column on the new table is prefixed `artefact_dependencies_*`. Same pattern as `users_sessions_*`. Don't shortcut to bare `predecessor_id` — the project's naming convention pinned in `docs/c_c_naming_conventions.md` rejects it.
- **Form-wide recolour is a refactor, not a one-off.** DEP1.4.1 lifts the existing `_Head--deleting` / `_Head--duplicate` modifiers up to `Container` AND adds `--dependencies`. The three modes are mutually exclusive — opening Dependencies must cancel an active delete-confirm and vice versa. Unit test pins this.
- **Inline picker, not modal.** The "Add predecessor" / "Add successor" picker mounts inline below the section header. Resist the urge to ship a modal — it breaks the expand-in-place ethos of the form.
- **`onDependencies` prop gets deleted, not deprecated.** Phase-1 sweep confirmed zero consumers pass it today. Drop it from the component signature AND from `types.ts` in the same commit as the mode-enum refactor. Backwards-compat shim would be dead code on day one.
- **Search endpoint cost.** Free-text over `artefacts.title` at workspace scale needs an index. v1 uses trigram (`pg_trgm` if available) or `ILIKE` + order-by-recency-limit-50. Promote to full-text only if profile shows it. Workspace clamp keeps the scan bounded either way.
- **WIP-cap overflow.** SessionStart digest flagged 7 themes in-flight against a cap of 5 BEFORE adding DEP1 (now 8). User OK'd the add but didn't park anything. Worth a `<scope> -r` pass to either close completed themes or park one before deep work begins — but that's a separate move.

## How to verify (end-to-end, after all phases land)

1. Start backend (`<server>` is pinned to `dev` per CLAUDE.md hard rule — do not change) and `<npm>`.
2. Open `http://localhost:5101/work-items?meg=ae2d4ff5-4c8d-4839-af89-7769067476ae`.
3. Pick a Story. The inline form pops down.
4. Click **Dependencies**. Assert the whole form goes purple-on-white (DOM contains `artefact-inline-form__Container--dependencies`) and the Dependencies button highlights (`_Actionbar_Btn--active`).
5. Click "+ Add predecessor", type a few characters into the picker, pick a result. Assert a row appears in the Predecessors column.
6. Click that row → assert navigation to `/work-items/<key>`.
7. Open the linked artefact. Assert reciprocity: the original Story now appears in the Successors column.
8. Attempt to add the original Story back as a successor of its predecessor → assert inline cycle error, no row added.
9. Remove a row via confirm-on-click (single click arms, second click within 3s commits). Assert row disappears; re-add succeeds (partial-unique-index allows re-add after archive).
10. Run `go test ./backend/internal/artefactdependencies/...`, `npm run test`, and the Playwright spec — all GREEN.
11. Run `npm run lint`, `npm run lint:no-direct-workspace-id`, `npm run lint:no-old-context-imports` — all GREEN.

For wire-contract checks, **always go DB + code first** before asking the user to click anything (HARD RULE):

```bash
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" \
  "http://localhost:5100/_site/artefacts/<artefact_id>/dependencies"
```

## Suggested skills for the next session

- **`<read>`** — load this handover as the active session pin first thing.
- **`<migration>`** — DEP1.0.1 schema work. Hand it `vector_artefacts` explicitly.
- **`<scope> -r`** — surface the WIP-cap overflow + flag DEP1.0.1 as the next move; ideally do this before deep coding.
- **`<scope> -u`** — after each story lands, mark it ✅ with the commit SHA. Commit-note hook will auto-append the commit reference to the matching DEP1.x.y entry via the scope-refs.map keywords.
- **`<update> -c artefactdependencies`** + **`<update> -c ArtefactInlineForm`** — when the Dev → Components page needs the new pieces documented (DEP1.6.1).
- **`<report> -s`** — once the surface is live, run a full security audit pass to capture the SOC2 / defence-finance narrative (workspace clamp + Sentinel resolution + cycle prevention) in a SEC### report. The `doc.go` of the new package already names those three controls.
- **`<diagnose>`** — if the cycle trigger behaves unexpectedly during the schema phase. The recursive CTE walk can be subtle on large graphs.

## Pointers (do not re-derive)

- Plan body: `/dev/reporting` → Plan tab → PLA063.
- Scope: [`Vector_Scope.md`](../Vector_Scope.md) line 9418 (DEP1 section), line 79 (TOC entry).
- DB routing: [`docs/c_c_db_routing.md`](../docs/c_c_db_routing.md) — `vector_artefacts` → `vaPool`.
- Naming convention: [`docs/c_c_naming_conventions.md`](../docs/c_c_naming_conventions.md) — column-prefix rule.
- Sentinel rules: [`docs/Security/Sentinel/sentinel_docs.md`](../docs/Security/Sentinel/sentinel_docs.md) — the HARD RULE that `app/sentinel/` and `backend/internal/sentinel/` are the sole identity/scope owners.
- Transport segregation: [`docs/c_c_transport_segregation.md`](../docs/c_c_transport_segregation.md) — `/_site` + `/samantha/v2`.
- CSS naming: [`.claude/memory/css_naming_convention.md`](../.claude/memory/css_naming_convention.md) — the `root-block__Container_Child_leaf` pattern.
