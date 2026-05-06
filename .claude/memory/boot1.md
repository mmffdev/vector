---
name: Session bootup — PLA-0019 Samantha API research + work-items perf investigation
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
- None this session — all work was planning/research.

**Created this session (Backlog — awaiting "go"):**
- `00440` — Write OpenAPI 3.1 spec for all Samantha external endpoints (card `1768715464445265079`)
- `00441` — Add /v1/ URL prefix to all external Samantha API routes (card `1768715464998913209`)
- `00442` — Standardise all API error responses to RFC 9457 format (card `1768715465510618299`)
- `00443` — API key management — table, middleware, issuance + revoke endpoints (card `1768715466039100605`)
- `00444` — Wire portfolio.fields.* SDK runtime bindings in samantha.ts (card `1768715466592748735`)

**Parked:**
- None.

---

## Uncommitted on branch

Working tree is clean for tracked files. Untracked only:
- `CGL.bak/` — backup of removed CGL directory; do NOT commit
- `Claude Global.bak/` — backup of removed Claude Global directory; do NOT commit
- `backend/.env.production.locked` — live production env sidecar; do NOT commit (secrets)
- `backend/.env.staging.locked` — live staging env sidecar; do NOT commit (secrets)
- `reference/dnd_tree.tsx.bak` — stale backup; do NOT commit

**Recommended:** add all five patterns to `.gitignore`.

---

## What shipped this session

- **Research paper `dev/research/R043.json`** — "Samantha API: Architecture, Tooling & Standards" (8-section HTML, dui-* classes, TOC sidebar). Full coverage: REST+SSE hybrid decision, addressables/diagram canvas frozen surfaces, tooling recommendations (Scalar, Speakeasy, Unkey), API key format, RFC 9457 errors, cursor pagination, URL versioning, rate-limit headers.
- **Plan `dev/plans/PLA-0019.json`** — Samantha external API surface, 5 work items, 15 AC, 3 risks, 8 references.
- **5 Planka Backlog cards** created (00440–00444), all 6 mandatory labels verified via Step 5c.
- **`docs/c_story_index.md`** — last issued bumped from `00439` → `00444`; PLA-0019 note appended.
- **`docs/c_plan_index.md`** — last issued bumped to `PLA-0019`; registry row added.
- **Repo cleanup** — `CGL/` and `Claude Global/` directory trees removed (131 files deleted); `.claude/CLAUDE.md` trimmed of 20+ stale command pointers; `.claude/c_tools_index.md` created as consolidated tools index.
- **`app/(user)/portfolio-model/page.tsx`** — `LayerDTO` interface promoted inline (was imported from `LayersTable` child).
- **`dev/research/R042.json`** and **`dev/plans/portfolio-model-layers-cleanup.md`** — pre-existing files committed.
- **PLA-0019 label** created in Planka (id `1768714873165841589`, color `wisteria-purple`).

---

## Work-items performance investigation

User shared a Chrome DevTools Performance recording of the **work-items page interaction** (sort/column click) showing **2,020ms main thread block**. Page shows 11,065 total items; 1,035 in current filtered result; 25 rendered (paginated).

**Root cause hypothesis:** sort is still happening client-side. On interaction, JS re-sorts/re-groups all 1,035 items, rebuilds tree node map, recomputes flow-state pills for every node, then React reconciles. The backend already accepts `sort` + `dir` params (from `d2b194d`) but the frontend sort toggle may still mutate local state instead of refetching.

**Fix path (in priority order):**
1. Make column-sort server-driven — click updates `?sort=&dir=` query params, triggers fresh fetch, discards old result.
2. Stop materialising tree state for non-rendered rows — only compute expansion/pill state for the 25 visible rows.
3. `react-virtual` if client-side sort is kept for snappiness.

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

1. **Fix work-items 2s interaction perf** — confirm whether sort toggle calls backend with `?sort=&dir=` or mutates local state. If local, wire sort header click to `router.replace()` with updated query params so the server does the work.
2. **Add .gitignore entries** — `CGL.bak/`, `Claude Global.bak/`, `backend/.env.*.locked`, `reference/*.bak`.
3. **PLA-0019 stories** (00440–00444 in Backlog) — say "go" when ready. Recommended order: 00441 (/v1/ prefix) → 00442 (RFC 9457 errors) → 00440 (OpenAPI spec) → 00443 (API keys) → 00444 (SDK binding).
4. **PLA-0019 Planka label ID:** `1768714873165841589` — needed if adding more stories to this plan.

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
- **Planka helper:** `./.claude/bin/planka` is the SOLE entry point for board reads/writes; subcommands: `create-card`, `label-card`, `move-card`, `update-card`, `delete-card`, `create-label`, `delete-label`, `board`, `comment`, `unlabel-card`, `verify-labels`.
- **Active backend env:** `dev` — DB tunnel at `localhost:5435`, env file `backend/.env.dev`.
- **Samantha SDK address format (frozen):** `samantha._viewport.<slot>._<kind>.<name>` — slots: app/header/footer/side_bar/modal/toast; name regex `/^[a-z0-9_]{1,64}$/`; leading underscore = system segment.
- **`samantha.diagram.canvas`:** frozen at v1.0.0, compile-time contract test at `app/lib/samantha.contract.ts`.
- **`samantha.portfolio.fields.*`:** contracted in `docs/c_samantha_sdk_fields.md`, backend live, `app/lib/samantha.ts` is empty stub — story 00444 wires it.
- **PLA-0019 Planka label ID:** `1768714873165841589` (wisteria-purple).
- **Work-items perf:** 2s interaction block observed 2026-05-06; root cause not yet confirmed — hypothesis is client-side sort of full 1,035-row result set.
