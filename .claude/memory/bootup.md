---
name: Session bootup prompt
description: Load once when resuming work after a break — branch, story counter, active/parked stories, what's next, key facts
type: project
originSessionId: eb0ff3c1-d410-4947-b728-74918cf2a3bc
---
## Current state (last updated: 2026-04-27)

**Active branch:** `vector-rebrand-001`
**Story index last issued:** `00115`
**Phase:** 5 (CSS / responsive design) — current active branch is rebrand work

---

## Backlog

**Parked:**
- 00050 — Backend: archive old portfolio layers before adopting new model (deferred to model-switching era)

**Awaiting user review/accept (Planka Backlog):**
- 00114 — UI: ghost-border inline edit (no layout shift in LayersTable)
- 00115 — DEV: service health panel (DevStatusFloat, DevServicesPanel, /api/dev/services)

**Uncommitted on branch:**
- Ghost border CSS fix (globals.css + LayersTable.tsx)
- Portfolio model meta cleanup (Family ID + Key removed, Library version first)
- DevStatusFloat, DevServicesPanel, /api/dev/services route, dev.css, DevPage.tsx

---

## What's next

User to review/accept 00114–00115 in Planka, then "go" to start implementation (cards → Doing).
Uncommitted work above needs committing once accepted.

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
