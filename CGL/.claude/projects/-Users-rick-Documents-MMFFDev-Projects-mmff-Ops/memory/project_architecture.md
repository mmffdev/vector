---
name: mmff-Ops architecture map
description: Full structural map of the mmff-Ops codebase — tiers, managers, DBs, API client, pages. Read this before exploring the repo.
type: project
originSessionId: 425822b9-fad8-40a3-865d-ddb24c168445
---
Self-hosted agile PM platform at `/Users/rick/Documents/MMFFDev-Projects/mmff-Ops`. Three tiers: launcher (gateway) → backend (Express+SQLite) → web (React).

**Why:** Pre-loading this prevents re-exploring the repo every session. Invalidate any specific claim by checking the file — the structure is stable but line numbers drift.

**How to apply:** Treat this as the table of contents. Go straight to named files for edits; only re-explore if a manager/page is missing from the map.

## Tiers + ports

- **Launcher** `launcher/src/server.ts` — fixed port **3334**. Spawns backend with `cwd: ../../backend` (this is critical — without cwd, ops.db gets written to launcher/data/). Port-scans 5000–5999 for backend. Owns: `/api/status`, `/api/restart`, `/api/logs`, `/api/logs/clear`. Everything else `/api/*` + `/socket.io/*` proxies to backend (HTTP + WS upgrade).
- **Backend** `backend/src/index.ts` — dynamic port (env PORT, default 5175). Express + Socket.IO. Boots managers in this order: users → auth → portfolios → projects → sprints → inline routes (backlog/changelog/ideas/ops/assets/research). Middleware chain on `/api/dev`: `attachUserMiddleware` → `adminAuditMiddleware`.
- **Web** `web/` — React 19 + Vite 8. Dev port 5173. `vite.config.ts` proxies `/api` + `/socket.io` (ws:true) to `http://localhost:3334` (launcher, stable target across backend restarts).

## Backend folder convention

Pattern: `backend/api/<ui_group>/<manager_folder>/<file_prefix>_<name>.ts`

- `ui_access/` — identity & scope
  - `manager_users/c_manager_users.ts` — owns `users.db`. Roles 1–5 (workspace-admin / project-admin / team-member / viewer / api). Seeds 6 accounts.
  - `manager_authentication/c_manager_authentication.ts` — reads X-User-Id header → `req.user`. Falls back to `dev` seed.
  - `manager_portfolios/c_manager_portfolios.ts` — owns `portfolios.db`.
  - `manager_projects/c_manager_projects.ts` — owns `projects.db`. Seeds `stub-project`.
- `ui_core/` — feature managers
  - `manager_sprints/c_manager_sprints.ts` — owns `sprints` table in ops.db + all sprint lifecycle (start/preflight/migrate/finalize/changelog-sync/meta/recount).
  - Also present (stub or partial): manager_backlog, manager_userStories, manager_defects, manager_customViews, manager_kanban, manager_planning, manager_portfolioItems, manager_releases, manager_reporting, manager_risks, manager_tracking.
- `ui_server/` — infrastructure
  - `c_server_database.ts` — opens `ops.db`; owns cross-cutting tables (project_config, backlog_items, changelog_entries, feature_ideas, admin_log, system_logs, operations_registry, checklist_*). Must NOT prepare statements against feature-owned tables at module load — use lazy prepare inside functions (sprints table is manager-owned).
  - `c_server_adminEventBus.ts` — EventEmitter; `adminBus.emit('admin:log', ...)` routes to DB + socket.io.
  - `c_server_adminEngine.ts`, `c_server_logger.ts`, `c_server_testRunner.ts`.

## Databases (four, ID-linked, no FK constraints)

- **ops.db** — sprints, backlog_items, changelog_entries, feature_ideas, project_config, admin_log, system_logs, operations_registry, checklists, assets, research_meta.
- **users.db** — users table only.
- **portfolios.db** — portfolios table only.
- **projects.db** — projects table. `projects.portfolio_id` → `portfolios.id` as plain TEXT (no FK).

Each manager owns its schema + migrations + index creation inside its own file. Index creation must run AFTER ALTER TABLE migrations in the same file (learned the hard way: idx_sprints_ref must come after `ADD COLUMN sprint_ref`).

## Frontend

- `web/src/App.tsx` — page registry. `activePage: PageId` drives conditional render of lazy-loaded components. Pages include: dashboard, sow, planning, sprint-summary, sprints, sprint-console, project, project-plan, scope, defects, development, testing, assets, standards, platform-arch, research, audits, changelog, logs, agents, admin, swatch-maker.
- `web/src/apiCalls/api_functions.ts` — every wrapper injects `X-User-Id` via `authHeaders()`. Two return styles:
  - **Legacy `T | null`**: getDevSprints, getDevBacklog, updateDevBacklogItem, reorderDevBacklog, getChangelog, getDevDefects, etc.
  - **`ApiResult<T>`** (discriminated union `{ok:true,data} | {ok:false,error}`): sprint lifecycle wrappers (getSprintState, startSprint, finalizeSprint, etc.), users (getUsers, getCurrentUser), portfolios, projects.
- Identity: `getCurrentUserId()` reads localStorage key `mmff-ops-user-id`, default `dev`. `setCurrentUserId()` writes + page reload.

## Critical pages

- **PlanningPage** `web/src/components-dev/PlanningPage.tsx` — backlog table + sprint filter. **Default filter is `__latest__`** which resolves to the most recent sprint id. If that sprint has zero assigned backlog items, the table looks empty (flash of full list on first render, then filter kicks in). Polls every 5s.
- **SprintConsolePage** — start-new-sprint form + preflight/finalize panel. Uses ApiResult sprint wrappers.
- **SprintsPage** — list of all sprints (DB-backed now, was JSON).
- **SprintSummaryPage** — per-sprint breakdown + charts.
- **DashboardPage** — current sprint card + backlog summary + changelog + health.
- **DefectsPage** — still backed by defects.json (not migrated to DB yet).

## Rules that bind all work here

- **No git in the app.** No commit_ref, branch, tag, or shell-out to git anywhere. The sprint manager explicitly drops legacy columns.
- **Feature owns its schema.** Server database never prepares statements against manager-owned tables at module load.
- **DB is single source of truth.** Slash commands + UI are both thin clients over the same handler endpoints.
- **Admin bus audits every mutation.** `adminBus.emit('admin:log', {action, target, result, detail})`.
- **Launcher must set cwd** when spawning backend, or ops.db gets written in the wrong location.
