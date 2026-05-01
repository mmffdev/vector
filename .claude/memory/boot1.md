---
name: Session bootup — portfolio_templates redesign + VPS stability + bug investigation
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: current
---

## Current state (last updated: 2026-04-30)

**Active branch:** `main`
**Story index last issued:** `00170`
**Phase:** PH-0005

---

## Planka card states

**In progress / Doing:**
- 00145–00148 (DB migrations: user_stories, defects, item_labels, item_tags) — carry-over from prior session, untracked files exist

**Completed (committed, move to Completed in Planka):**
- None this session

**Parked:**
- 00158–00164 — dynamic workspace label system stories (superseded; "Portfolio" hardcoded instead) — these cards should be deleted from the board

**Backlog (created this session, awaiting approval):**
- 00167 — SQL: create portfolio_templates table (JSONB layers, library DB)
- 00168 — LIB: seed portfolio_templates with 5 bundled framework models
- 00169 — API: update /api/portfolio-models to read from portfolio_templates
- 00170 — Frontend: model selector renders layers array from portfolio_templates

---

## Uncommitted on branch

**Modified:**
- `.claude/memory/boot2.md` — stale session snapshot
- `dev/research/R010.json` — carry-over
- `docs/c_feature_areas.md` — updated with FE-LIB0001, FE-SQL-0008, FE-API0009, FE-POR0003 (this session)
- `docs/c_story_index.md` — last issued updated to 00170 (this session)

**Untracked:**
- `dev/research/R013.json`, `R014.json`, `R015.json` — research papers from prior sessions

**Large carry-over uncommitted batch (from prior sessions):**
- `.claude/CLAUDE.md`, `c_accounts.md`, `c_research.md`, `c_services.md`
- `.claude/skills/stories/SKILL.md`
- `app/(user)/dashboard/page.tsx`, `app/(user)/workspace-settings/page.tsx`
- Multiple chart components (AdjacencyMatrix, BarGrid3D, ChartWidget, DivergingHeatmap, Donut, HorizontalStack, JourneyDome, Ladder, PercentileDot, PortfolioGraph, Raydale, SankeyFlow, Throughput)
- `app/globals.css` — arrow bug fix (`↑` → reverted back to `↑`, bug still open)
- `backend/cmd/server/main.go`
- `next.config.ts`, `package.json`
- Untracked: `CGL/`, `app/components/PillToggle.tsx`, `app/components/ToggleBtn.tsx`
- Untracked: `backend/internal/defects/`, `backend/internal/portfolioitems/`, `backend/internal/userstories/`
- Untracked: `db/schema/043_user_stories.sql` through `048_item_field_options.sql`
- Untracked: `dev/backups/`, `dev/cgl-volatile-do-not-commit/`, `dev/research/R005.json` through `R012.json`
- Untracked: `examples/`

---

## What shipped this session

- **VPS stability fix** — needrestart set to list-only, unattended-upgrades no-auto-reboot, swarm-recovery.service systemd unit prevents Docker Swarm collapse after package upgrades
- **Dev environment restored** — `<server> -d` switched backend to dev; all 3 Swarm services (postgres, adminer, homepage) force-updated after post-reboot 0/1 state
- **Stories 00167–00170 created** — portfolio_templates redesign (SQL + LIB seed + API + frontend), all verified in Planka Backlog with correct labels
- **Feature areas registry updated** — FE-LIB0001, FE-SQL-0008, FE-API0009, FE-POR0003 added to docs/c_feature_areas.md
- **Story index updated** — last issued 00166 → 00170
- **Bug investigation (incomplete)** — blocks diagram reverse-order bug in model selector; CSS arrow changed ↑→↓ then reverted; root cause: layer_summary string is bottom-to-top (sort_order 10=Feature=first); fix will come from 00167–00170 (structured layers array, index 0 = top tier)
- **Portfolio_templates design agreed** — single table replacing portfolio_models + portfolio_model_layers; JSONB layers array; array index = display order; no sort_order integer

---

## Recent commits

```
87196a4 Schema: o_ artefact tables 049–059 + R010 §6.4/§7 update
66a6523 WIP: template-artefact pivot (R010) + pgvector validation (R012) + CGL backup
3cbfa4b Backend: pgxpool MinConns=2, MaxConnIdleTime=5m — fix idle cold-start lag
8a0587b Nav: useTabState hook — tab/filter state synced to URL for deep-link + reload
ff0ad55 Charts: petal geometry tightened, octagon→circle centres, arc core circles removed
b39f07f UI: Nav prefs reset to defaults — two-stage confirmation
3b8af90 Backup: extend backup-on-push.sh to dump both mmff_vector and mmff_library
c0148ef Theme system: dark-mode toggle, filter UI, chart core fixes, 3D label depth (00126-00130)
```

---

## What's next

1. **Say "go" on 00167–00170** to start the portfolio_templates implementation (schema → seed → API → frontend) — natural order is 00167 first
2. **Delete cards 00158–00164** from Planka (dynamic workspace label stories, superseded)
3. **Commit the large carry-over batch** — review chart components and schema files 043–048 before staging; backend modules userstories/defects/portfolioitems need review
4. **Close Doing cards 00145–00148** — DB migrations for user_stories, defects, item_labels, item_tags; untracked schema files exist, run migrations and commit
5. **Block diagram bug** — will be fixed as part of 00170 (frontend consumes layers array, renders index 0 at top); no separate CSS fix needed
6. **Portfolio Settings page** — cards 00165–00166 still in Backlog, build after portfolio_templates is wired up
7. **Qdrant Phase 0** — parked; R011.json in dev/research/ when ready to revisit

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
- **Active backend env:** dev (VPS 77.68.33.216, tunnel localhost:5435, env file backend/.env.dev)
- **Library DB migration tool:** `go run ./backend/cmd/migrate -db library` — targets mmff_library separately
- **portfolio_templates design:** single table, JSONB layers array, index 0 = top tier (strategy), last = leaf (feature); replaces portfolio_models + portfolio_model_layers entirely
- **Block diagram bug:** layer_summary string aggregates ascending (sort_order 10=Feature first); visual result is bottom-to-top hierarchy; will be fixed by 00169+00170 (structured layers array)
- **VPS auto-reboot fix:** needrestart→list-only + unattended-upgrades→no-auto-reboot + swarm-recovery.service; applied 2026-04-30
- **Planka card-labels endpoint:** `/api/cards/{id}/card-labels` (NOT `/api/cards/{id}/labels`)
- **Planka card creation requires:** `type: "project"` field (not "card" or "story")
