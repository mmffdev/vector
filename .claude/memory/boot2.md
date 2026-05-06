---
name: Session bootup — R042 v1.0.5 gap closure + WorkItemsTree feature matrix
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 42c545a3-877a-4cfa-b162-d074f5c80f22
---
## Current state (last updated: 2026-05-06)

**Active branch:** `main`
**Story index last issued:** `00444`
**Phase:** PH-0005 (post PLA-0013 dev-UI migration; ResourceTree spec work pre-implementation)

---

## Planka card states

**In progress / Doing:**
- None — session was research/spec work on R042, not code

**Completed (committed, move to Completed in Planka):**
- None this session — no story-cards moved through the lifecycle

**Parked:**
- DnD-wired Work Items tree code → `reference/dnd_tree.tsx` (recovered from `b0d8e4a`, untracked, excluded from tsc)

---

## Uncommitted on branch

Working tree is **clean** vs HEAD. Untracked files only:
- `reference/` — parked DnD tree reference (intentional; not for commit)
- `CGL.bak/`, `Claude Global.bak/` — backup dirs (intentional; not for commit)
- `backend/.env.production.locked`, `backend/.env.staging.locked` — locked env stubs (intentional; not for commit)

**8 commits ahead of `origin/main`** — none pushed yet.

---

## What shipped this session

- **R042.json v1.0.0 → v1.0.5** — full Section 0 with 28-row WorkItemsTree feature matrix, 11-item Vector advantages list (3 added this session), implementation sequence, prop-set architecture, versioning footnote
- **§14 closures** — five gaps rewritten as sub-sections (14.1 rank inferred / 14.2 ExtJS modern delta / 14.3 column-state two-layer / 14.4 paste contract / 14.5 Rally internals mostly internal-only)
- **Architectural decisions baked in:**
  - Two-layer view persistence (local cookie + named Save Views in `user_view_state`)
  - In-app `cell` clipboard mirroring Sencha's memory-only format
  - DnD always available — rank is structural, not column-bound (Rally's sort-by-Rank precondition rejected)
  - Build (not buy) decision on Excel paste — `useGridClipboard` hook in Vector vs adopting `react-datasheet-grid` / Wijmo / CSVBox
  - ResourceTree (generic) + WorkItemsTree (preset) wrapper pattern
  - 5 prop sets registered in addressables registry (PLA-0005)

---

## Recent commits

```
58ab41d refactor: promote LayerDTO inline in portfolio-model page; add R042 + cleanup plan
4bfa294 chore: remove stale CGL/ + Claude Global/ config trees, trim CLAUDE.md index
cd18659 chore: PLA-0019 — Samantha external API surface research + plan + stories
fa9684a work-items tree: two-state sort toggle, drop the clear-to-default click
9474da2 chore: fix stale CLAUDE.md PLA-0018 entry, gitignore dev/reports, minor tidy
d2b194d backend: work-items list — pagination, count, sort/dir params
2c0fc95 refactor: workspace-settings deep-link routing + work-items component promotion
929f575 work-items tree: Rally-style column resize, flow-state pill row, sort headers
```

---

## What's next

1. **Push 8 local commits to `origin/main`** — none of today's work is on the remote
2. **Spawn ResourceTree spec plan (PLA-NNNN)** — drives the 28-row matrix into a build plan; default config = WorkItemsTree, execution-layer entry; 5 prop sets land as addressable schema
3. **Renderer card** — teach `DevResearchPanel.tsx` to surface `version` + `changelog` (R042 carries both but no UI shows them yet)
4. **Migrate R042 → `docs/c_c_workitems_tree_spec.md`** once it crosses ~50 rows or starts driving codegen
5. **Portfolio-model cleanup follow-up** — replace `LayersPreviewTable` with two `<Table>` calls; delete `LayersTable.tsx`, `LayerHierarchyDiagram.tsx`
6. **Optional** — gap-4 follow-up research run on Rally's specific column-mapping algorithm (prompt is in plan file)

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Migration state (dev):** highest applied = `119_artefact_flow_state_fk.sql` (2026-05-05); `116` intentionally absent in repo and DB
- **R042 versioning model:** envelope carries `version` + `changelog[]`; bump on every edit, append one row; consumers re-read on Research-tab refresh — renderer surfacing is a separate (not-yet-built) card
- **Plan file for this session's work:** `/Users/rick/.claude/plans/playful-gliding-swing.md` — captures all 5 gap closures + per-version patch sequence
- **DnD reference parked:** `reference/dnd_tree.tsx` (1195 lines, recovered from `b0d8e4a`); `tsconfig.json` already excludes the dir; restore path TBD
- **`Ext.dataview.plugin.SortableList` is dead** — not in documented Modern surface; do not cite in new specs
- **Rally's `enableRanking` UX wart:** requires sort-by-Rank to expose drag handle — Vector explicitly rejects this; rank is structural
- **Sencha `cell` clipboard format = memory-only** — bypasses OS clipboard, model-aware; Vector mirrors this for cross-tree paste with typed values preserved
