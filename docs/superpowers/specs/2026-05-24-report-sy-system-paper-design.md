# `<report> -sy` — System paper

**Date:** 2026-05-24
**Status:** Approved, ready for implementation

## Synopsis

Add a 7th report type (`system`) to the Dev → Reporting page and a new `-sy` flag to the `<report>` skill. A System paper is a developer-facing explainer of a section/feature of the codebase — what it is, how it works, what depends on it, its I/O contract, and how to integrate. First subject: Sentinel.

## Problem

The existing six `<report>` flags cover research (`-r`), codebase audits (`-b`), security audits (`-s`), dependency traces (`-c`), retros (`-retro`), and plans (`-p`). None of them produce a *teach-this-system* artefact: a paper a new developer can read to understand a feature end-to-end before integrating with it.

Sentinel — the system this paper will first describe — is the obvious test case: it has rich documentation in `docs/Security/Sentinel/` and a large surface area (`app/sentinel/` + `backend/internal/sentinel/`), and the existing docs are organised for the people who built it, not for a developer integrating against it.

## Approach

Extend the existing `dev_reports` schema and `<report>` skill rather than building a parallel system. Add `system` to the CHECK constraint, the Go `ValidTypes`, the TS `DevReportType` union, and the UI tab list. Add an `-sy` flag to the skill with its own AUDIT BRIEF and section template. Reports get the `SY###` ID prefix.

The skill takes a free-form topic and an optional `--source <path>` flag. When `--source` is given the agent scopes its reading to that subtree (but may still cross-reference code paths that subtree's docs mention). When omitted, the agent runs repo-wide `Grep`/`Glob` against the topic keywords.

**Why not its own table or skill?** The Dev → Reporting page is already the universal report viewer. The TOC scroll-spy, the dev-UI primitives, and the upsert/change-log machinery all just work as long as the report follows the section-template contract. Adding a 7th type is six files plus one migration; building a parallel surface would be ten times the change for no benefit.

## Areas Impacted

- **DB (mmff_dev):** New migration `003_dev_reports_add_system.sql` drops the `dev_reports.type` CHECK constraint and re-adds it with `'system'` included. DOWN migration reverses the change (will fail loudly if any `system` rows exist when run — by design).
- **Backend (Go):** `backend/internal/devreports/types.go` — append `"system"` to `ValidTypes`.
- **Frontend (TS contract):** `app/lib/apiSite/index.ts` — add `| "system"` to the `DevReportType` union.
- **Frontend (UI):** `dev/pages/DevReportingPanel.tsx` — add `{ value: "system", label: "System" }` to `TYPE_TABS`, placed after `code` and before `security`.
- **Skill:** `.claude/skills/report/SKILL.md` — add `-sy` row to the Flags table, add `system` row to the Section Templates table, add full `## -sy — System paper` section with AUDIT BRIEF, update the `argument-hint` frontmatter line.
- **Index:** `.claude/CLAUDE.md` — update the one-line `<report>` summary to mention `-sy`.

## Implementation Steps

### Phase 0 — Schema

1. Write `db/mmff_dev/schema/003_dev_reports_add_system.sql` — UP migration that drops the existing CHECK constraint and re-adds it with `'system'` included; inserts the schema_migrations row.
2. Write `db/mmff_dev/schema/down/003_dev_reports_add_system_DOWN.sql` — DOWN migration reversing the change.
3. Apply the migration against dev (`mmff_dev` on the dev pool) and verify `schema_migrations` row exists.

### Phase 1 — Backend

4. In `backend/internal/devreports/types.go`, append `"system"` to `ValidTypes`.
5. Restart the Go server (`:5100`) and confirm a POST with `"type": "system"` no longer returns a validation error.

### Phase 2 — Frontend

6. In `app/lib/apiSite/index.ts`, extend `DevReportType` to include `"system"`.
7. In `dev/pages/DevReportingPanel.tsx`, insert `{ value: "system", label: "System" }` into `TYPE_TABS` after the `code` entry.

### Phase 3 — Skill

8. Update `.claude/skills/report/SKILL.md`:
   - Frontmatter `argument-hint`: add `| -sy [--source <path>] "<topic>"`.
   - Frontmatter `description`: update the verb list to include the System paper.
   - Flags table: add an `-sy` row with `ID prefix: SY###`, type `system`.
   - Section templates table: add a `-sy` row with the 10 canonical slugs (synopsis · purpose · architecture · components · io-contract · how-to-use · examples · constraints · backlog · change-log).
   - New top-level section `## -sy — System paper` containing: Arguments block, Behaviour block, AUDIT BRIEF (verbatim), Output format markdown listing, After-the-audit POST contract.

9. Update `.claude/CLAUDE.md` (the `<report>` skill one-line summary) to add `-sy` to the flag list.

### Phase 4 — Verification (the Sentinel paper)

10. Run the first end-to-end test:
    ```
    <report> -sy --source docs/Security/Sentinel/ "explain how sentinel works end-to-end so a developer understands its function, requirements, I/O, and how to use it"
    ```
11. Verify the paper appears on `/dev/reporting` under the new System tab with ID `SY001`, all 10 required sections present, TOC scroll-spy working.

## Section Template (locked)

Every System paper MUST have these `<h2 id>` sections in this order:

```
## Synopsis        id="synopsis"        2–4 sentences: what this is + headline + top takeaway
## Purpose         id="purpose"         problem solved, who/what depends on it
## Architecture    id="architecture"    layers, key files, data flow
## Components      id="components"      named parts + responsibilities (sub-system map)
## I/O Contract    id="io-contract"     inputs, outputs, side effects, error modes
## How to Use      id="how-to-use"      call patterns, do/don't, integration points
## Examples        id="examples"        concrete code or wire snippets
## Constraints     id="constraints"     invariants, caveats, known limits, gotchas
## Backlog         id="backlog"         in-flight work + tech debt against this system
## Change Log      id="change-log"      newest first
```

Free rein between/inside required sections (additional `<h2>` or `<h3>`). Missing-section discipline (per existing skill contract): emit `<p><em>Not applicable for this system.</em></p>` stub rather than skip — TOC consistency is non-negotiable.

## Invocation Contract

```
<report> -sy [--source <path>] "<topic text>"
```

- `<topic text>` — free-form, quoted. Framing: "explain how X works end-to-end so a developer can integrate".
- `--source <path>` — optional. Pins the agent's documentation reading to one directory or file (e.g. `docs/Security/Sentinel/`). Default: repo-wide `Grep`/`Glob` driven by topic keywords.
- When `--source` is given, the agent stays inside that subtree for *documentation* but may still read source code that the subtree's docs reference (e.g. `app/sentinel/` if the docs mention it).
- Agent decides which files inside the source to draw from based on topic phrasing.

## POST Contract

```json
{
  "id": "SY###",
  "type": "system",
  "title": "<system name + one-line framing>",
  "category": "<domain area, e.g. 'Identity & Scope', 'Auth', 'Visualisation'>",
  "topic": "<the topic text from the invocation>",
  "summary": "<Synopsis text>",
  "content": "<HTML body matching the section template>",
  "report_date": "YYYY-MM-DD"
}
```

## Risks

- **DOWN migration brittleness.** If `system` rows exist when DOWN runs, the re-added CHECK constraint will fail. This is intentional — the operator must delete or retype the rows first. Documented in the DOWN migration header.
- **Tab ordering churn.** Inserting `System` between `code` and `security` shifts visual position. Acceptable — `TYPE_TABS` is the only source of truth and existing tabs keep their `value`s.
- **Out of scope:** the empty-state hint at `dev/pages/DevReportingPanel.tsx:444-446` still names retired skills (`/research`, `/sec`, etc.). Pre-existing rot, not this task's job to fix.

## Verification

- **DB:** `\d dev_reports` against the dev `mmff_dev` database (via the standard `:5435` tunnel) shows the new CHECK constraint including `'system'`.
- **Backend:** `grep ValidTypes backend/internal/devreports/types.go` shows `system` in the slice.
- **Frontend:** `npm run lint` passes; the `/dev/reporting` page renders the new "System" tab between "Codebase" and "Security".
- **Skill:** running `<report> -sy --source docs/Security/Sentinel/ "..."` (the Sentinel test) produces a `SY001` row in `dev_reports`, visible under the System tab, with all 10 required sections.
- **Negative test:** the DOWN migration applies cleanly against a fresh database with no `system` rows; fails loudly with `system` rows present.

## Change Log

- **2026-05-24** — Initial spec.
