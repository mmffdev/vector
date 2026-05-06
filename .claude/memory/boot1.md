---
name: Session bootup — PLA-0019 complete; WorkItem null serialization fix
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: dafbaa04-6546-45d4-81a9-59ae1b1e5ea5
---

## Current state (last updated: 2026-05-06)

**Active branch:** `main`
**Story index last issued:** `00444`
**Phase:** PH-0005

---

## Planka card states

**In progress / Doing:**
- None.

**Completed (committed, move to Completed in Planka):**
- 00440 — OpenAPI 3.1 spec (commit 3f45e48) ✅ moved to Completed
- 00441 — /v1/ URL versioning ✅ moved to Completed
- 00442 — RFC 9457 error format (commit 737688c) ✅ moved to Completed
- 00443 — API key management (commit 5414a1c) ✅ moved to Completed
- 00444 — Wire portfolio.fields.* SDK runtime bindings (commit 7b9076f) ✅ moved to Completed

**Parked:**
- None.

---

## Uncommitted on branch

**Branch is clean** — all work committed and pushed through ca17b21.

**Untracked files (safe to ignore):**
- `CGL.bak/`
- `Claude Global.bak/`
- `backend/.env.production.locked`
- `backend/.env.staging.locked`
- `reference/`

---

## What shipped this session

**WorkItem null serialization fix:**
- Removed `omitempty` from 8 optional fields in `backend/internal/workitems/types.go`
- `description`, `priority`, `story_points`, `rollup_points`, `sprint_id`, `parent_id`, `root_feature_id`, `archived_at` now serialize as `null` instead of being omitted (commit d6d3f47)

**Story 00444 — samantha.portfolio.fields.* SDK (complete):**
- Full implementation in `app/lib/samantha.ts`: `getSchema`, `getValue`, `getValues`, `setValue`, `setValues`, `unwrap`
- Six SDK error classes: `SamanthaNotFoundError`, `SamanthaTypeError`, `SamanthaInvalidKindError`, `SamanthaTypeConflictError`, `SamanthaForbiddenError`, `SamanthaServerError`
- Value coercion for all 11 field kinds before any network call
- Bulk-write sends `map[fieldName → typed columns]` matching the backend's exact shape
- Compile-time contract test at `app/lib/samantha.contract.ts` — tsc fails if signatures change
- `sonner` installed (required by Toaster.tsx from prior session)
- Docs updated in `docs/c_samantha_sdk_fields.md` (artefactType added as first param to field-read/write methods — backend route requires {type} in URL)
- Commit 7b9076f

**PLA-0019 closure:**
- `date_finished` set to 2026-05-06 in `dev/plans/PLA-0019.json`
- All 5 work_item_backlog entries marked `done`
- Cards 00443 and 00444 moved to Completed in Planka
- Fixed `planka_api.py` credential path bug: `MMFFDev - Projects` → `MMFFDev-Projects` (space vs hyphen)
- Commit ca17b21

---

## Key decisions made

**samantha.portfolio.fields signatures:**
- `getValue`, `getValues`, `setValue`, `setValues` all take `artefactType` as first param — backend route requires `{type}` in the URL, so there's no way to look it up by ID alone without an extra round-trip. Docs updated to match.
- `setValues` fetches schema first to coerce JS values to typed columns before the bulk-write network call. One extra GET per call — acceptable for Phase 1.

**planka_api.py path fix:**
- Script had a stale hardcoded path from a time when the directory was named differently. Fixed to match current `MMFFDev-Projects` (hyphenated).

---

## Recent commits

```
ca17b21 chore: mark PLA-0019 complete; fix planka_api.py credential path
7b9076f feat(00444): wire samantha.portfolio.fields.* SDK runtime bindings
d6d3f47 fix: WorkItem optional fields serialize as null instead of omitted
f4bbd56 chore: session boot snapshots for remote handoff
5bf8a44 chore: update boot1 session snapshot — story 00443 complete, null fields pending
5414a1c feat(00443): complete API key management — issue, list, revoke with Bearer auth
c292f22 docs: add error handling guide and update auth endpoints
ed6a128 chore: mark PLA-0020 WS1-A and WS2-A complete, WS2-B in-progress
```

---

## What's next

1. **PLA-0020** — check `dev/plans/PLA-0020.json` for what's in-progress (WS2-B was in-progress at last snapshot; WS1-A and WS2-A were done)
2. **DB backup** — SSH tunnel is down (`localhost:5434` unreachable); run `<backupsql>` when tunnel is restored
3. **OpenAPI spec (00440)** — the Planka card was moved to Completed but the acceptance criteria in PLA-0019 noted it needed `redocly lint` validation and the api-reference/ Scalar portal to render from the spec — verify this is actually done or create a follow-up story

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100/v1` (versioned base; backend direct)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Planka helper:** `./.claude/bin/planka` is the SOLE entry point for board reads/writes; path bug fixed (2026-05-06).
- **Planka list IDs:** Backlog=1760700028730475544, To Do=1760700252018443289, Doing=1760700299682513946, Completed=1760700351842878491
- **Active backend env:** `dev` — DB tunnel at `localhost:5435`, env file `backend/.env.dev`.
- **Samantha SDK fields:** `artefactType` is required first param on `getValue/getValues/setValue/setValues` — backend routes require `{type}` in the URL.
- **Dev API key:** `sam_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1` hardcoded in `.env.dev` for local testing.
- **PLA-0019:** Complete as of 2026-05-06 — all 5 stories shipped.
- **PLA-0020:** Check `dev/plans/PLA-0020.json` — human-friendly feedback system; WS2-B was in-progress at last snapshot.
