---
name: Session bootup — FE-SEC label cleanup + planka unlabel-card investigation
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: eb0ff3c1-d410-4947-b728-74918cf2a3bc
---

## Current state (last updated: 2026-04-27)

**Active branch:** `vector-rebrand-001`
**Story index last issued:** `00123`
**Phase:** 5 (CSS / responsive design) — rebrand work + nav-profiles storification

---

## Planka card states

**In progress / Doing:**
- (none — current work is metadata cleanup, not feature dev)

**Recently created (Backlog, nav-profiles batch — 2026-04-27):**
- 00118 — SQL: nav-profiles migration (now correctly: FE-SQL0001) — FE-SEC0006 removed ✓
- 00119 — API: nav-profiles CRUD endpoints (correct: FE-API0005) — STILL has FE-SEC0006 ✗
- 00120 — API: extend nav-prefs GET/PUT with profile_id (correct: FE-API0005) — STILL has FE-SEC0006 ✗
- 00121 — UX: NavPrefsContext profile-aware (correct: FE-UX0001) — STILL has FE-SEC0006 ✗
- 00122 — UX: profile-bar component (correct: FE-UX0001) — STILL has FE-SEC0006 ✗
- 00123 — DEV: nav-profiles editor reactivity (correct: FE-DEV0005) — STILL has FE-SEC0006 ✗

**Parked:**
- 00050 — Backend: archive old portfolio layers (deferred to model-switching era)

---

## Uncommitted on branch

- `.claude/bin/planka_api.py` — added `unlabel_card()` function (BROKEN — REST DELETE returns E_NOT_FOUND); added `unlabel-card` dispatch entry
- `.claude/commands/c_boot.md` — boot skill updates
- `.claude/memory/boot2.md` — this file (being rewritten now)
- `.claude/memory/bootup.md` — DELETED (merged into boot1)
- `.claude/memory/project_planka.md` — DELETED (consolidated into planka_api_access)
- `.claude/skills/stories/SKILL.md` — stories skill updates
- `app/(user)/portfolio-model/LayersTable.tsx` + `WizardModelCardList.tsx` + `page.tsx` — portfolio model UI changes
- `app/components/AppSidebar_2.tsx` — sidebar tweaks
- `backend/internal/custompages/service.go` — custom pages backend
- `db/library_schema/seed/001_mmff_model.sql` + `003_extra_models.sql` — library seed updates
- `dev/planning/c_backlog.md` — planning doc
- `docs/c_feature_areas.md` — modified (NOT yet updated with new label entries: FE-SQL0001, FE-API0005, FE-UX0001, FE-DEV0005)
- `MMFF Vector Dev.app/Contents/Resources/Scripts/main.scpt` — launcher AppleScript
- `backend/server` — rebuilt binary
- New untracked: `.claude/commands/c_shortcuts.md`, `.claude/skills/writeweb/`, `dev/shortcuts.html`, `HANDOFF.md`, `MMFFDev - Vector Assets/`, `Vector Design System/`

---

## What shipped this session

- **6 nav-profiles cards created** (00118–00123) via `/storify` — initially WRONG-labelled with `FE-SEC0006` (used as catch-all instead of reading c_feature_areas.md taxonomy)
- **Correct area labels created on Planka board:**
  - FE-SQL0001 = `1762271910986516028` (tank-green)
  - FE-API0005 = `1762271935724521022` (tank-green)
  - FE-UX0001 = `1762271957727839808` (tank-green)
  - FE-DEV0005 = `1762271980142200386` (tank-green)
- **Correct area labels applied** to all 6 cards (cards now have BOTH correct + wrong FE-SEC0006)
- **Card 00118 cleaned** — FE-SEC0006 removed via browser UI; current labels: `[storify, FE-SQL0001, PH-0005]`
- **Discovered:** Planka REST `DELETE /api/card-labels/:id` returns `E_NOT_FOUND` despite associations existing in board JSON; UI uses Socket.io for label removal (suspected — `window.io` not findable)
- **Story index updated:** 00117 → 00123
- **Story format clarification:** title format is `FE-<AREA>NNNN` not `FE-SECNNNN` (SEC = Security only, one of 18 area codes)

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

1. **Fix `planka_api.py` unlabel-card** — find correct mechanism (REST endpoint OR Socket.io). User said "we have an api, fix it" — no DB access, no giving up.
2. **Remove FE-SEC0006** from cards 00119, 00120, 00121, 00122, 00123 (once unlabel-card works)
3. **Delete FE-SEC0006 label entirely** from Planka board (it should not exist; navigation profiles is not a security feature)
4. **Update `docs/c_feature_areas.md`** with new label entries: FE-SQL0001 (nav-profiles migration), FE-API0005 (nav-profiles CRUD), FE-UX0001 (nav-profiles UI), FE-DEV0005 (nav-profiles dev tooling)
5. **Clean up `docs/c_feature_labels.md`** — remove the stale/wrong FE-SEC0006 entry (legacy file, superseded by c_feature_areas.md)
6. **Audit `/storify` skill** — it must read `c_feature_areas.md` and refuse to create cards with mismatched area codes (ban FE-SECNNNN as catch-all)

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
- **Planka admin account:** `claude@mmffdev.com` / `myApples27@`
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Planka label add endpoint** — `POST /api/cards/{id}/card-labels` (works)
- **Planka label remove endpoint** — UNKNOWN; REST `DELETE /api/card-labels/:id` and `DELETE /api/cards/{id}/card-labels/{cl_id}` both 404 with E_NOT_FOUND. UI likely uses Socket.io.
- **Planka card creation** requires `"type": "project"` (or `"story"`) in POST body
- **Feature label format:** `FE-<AREA>NNNN` where AREA ∈ {POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV} — SEC is Security only, NOT a catch-all
- **New Planka labels (2026-04-27):**
  - PH-0010 = `1762137671775290838` (midnight-blue)
  - FE-API0004 = `1762137672404436439` (tank-green)
  - FE-SQL0001 = `1762271910986516028` (tank-green)
  - FE-API0005 = `1762271935724521022` (tank-green)
  - FE-UX0001 = `1762271957727839808` (tank-green)
  - FE-DEV0005 = `1762271980142200386` (tank-green)
- **WRONG label still attached** — FE-SEC0006 (id known but not recorded here; lookup via board JSON if needed)
- **Cards with BAD label still present:** 00119, 00120, 00121, 00122, 00123 (00118 is clean)
