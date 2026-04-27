---
name: Session bootup — <server> shortcut + Service health unification (10s poll, progress bar, env-aware)
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 5b8bdf98-0f1b-4734-b76d-10cd228c3fe6
---
## Current state (last updated: 2026-04-27)

**Active branch:** `main`
**Story index last issued:** unknown (`docs/c_story_index.md` not present in repo)
**Phase:** post Nav Profiles Phase 5 — tooling/dev-UX work stream

---

## Planka card states

**In progress / Doing:**
- (none — work this session was tooling/dev-UX, not card-tracked)

**Completed (committed, move to Completed in Planka):**
- (none new committed this session — all changes still uncommitted on main)

**Parked:**
- (none)

---

## Uncommitted on branch

**Modified:**
- `.claude/CLAUDE.md` — added ACTIVE_BACKEND_ENV marker block (HTML-comment-delimited) + `<server>` and env-aware `<services>` entries.
- `.claude/commands/c_services.md` — env-aware: parses `ACTIVE_BACKEND_ENV` marker to pick correct tunnel port.
- `.claude/memory/MEMORY.md` — index entries for boot files etc.
- `app/api/dev/services/route.ts` — probes all 3 DB tunnels (`:5434`/`:5435`/`:5436`); reads backend `/healthz`'s new `env` field; sets `active: true` on the matching tunnel row; returns `activeEnv` at top level.
- `app/components/DevStatusFloat.tsx` — slimmed to float chrome only; uses shared `useServiceHealth` hook + `ServiceHealthPanel`. Dot status derived from same hook (no duplicate poll).
- `backend/cmd/server/main.go` — added `envFromDBPort` closure (single source); `/healthz` now returns `"env":"..."`; `/api/env` reuses the same derivation.
- `dev/pages/DevPage.tsx` — Setup tab now renders `<ServiceHealthPanel/>` (was `<DevServicesPanel/>`).
- `dev/styles/dev.css` — added `.devf__progress` (5px blue bar, animation duration driven by `--devf-poll-ms`), `.devf__env--{dev,staging,production}` badges, `.devf__row--active` highlight.
- Other modified files (`app/components/PageHeaderBar.tsx`, `ProfileBar.tsx`, `app/globals.css`, `backend/internal/nav/handler.go`) — pre-existing changes, not part of this session.

**Deleted:**
- `dev/pages/DevServicesPanel.tsx` — replaced by shared `ServiceHealthPanel`.

**Untracked (this session):**
- `app/components/ServiceHealthPanel.tsx` — single source of truth for the Service health UI (header + progress bar + table). Identified by `data-id="service-health"`.
- `app/components/useServiceHealth.ts` — singleton polling hook (`SERVICE_HEALTH_POLL_MS = 10_000`). Module-level subscriber set; one fetch loop shared across all consumers.
- `.claude/commands/c_server.md` — `<server> -d|-s|-p` shortcut spec (10-step procedure, `-p` requires typed "production").
- `backend/.env.production` — clean env file for `BACKEND_ENV=production` (same DB target as `.env.local`).
- `.claude/bin/switch-server` — appears to have been opened in IDE; not authored by this session.

**Untracked (not from this session — pre-existing on disk):**
- `.build/`, `Package.swift`, `Sources/`, `Tests/`, `MMFF Vector Launcher.app/`, `tools/`, `local-assets/`
- `app/components/EnvBadge.tsx`, `db/schema/037_*.sql`, `db/schema/038_*.sql`, `dev/research/R003.json`, `mmffdev_builder_brief.md`
- `.claude/commands/c_launcher.md`

---

## What shipped this session

**Backend (`backend/cmd/server/main.go`):**
- Refactored env derivation into a single `envFromDBPort()` closure — used by both `/healthz` and `/api/env`. Source of truth is the live `DB_PORT` env var.
- `/healthz` now returns `env` alongside `status/commit/build_time/started_at`. Backward-compatible (additive).
- Restarted backend mid-session — `/healthz` confirmed returning `"env":"production"`.

**`<server>` shortcut + supporting env file:**
- Created `.claude/commands/c_server.md` with `-d|-s|-p` flags. Switches `BACKEND_ENV`, ensures the matching tunnel, kills + restarts backend on `:5100`, rewrites the HTML-comment-delimited `ACTIVE_BACKEND_ENV` marker block at the top of CLAUDE.md.
- Created `backend/.env.production` (currently same DB target as `.env.local`; established as the canonical env file for `-p`).
- Updated CLAUDE.md to register the marker block and the new `<server>` entry. Updated the `<services>` entry text to reflect env-awareness.

**Service health unification:**
- Single source of truth: `app/components/ServiceHealthPanel.tsx`. `data-id="service-health"`.
- Singleton polling hook: `app/components/useServiceHealth.ts`. Module-level subscribers set, ref-counted start/stop, one in-flight guard. Both float and Setup-tab consumers share one fetch loop.
- `app/api/dev/services/route.ts` rewritten to probe 3 tunnels in parallel and emit `active:true` on the row matching the backend's reported env.
- `dev/styles/dev.css`: added `.devf__progress` 5px blue bar with `width 0→100%` animation driven by `--devf-poll-ms` custom property. Added env badges + active-row highlight.
- `DevStatusFloat.tsx` reduced to float trigger + chrome; renders the shared panel inside.
- `dev/pages/DevServicesPanel.tsx` deleted; `DevPage.tsx` imports the shared panel directly inside a `.dev-section` wrapper.

---

## Recent commits

```
291f10e Tooling: <addpaper> research-paper shorthand + shared writer/format
d76ef12 Backend: BACKEND_ENV switch + staging env support
c3fad45 Migration 036: dedupe positions + force-immediate constraints before NOT NULL
a483c67 Nav profiles Phase 5 — multi-profile sidebar + per-profile group placement (#11)
0d9a51d Backup marker: pre-PR snapshot
6dcd103 Planning: nav profiles feature design + research export R002
d529f11 Nav: route product bookmarks to Strategic; lock Theme to avatar menu
8f224f9 LayersTable: migrate inline editing to shared InlineEditField
```

---

## What's next

1. **Commit this session's work** — likely two logical commits:
   - `Tooling: <server> shortcut + .env.production + env-aware <services> + ACTIVE_BACKEND_ENV marker`
   - `Dev UX: unify Service health (shared panel + singleton poll) + 10s progress bar + 3-tunnel probes + /healthz env field`
2. **Consider a story card retroactively** for the Service health unification (per Storify-all-layers rule) if it should be tracked.
3. **Verify `<server> -d` end-to-end** — switch to dev DB, confirm marker rewrite, confirm `/healthz env=dev`, confirm Setup-tab + float pop-up both highlight the dev row.
4. **Decide on `<server> -p` UX in Claude** — `c_server.md` notes that with no TTY, the typed-confirmation step must become a chat question. Wire that into the runner if `<server> -p` is ever invoked through Claude.
5. **Pre-launch security checklist** still pending (per memory `project_pre_launch_security.md`): scrub git history of committed `.env.local`, harden `ssh_manager.sh`, rotate secrets.
6. **`docs/c_story_index.md`** is missing from the repo — needs creating per `<stories>` skill expectations, or the skill needs a fallback path.

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
- **Service health single source:** `app/components/ServiceHealthPanel.tsx` (`data-id="service-health"`); polled by singleton `useServiceHealth` hook in `app/components/useServiceHealth.ts`. `SERVICE_HEALTH_POLL_MS = 10_000`. Both the float pop-up and the Dev → Setup tab consume the same hook — never duplicate render or fetch.
- **Active env detection:** `/healthz` returns `env` derived from `DB_PORT` (5434=production, 5435=dev, 5436=staging). `/api/dev/services` reads it and marks the matching tunnel row `active`. CSS `.devf__row--active` highlights it.
- **CLAUDE.md ACTIVE_BACKEND_ENV marker** is delimited by `<!-- ACTIVE_BACKEND_ENV:start --> ... <!-- ACTIVE_BACKEND_ENV:end -->` — `<server>` rewrites the contents via Python `re.subn` with `re.DOTALL`. Removing the comments breaks `<server>`.
- **`.env.production`** is identical to `.env.local` in DB target (both → mmffdev.com via `:5434`). It exists so `BACKEND_ENV=production` has a canonical home; `.env.local` remains the no-flag default.
- **Progress-bar duration is constant-driven:** the React component sets `--devf-poll-ms` CSS variable from the same `SERVICE_HEALTH_POLL_MS`. Changing the constant retunes both the polling cadence and the bar animation in lockstep.
