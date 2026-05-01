---
name: Session bootup — 2026-04-27 tooling + research system session
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 8522631e-91de-4237-9d3b-24d74b99c168
---

## Current state (last updated: 2026-04-27)

**Active branch:** `vector-rebrand-001`
**Story index last issued:** `00123`
**Phase:** 5 (CSS / responsive design) — current active branch is rebrand + tooling work

---

## Planka card states

**In progress / Doing:**
- (none active)

**Completed (committed — move to Completed in Planka if not already):**
- 00108–00123 — Dev UI panels, feature label cleanup, CSS sweep (committed `e0f5d4c`)

**Parked:**
- 00050 — Backend: archive old portfolio layers before adopting new model (deferred to model-switching era)

---

## Uncommitted on branch

- `.claude/bin/planka_api.py` — planka API helper updates
- `.claude/commands/c_boot.md` — boot command doc updates
- `.claude/memory/boot2.md` — updated by background agents
- `.claude/memory/bootup.md` — DELETED (consolidated into numbered boots)
- `.claude/memory/project_planka.md` — DELETED (replaced by planka_api_access.md)
- `.claude/skills/stories/SKILL.md` — stories skill refinements
- `MMFF Vector Dev.app/Contents/Resources/Scripts/main.scpt` — compiled binary (auto-updated)
- `app/(user)/portfolio-model/LayersTable.tsx` — zone/collapsible work
- `app/(user)/portfolio-model/WizardModelCardList.tsx` — background agent changes
- `app/(user)/portfolio-model/page.tsx` — background agent changes
- `app/components/AppSidebar_2.tsx` — sidebar changes
- `backend/internal/custompages/service.go` — custompages fix
- `backend/server` — compiled binary (ignore)
- `db/library_schema/seed/001_mmff_model.sql` — seed updates
- `db/library_schema/seed/003_extra_models.sql` — extra models seed
- `dev/planning/c_backlog.md` — planning doc updates
- `docs/c_feature_areas.md` — feature area additions

---

## What shipped this session

- **Dev UI panels committed** — DevServicesPanel, DevShortcutsPanel, DevReportsPanel, memory-reports API route; CSS sweep removing all hardcoded hex; feature label cleanup (`e0f5d4c`)
- **Research system built + committed** (`0d1d293`):
  - `/research` skill + `c_research.md` — 5-phase agent (Seed→Crawl→Search→Compile→Output); `--page` saves JSON to `dev/research/`
  - `DevResearchPanel` — full-width Research tab in Dev Setup; search bar; page-size picker (5/10/25/50/All); lazy HTML content load per item
  - `app/api/dev/research/route.ts` — dev-only API; metadata list + full report by `?id=`
  - `R001.json` — first research report: Rally admin authority model + Vector applicability assessment
- **`<backlog> -view` flag** — opens `dev/planning/c_backlog.md` in VS Code; added to `docs/c_backlog.md` + DevShortcutsPanel
- **Reports panel pagination fix** — `PAGE_SIZE` raised from 10 → 25; `"fixed"` status added as 4th check type (blue badge + ⚙ icon)
- **`<memory>` auto-fix** — skill now appends orphaned memory files and unreferenced commands automatically; records as `"fixed"` in report
- **Memory scan run** — `<memory> -A`; 51 pass, 10 warn, 0 fail, 5 fixed; boot1–4 orphan warnings resolved
- **`<playwright>` and `<accounts>` commands** — added to CLAUDE.md + DevShortcutsPanel
- **Pages fullscreen rule** — saved to memory; `DevResearchPanel` is full-width (no max-width cap)
- **Research content padding** — accordion body uses `10px 16px` matching table header row

---

## Recent commits

```
0d1d293 Tooling: Research system + command files + backlog -view flag (00110)
e0f5d4c Tooling: claude-global.sh, dev UI panels, feature label cleanup (00108-00123)
a7f91db Revert "Nav preferences: custom-page rename/delete + dashed drop targets"
2c700bd Nav preferences: custom-page rename/delete + dashed drop targets
c7c9f71 Tooling: add <boot> command — numbered session boot file manager
78a663b Docs: update dev-launcher doc for Planka + 2026-04-27 verified date
ea612e7 Tooling: rebuild Vector Dev launcher — stability + Planka + title
072e007 Data: pin Vector Standard family first in model list, then alpha
```

---

## What's next

1. Commit remaining pre-existing uncommitted files (portfolio model, sidebar, seeds, backend service) when ready
2. Move 00108–00123 cards to Completed in Planka
3. Run `/research` on next competitor/topic — use `--page` flag to save to Dev → Research tab
4. Viewer role for Vector — Rally research (R001) flagged this as highest-leverage gap; no read-only stakeholder role exists yet
5. Work Rules / Policy Rules system — `RUL` feature area; Rally's biggest governance pattern Vector doesn't have
6. Strategy Layer fixed items — hardcoded `STRATEGY_FIXED_ITEMS` in `page.tsx` still not persisted to DB
7. Scroll restoration — `app-viewport-container` is a div scroll, not window; needs separate handling
8. Workspace name from API — currently hardcoded for default tenant UUID

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
- **Library DB password:** `LIBRARY_DB_PASSWORD` in `backend/.env.local`; user `mmff_dev`; port 5434
- **psql path:** `/opt/homebrew/opt/libpq/bin/psql` (not on default PATH)
- **Vector Standard family UUID:** `00000000-0000-0000-0000-00000000a000` (stable, used as sort pin)
- **Research reports dir:** `dev/research/RXXX.json` — viewable in Dev → Research tab; next ID is R002
- **Pages fullscreen rule:** all new pages are full-width by default (no max-width); only deviate if user specifies
- **Research content padding:** `10px 16px` (matches table header row) applied to `.dev-research-body`
- **Rally R001 key gap:** Vector has no Viewer (read-only) role and no Work Rules / Policy Rules system — highest-leverage items from R001 assessment
