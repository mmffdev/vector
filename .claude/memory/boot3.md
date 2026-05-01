---
name: Session bootup — Qdrant research, vector DB exploration, shadcn/Supabase assessment
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: current
---

## Current state (last updated: 2026-04-29)

**Active branch:** `main`
**Story index last issued:** `00150`
**Phase:** PH-0005

---

## Planka card states

**In progress / Doing:**
- None active this session (research/exploratory session only)

**Completed (committed, move to Completed in Planka):**
- None this session

**Parked:**
- None

---

## Uncommitted on branch

Large number of modified and untracked files — appear to be carry-over from prior sessions, not this session's work:

**Modified (carry-over):**
- `.claude/CLAUDE.md`, `c_accounts.md`, `c_research.md`, `c_services.md`
- `.claude/memory/MEMORY.md`, `boot2.md`, `planka_api_access.md`
- `.claude/skills/stories/SKILL.md`
- `MMFFDev - Vector Assets/sow/StatementOfWork_Original r1.0.1.md`
- `app/(user)/dashboard/page.tsx`, `app/(user)/workspace-settings/page.tsx`
- Multiple chart components: AdjacencyMatrixChart, BarGrid3DChart, ChartWidget, DivergingHeatmapChart, DonutChart, HorizontalStackChart, JourneyDomeChart, LadderChart, PercentileDotChart, PortfolioGraphChart, RaydaleChart, SankeyFlowChart, ThroughputChart
- `app/globals.css`, `backend/cmd/server/main.go`
- `docs/c_feature_areas.md`, `docs/c_story_index.md`, `docs/css-guide.md`
- `next.config.ts`, `package.json`

**Untracked (carry-over):**
- `CGL/`, `app/components/PillToggle.tsx`, `app/components/ToggleBtn.tsx`
- `backend/internal/defects/`, `backend/internal/portfolioitems/`, `backend/internal/userstories/`
- `db/schema/043_user_stories.sql` through `048_item_field_options.sql`
- `dev/backups/`, `dev/cgl-volatile-do-not-commit/`, `dev/research/R005.json` through `R012.json`
- `examples/`

---

## What shipped this session

- **R011.json** — Research paper: Qdrant vector database — deployment, Postgres hybrid sync patterns (3 tiers), risk inventory, phased implementation plan (4 phases), real-world enterprise adoption (TripAdvisor, OpenTable, HubSpot), scaling path. Saved to `dev/research/R011.json`.
- **Exploratory conversations** — shadcn/ui assessment (no conflict with current stack), Supabase assessment (redundant given existing Postgres+Go), open-source vector DB landscape comparison, toy vector DB build feasibility analysis.

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

1. Decide whether to proceed with Qdrant Phase 0 (stand up managed cloud instance, wire one collection)
2. Commit the large carry-over uncommitted batch — review what's in the chart components and schema files before staging
3. Review and potentially merge `backend/internal/userstories/`, `defects/`, `portfolioitems/` — new backend modules untracked
4. Run migrations for `db/schema/043` through `048` if backend modules are ready
5. Continue PH-0005 responsive design / Vector rebrand work if returning to that stream
6. If proceeding with Qdrant: start with `<addpaper>` or `/stories` to create Phase 0 cards before writing any code

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
- **Qdrant research paper** — R011.json in `dev/research/`; covers deployment, 3-tier Postgres sync, 4-phase implementation plan, risk inventory, enterprise adoption evidence
- **shadcn/ui** — not installed; compatible with stack but requires Tailwind for full use; hand-code in existing CSS system is the current default
- **Supabase** — not installed; redundant given existing Postgres + Go backend
- **No stories created this session** — purely exploratory/research; no Planka cards to move
