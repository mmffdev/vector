---
name: Session bootup — R010 architectural pivot, 10 pop-up Qs resolved, R012 pgvector deep-dive
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: a5f9602b-0644-4cea-999f-b70468753594
---

## Current state (last updated: 2026-04-29)

**Active branch:** `main`
**Story index last issued:** `00150`
**Phase:** PH-0005 — template-driven artefact pivot (planning complete, no migrations written yet)

---

## Planka card states

**In progress / Doing:**
- None — session was design / research only.

**Completed (committed, move to Completed in Planka):**
- Most recent commits cover charts, nav prefs reset, backup-on-push, pgxpool tuning — all from prior sessions.

**Parked:**
- All Phase-1 template-artefact stories — to be created via `/stories` once we move from design to implementation.

---

## Uncommitted on branch

**Tracked file edits (not yet staged):**
- `.claude/CLAUDE.md`, `.claude/commands/c_accounts.md`, `c_research.md`, `c_services.md` — minor session-scoped tweaks
- `.claude/memory/MEMORY.md`, `planka_api_access.md` — memory index touched
- `.claude/skills/stories/SKILL.md` — stories skill edits
- `MMFFDev - Vector Assets/sow/StatementOfWork_Original r1.0.1.md`
- `app/(user)/dashboard/page.tsx`, `app/(user)/workspace-settings/page.tsx`
- 12 chart components — `AdjacencyMatrixChart`, `BarGrid3DChart`, `ChartWidget`, `DivergingHeatmapChart`, `DonutChart`, `HorizontalStackChart`, `JourneyDomeChart`, `LadderChart`, `PercentileDotChart`, `PortfolioGraphChart`, `RaydaleChart`, `SankeyFlowChart`, `ThroughputChart`
- `app/globals.css`, `backend/cmd/server/main.go`, `docs/c_feature_areas.md`, `docs/c_story_index.md`, `docs/css-guide.md`, `next.config.ts`, `package.json`

**Untracked (new files):**
- `app/components/PillToggle.tsx`, `app/components/ToggleBtn.tsx`
- `backend/internal/defects/`, `backend/internal/portfolioitems/`, `backend/internal/userstories/` — service skeletons (NOT YET WIRED into router)
- `db/schema/043_user_stories.sql`, `044_defects.sql`, `045_item_labels_tags.sql`, `046_portfolio_items.sql`, `047_custom_fields.sql`, `048_item_field_options.sql` — migrations drafted but **not run**, and now superseded by R010 template-artefact direction
- `dev/backups/`
- `dev/research/R005.json` through `R012.json` — research papers (key ones: R007 strategic fields, R008 execution fields, R009 strategic-vs-execution comparison, R010 architectural spec, R011, R012 pgvector deep-dive)
- `examples/`

---

## What shipped this session

**R010 — Template-driven artefact architecture (the central design doc):**
- Section 2.0 added — open-source-first principle as foundational rule
- Section 3.0 added — templates are form definitions, NOT content containers
- Section 3.1 — content stored as `JSONB` (Lexical state) + `content_plain_text TEXT` for FTS
- Q5–Q9 resolved inline:
  - Q5: Craft.js for page builder (MIT, React-native, headless)
  - Q6: Lexical (Meta) for WYSIWYG over Tiptap (Tiptap has paid tier)
  - Q7: storage = JSONB Lexical state + denormalised plain text
  - Q8: two-table sequence-scope (immutable `scope_key` + mutable `display_prefix`) — preserves user-renamable tags
  - Q9: pgvector overlay across the entire site
- **Q10 resolved this session — Option D hybrid backup**: PITR + pg_dump for disaster recovery, per-artefact `artefact_versions` table for user-facing undo, per-cell audit deferred until compliance customer asks. Added to §12 with full rationale.
- Section 13 — page builder architecture (Craft.js + `page_blocks` + `page_block_comments` schemas)
- Section 14 — search & embedding architecture (TSVECTOR + pgvector, async worker)
  - 14.8 — vector DB as strategic capability (15 product use cases catalogued)
  - 14.9 — documentation as vector-indexed surface (`doc_pages`, `doc_code_examples`, 10 doc use cases)

**R012 — pgvector deep-dive (sub-agent research, saved this session):**
- Validated pgvector decision for Vector PM's planning horizon (good until ~50M vectors/tenant or 5,000 QPS)
- Five corrections back-applied to R010:
  1. **§14.2** — IVFFlat → HNSW (better recall, self-maintaining, faster on continuous writes; pgvector 0.7.0 made build 30× faster)
  2. **§14.4** — pinned default model to `nomic-embed-text-v1.5` (Apache 2.0, 768 dims, 8K context — BGE's 512 would silently truncate long ACs)
  3. **§14.5** — bare NOTIFY/LISTEN replaced with **outbox table + payload-less NOTIFY wake-up + polling fallback** (at-least-once, restart-safe; bare NOTIFY drops messages on connection loss)
  4. **§14.6** — weighted-score fusion replaced with proper **Supabase-pattern RRF** (`1.0/(60 + rank)`); tenant + visibility predicates pushed inside CTEs (post-filtering causes 50ms→5s latency cliff per Simon Willison Nov 2025)
  5. **§14.6.1 (new)** — Postgres RLS on every embedding-bearing table as defence-in-depth (`current_setting('app.current_subscription_id')`)
- Each embedding row gets `embedding_model TEXT` column for safe model migrations
- Partial index `WHERE archived_at IS NULL` mandatory on every HNSW index
- `halfvec(768)` migration deferred until shared_buffers pressure (~1% recall loss for 50% RAM saving)

**Memory:**
- New file `project_open_source_first.md` — open-source-first stack rule (MIT/BSD → self-host → build → paid SaaS last)
- Indexed in MEMORY.md

---

## Recent commits

```
3cbfa4b Backend: pgxpool MinConns=2, MaxConnIdleTime=5m — fix idle cold-start lag
8a0587b Nav: useTabState hook — tab/filter state synced to URL for deep-link + reload
ff0ad55 Charts: petal geometry tightened, octagon→circle centres, arc core circles removed
b39f07f UI: Nav prefs reset to defaults — two-stage confirmation
3b8af90 Backup: extend backup-on-push.sh to dump both mmff_vector and mmff_library
c0148ef Theme system: dark-mode toggle, filter UI, chart core fixes, 3D label depth (00126-00130)
2d86307 UI: ChartWidget — toolbar row fixes expand/reroll overlap + 50% black lightbox
490cad1 UI: ChartWidget wrapper with expand-to-fullscreen overlay (00124-00125)
```

---

## What's next

1. **Decompose Phase 1 template-artefact pivot across all layers** before invoking `/stories` (storify-all-layers rule):
   - Backend migrations: core artefact tables, `_template_forms`, `_field_values` with cell visibility, `artefact_versions` (Q10), `search_index_outbox` (R012), embedding columns + `embedding_model`, RLS policies, sequence-scope two-table split, `page_blocks` + `page_block_comments`
   - Backend services: artefact CRUD, template form CRUD, field-value writer with visibility filter, version snapshotter, outbox claimer worker, Ollama embedding client
   - Frontend: Craft.js shell, Lexical editor wiring, search-and-compose authoring UX, page-builder block registry, dual-mode (read/edit) renderer
   - Search worker (Go): outbox claim + SKIP LOCKED, Ollama HTTP call, TSVECTOR + embedding writeback
   - Tests: tenant isolation canary, RLS leak test, RRF query plan, outbox restart safety, embedding model migration
2. **Decide story batch sizing** — Phase 1 is large; will likely need a phase plan before /stories so we don't blow past F13
3. **The 6 superseded migrations** (`043`–`048`) need a decision: archive into `dev/superseded/` or delete; the new template-artefact schema replaces them
4. **The 3 service skeletons** (`portfolioitems/`, `userstories/`, `defects/`) similarly need a decision — they were the column-locked direction now superseded
5. **R012 may warrant a stories card itself** for the pgvector overlay work, separate from the template-artefact pivot
6. Decide whether to commit the 12 chart-component edits + nav/dashboard/workspace tweaks as their own PR before starting the pivot — keeps this branch clean

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

**Session-specific (template-artefact pivot):**
- **R010 is the canonical spec** for the architectural pivot — read it first, not the superseded migrations.
- **R012 amends R010** — the pgvector section in R010 is now correct (HNSW, outbox, RRF, RLS); don't re-derive from earlier drafts.
- **Default embedding model is `nomic-embed-text-v1.5`** — 768 dims, 8K context, Apache 2.0. Don't use BGE-base (512-token cap will truncate ACs).
- **HNSW not IVFFlat** — every embedding index uses HNSW with `WHERE archived_at IS NULL`.
- **Outbox + NOTIFY-as-wake-up** — never bare NOTIFY/LISTEN (drops messages on restart).
- **RRF for hybrid search** — never weighted score fusion; predicates inside CTEs, never post-filter.
- **Every embedding-bearing table gets RLS** — `current_setting('app.current_subscription_id')` set per-request via `SET LOCAL`.
- **Q10 is Option D** — PITR + per-artefact versions; cell-level audit deferred.
- **Templates are artefact-type-bound** — no inheritance across types; "story templates" cannot be applied to defects.
- **WYSIWYG = Lexical (Meta)**, not Tiptap. Lexical state stored in `content JSONB`; denormalised `content_plain_text TEXT` powers FTS + previews.
- **Page builder = Craft.js** — committed for Phase 1, not deferred. `page_blocks` + `page_block_comments` is the universal store.
- **Sequence-scope split** — `artefact_type_registry` (immutable `scope_key`) + `subscription_artefact_type_overrides` (mutable `display_prefix`) preserves user-renamable tags.
- **Samantha SDK** — root namespace `samantha.portfolio.*` for the custom-app API.
- **The `043`–`048` migrations are superseded** — do NOT run them; they reflect the column-locked direction we just abandoned.
