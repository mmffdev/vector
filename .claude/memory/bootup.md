---
name: Session bootup prompt
description: Read at the start of every session to restore full working context — branch, what's done, what's next, key facts
type: project
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
## Project: MMFFDev — Vector (PM tool)

**Repo:** `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`
**Active branch:** `main` (feat/migration-017 merged)
**Main branch:** `main`

---

## What was just completed (session 2026-04-26 part 2)

### Dev Library Page — full implementation shipped

Searchable, paginated markdown viewer for docs/ and dev/planning/ files. Lives in dev mode only and is removed when dev mode is detached from production.

**Database:**
- Migration `031_nav_dev_library.sql` applied — adds new navigation entry with `pinnable = FALSE` so it routes to sidebar dev group below "Dev Setup"

**Backend:** 
- `app/api/dev/library/route.ts` — lists all .md files from docs/ and dev/planning/ with size + mtime metadata
- `app/api/dev/library/file/route.ts` — reads requested file (validated against allowlist), parses with `marked`, returns HTML
- Path traversal protection guards against `../../.env` and similar attacks

**Frontend:**
- `dev/pages/LibraryPage.tsx` — React client component, two views:
  - **Table view** (default): search input, paginated table (15/page), file names/dirs/sizes/dates, result count
  - **Document view** (on click): rendered HTML with ← Library back button, full markdown parsing
- `app/(user)/dev/library/page.tsx` — route re-export following existing /dev pattern
- `dev/styles/dev.css` — appended .dev-library-* rules fully namespaced

**Verification:**
- API routes: `GET /api/dev/library` returns JSON array (60 files), `GET /api/dev/library/file?path=docs/c_schema.md` returns HTML, path traversal → 403
- UI: table loads with 60 docs in 4 pages (15/page), search "rally" filters to 1 result, click opens rendered markdown, ← Library returns to table

**Files created:**
- `db/schema/031_nav_dev_library.sql`
- `app/api/dev/library/route.ts`
- `app/api/dev/library/file/route.ts`
- `dev/pages/LibraryPage.tsx`
- `app/(user)/dev/library/page.tsx`
- `dev/styles/dev.css` (appended)
- `backend/.env.local` (recreated from worktree for migration tool)
- `package.json` → added `marked` devDep

---

## What's next (parked, asked-and-paused)

**User asked, then parked:** *"we need to ensure the pages we build are browser-width friendly… we need fluid designs for all app viewports"*

Resumption plan when user picks this back up:
1. **Audit pass first** — grep for `min-width`, fixed `width: NNNpx`, `overflow-x` on top-level containers. Don't patch blindly.
2. Fix the shell (PageShell + route-group layouts) so the page never exceeds viewport.
3. Per-surface fixes (tables, wizard cards, graph canvas) — pick strategy each: stack, internal scroll, or scale.
4. Graph engine canvas uses pixel-precise absolute positioning — bound it inside a responsive scroll container, don't rewrite the layout.

Other pending work (from prior session):

| Story | Area |
|---|---|
| Schema migration 026 | `work_items` table + wire `item_state_history` FK |
| Schema migration 027 | `item_key_aliases` |
| Schema migration 028 | `config_roots` + nullable `config_root_id` (defer to enterprise tier) |

---

## Key facts

- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored)
- **SSH tunnel:** `localhost:5434` → remote Postgres; `localhost:3333` → Planka
- **psql binary:** `/opt/homebrew/Cellar/libpq/18.3/bin/psql`
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **secrets package:** `backend/internal/secrets` — `Encrypt/Decrypt(string, []byte)`, `ErrNotEncrypted` sentinel, `ENC[aes256gcm:<base64>]` envelope
- **secrets.Get:** transparent decrypt wrapper — reads `MASTER_KEY` env, panics on misconfiguration
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` (encrypt) or `-decrypt -value 'ENC[...]'`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **Planka MCP create_card:** pass `labels[]` array at creation — curl label endpoint silently drops on E_NOT_FOUND
- **Planka card move:** PATCH needs both `listId` + `position` — see `docs/c_c_planka_rest.md`
- **Mandatory card attributes:** `NNNNN —` title prefix, `PH-NNNN`, `FE-SECNNNN`, `storify`. Storify SKILL has BLOCKING gate.
- **Graph engine:** `app/lib/graph-engine/` — DOM nodes + SVG edges, levels shorthand, leaf edges red dashed. Drag/hover scaffolded but `enabled: false`.
- **Standing rule:** never create tech debt — fix now or surface immediately

---

## Schema — next migrations planned

| Migration | Contents |
|---|---|
| 026 | `work_items` table + wire `item_state_history` FK |
| 027 | `item_key_aliases` |
| 028 | `config_roots` + nullable `config_root_id` (defer to enterprise tier) |

---

## What was just completed (session 2026-04-26 part 3)

### Major infrastructure updates

**1. .env shared template + security hardening**
- Created `backend/.env.example` with platform-agnostic structure (no secrets, all placeholder ENC[...])
- Untracked `backend/.env.local` from git (now `.gitignore`)
- Developers can safely pull and create their own `.env.local`

**2. Merged feat/migration-017-subscriptions-rename to main**
- 171 files changed, +17169 insertions across Phase 4 (portfolio-model adoption)
- Portfolio-model UI (adoption overlay, wizard, layers diagram), SSE streaming, library releases
- Backend: storify hardening, secrets package (AES-256-GCM), encsecret CLI, migration tool
- Storify skill and Planka API documentation fixed (label endpoint, card movement)
- Session updates: memory docs, story index (IDs 00031–00049), feature labels (FE-DEV0002)

**3. Phase transition: 4 → 5**
- Created `PH-0005` label (CSS responsive design) — Planka ID 1761354660716741817
- Created `PH-0006` label (future placeholder) — Planka ID 1761354661303944378
- Updated `c_story_index.md` to note active phase is PH-0005

**4. Lessons learned — documented for reuse**
- Planka label creation endpoint: `/api/boards/:id/labels` (not `/api/labels`), requires `position` parameter
- Fixed in memory `planka_api_access.md` and storify SKILL.md to prevent future 404 loops
- Committed both to repo so next session has the fix

**5. Global instructions moved to repo**
- Extracted documentation principles, naming conventions, model selection governance from `/Users/rick/.claude/CLAUDE.md`
- Created `.claude/c_global_instructions.md` (project-local, version-controlled)
- All project guidance now shareable with team

**6. CSS theming system planned**
- Designed semantic 4-color theming architecture (sets 1, 2, 3, 4 for light + dark modes)
- Variable naming: `--{mode}-{domain}-{state}-{set}` (e.g., `--light-accent-1`, `--dark-table-row-odd-4`)
- Covers: core colors, typography, borders, links, surfaces, tables, progress, badges, state indicators
- 4 palettes: Set 1 (orange), Set 2 (green), Set 3 (blue), Set 4 (purple)
- Plan documented in `dev/planning/c_css_theme.md` — eliminates brittleness of hardcoded color names

**Commits to main (6 total):**
- 67c258a: Add .env.example template and untrack .env.local
- 34a582f: Session updates: memory, story index, feature labels
- 603207e: Document Planka label creation endpoint — lessons learned
- 7d46dc8: Move global Claude instructions into project repo
- f43b344: Phase transition: 4 → 5 (CSS responsive design)
- 6fafa94: Plan: CSS theming system — 4-color palette strategy
- 83c075b: Clean up c_css_theme.md example section

## Session end state (2026-04-26 session 4)

**Branch status:** `main` (on main branch).

**Completed work this session:**
- ✅ Closed 00051 (superseded by 00054) and 00052 (doc exists at dev/planning/c_portfolio_adoption_action_paths.md) → moved to Completed on board
- ✅ 00050 left in Backlog with clarifying comment (valid pre-req for model-switching, not needed now)
- ✅ Diagnosed ADOPT_PRIOR_FAILURE_DIFFERENT_MODEL bug — stale failed state row for a different model blocks fresh adoption
- ✅ Created stories 00060 and 00061 to fix it (both in Backlog, PH-0005, FE-SEC0001, MULTI AGENT)

**Active backlog stories (ready to implement):**
- 00060 — Backend: archive stale failed adoption row on model switch (`backend/internal/portfoliomodels/adopt.go`)
- 00061 — Frontend: decode adoption 409 error codes into human-readable messages (`app/(user)/portfolio-model/WizardModelCardList.tsx`)

**Parked backlog:**
- 00050 — Backend: archive old portfolio layers before adopting new model (deferred to model-switching era)

**Phase status:**
- Phase 4 (portfolio-model adoption) complete
- Phase 5 (CSS responsive design) deferred to Phase 8
- Current work: adoption bug fix (00060 + 00061)

**Bug context (00060/00061):**
- Root cause: `subscription_portfolio_model_state` has a `failed` row for model A; padmin selects model B → 409 ADOPT_PRIOR_FAILURE_DIFFERENT_MODEL
- Fix: soft-archive the stale row (set `archived_at = NOW()`) and proceed fresh; remove `errPriorFailureDifferentModel` error type
- Frontend fix: decode JSON `code` field in catch block → readable message

**Key facts:**
- **Frontend dev server:** Next.js runs on `:5101` (not `:3000`)
- **API routing:** Frontend uses `api()` helper which defaults to `http://localhost:5100` (backend direct), not through Next.js proxy routes
- **Card lifecycle rule:** Backlog→To Do (on approval) → Doing (on first edit) → Completed (on code-done). No exceptions, even for one-liners.
- **Story index last issued:** 00061

**What's next:**
1. Implement 00060 + 00061 (adoption 409 fix — both MULTI AGENT, can run in parallel)

---

## Session end state (2026-04-26 session 5)

**Completed this session (3 fixes shipped):**

### 1. Adoption overlay stuck — EventSource → fetch() (real fix)
- `AdoptionOverlay.tsx`: replaced `EventSource` with `fetch()`+`ReadableStream`
- Root cause: EventSource can't send `Authorization: Bearer`; hit Next.js proxy (`:5101`) not backend (`:5100`)
- New SSE reader uses `getApiToken()`, `NEXT_PUBLIC_API_BASE ?? "http://localhost:5100"`, manual frame parser
- Added `adoptStreamPath()` helper to `adoptionConstants.ts`

### 2. SSE idempotent path — synthetic step events
- `adopt_stream.go`: tracks `stepCount`; when `stepCount == 0` on successful done, emits 7 synthetic ok step events
- Test: `TestAdoptStream_IdempotentCompleted` added and passing

### 3. Dev reset 403 for padmin — fixed
- `cmd/server/main.go`: changed dev reset route from `RequireRole(RoleGAdmin)` to `RequireRole(RoleGAdmin, RolePAdmin)`

### 4. Migration 032 — dropped pre-adoption item type cluster
- Dropped: `item_state_history`, `item_type_transition_edges`, `item_type_states`, `portfolio_item_types`
- Dropped: `portfolio.type_id`, `product.type_id` columns (no FK, no reader)
- Dropped: `seed_default_states_for_type` function
- Rebuilt: `provision_subscription_defaults` function — removed all references to dropped tables; now only seeds roadmap/workspace/product/execution_item_types

### 5. Test file cleanup after 032
- `permissions/service_test.go`: removed 3 DELETE stmts for dropped tables
- `users/service_test.go`: removed 4 DELETE stmts for dropped tables
- `dbcheck/dispatch_triggers_test.go`: removed 3 item_type_states subtests
- `dbcheck/orphans_test.go`: removed item_type_states + item_state_history checks
- `entityrefs/lifecycle_test.go`: removed TestArchiveLifecycle_PortfolioItemTypes_ItemTypeStates

**All test suites green:** permissions, users, dbcheck, entityrefs, portfoliomodels/adopt_stream

**Story index last issued:** 00061
**What's next:** Implement 00060 + 00061 (adoption 409 fix)

---

## Session end state (2026-04-26 session 6)

**DB state:** Dev reset run via Dev Setup button. All mirror tables (`subscription_terminology`, `subscription_layers`, `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`) and `subscription_portfolio_model_state` wiped clean for the default subscription. Subscription is in unadopted state — wizard will show on next padmin login.

**Key finding this session:** Mirror table `archived_at` rows accumulate between resets when the same model is adopted multiple times (rapid dev cycling). The reset hard-deletes everything — no code change needed. Rows with `archived_at IS NOT NULL` are left by the saga's `ON CONFLICT … WHERE archived_at IS NULL` logic when old rows survive a partial reset cycle. Cosmetic only; all live queries filter `archived_at IS NULL`.

**Data flow doc created:** `dev/planning/c_user_journey_dataFlow.html` — full portfolio model journey from padmin login through 7-step saga to live state and dev reset, covering both mmff_vector and mmff_library databases.

## Session start state (2026-04-26 session 7)

**00060 + 00061 accepted on board.** Adoption saga (Phase 4) fully complete.

**Parked backlog:**
- 00050 — Backend: archive old portfolio layers before adopting new model (deferred to model-switching era)

**Story index last issued:** 00065

**Completed (layer editing feature — FE-POR0001 / FE-API0002, 2026-04-26 session 7):**
- 00062 — Backend: PATCH /api/subscription/layers/batch → `backend/internal/portfoliomodels/handler_layers.go`
- 00063 — Frontend: inline edit Name/Tag/Description cells → `app/(user)/portfolio-model/LayersTable.tsx`
- 00064 — Frontend: drag-to-reorder rows → same file
- 00065 — Frontend: Confirm Changes bar + PATCH submit → same file
All 4 in Completed on board, awaiting user review/accept.

**What's next:** User reviews 00062–00065 on board.
