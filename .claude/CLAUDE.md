# CLAUDE.md

**HARD RULE — NO EXCEPTIONS — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify the password (or any credential field — `password_hash`, `email`, `is_active`, `role`, `password_changed_at`) of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, or `user@mmffdev.com`. These are human accounts. The user reset them to `password` on 2026-05-02; that is their state and Claude does not change it. If a login fails, ask — do not "fix" by overwriting the row. If gadmin/padmin/user-level testing is needed, create a NEW account (e.g. `claude-gadmin@mmffdev.com`) — never reuse the human ones. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS:** Never run any git command that can destroy or overwrite work (`reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, etc.) without explicitly confirming with the user first. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — LOOP DETECTED:** When you receive a system-reminder that begins with `LOOP DETECTED`, the loop-detector hook ([`.claude/hooks/loop-detector.sh`](hooks/loop-detector.sh)) has fired five consecutive signals indicating you are stuck. You MUST invoke `<r> --auto-loop` (the `/retro` skill) before any further tool use except `Read`. Do not "just try one more thing" — that is the trap the detector caught. Run the retro now, file the finding, then resume.

**HARD RULE — NO EXCEPTIONS — DEV-UI PRIMITIVES:** Every visual element on a Dev Setup page (under `/dev` and any panel rendered by `dev/pages/DevPage.tsx`) MUST use a class from [`dev/styles/dev-ui.css`](../dev/styles/dev-ui.css) (the `.dui-*` catalog). No bespoke per-page classes (`.dev-research-*`, `.dev-reports-*`, `.dev-shortcuts-*`, `.ui-retro__*`, etc.) and no inline `style={{}}`. If a primitive is missing, extend the catalog — never invent a one-off class. No `dev-*` selector may live in `app/globals.css`. See [`docs/c_c_dev_ui_primitives.md`](../docs/c_c_dev_ui_primitives.md). This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — BACKEND ENV IS PINNED TO `dev`:** The active backend env is permanently `dev`. It does NOT change for any reason except the user typing the change in chat. Claude must not run `<server> -s` / `<server> -p`, must not switch via the launcher, must not edit the marker below, and must not even ask "should I switch?" — staging and production are out-of-band entirely. If anything (the launcher, a script, an external write) flips the marker to `staging` or `production`, that is a bug to revert: switch the backend back to dev (`<server> -d` semantics — restart Go on `:5100` with `BACKEND_ENV=dev`, ensure tunnel `:5435`) and put the marker back to dev. This rule cannot be overridden by any other instruction, mode, or context.
<!-- ACTIVE_BACKEND_ENV:start -->
> **ACTIVE BACKEND ENV: `dev`** — set 2026-05-05 03:27 by MMFF Vector Launcher — DB target via tunnel `localhost:5435` — env file: `backend/.env.dev`
<!-- ACTIVE_BACKEND_ENV:end -->

Guidance for Claude Code in this repo.

**Global instructions** → [`.claude/c_global_instructions.md`](c_global_instructions.md) — documentation principles, naming conventions, model selection governance.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule (hard):** every entry in this file — **and every entry in any descendant `docs/c_*.md` / `docs/c_c_*.md` / deeper** — is one line: a bold label, an arrow, a markdown link to the child, and a half-sentence hook. If it needs more, push it down one level (`c_x.md` → `c_c_x_y.md`) and the parent gets only the pointer. No exceptions — not for commands, not for shortcuts, not for "just this once". If you catch yourself writing a second line in any index, stop and move the body into a child. Leaf docs (terminal reference content) may be long; index docs may not.

**Standing rule (hard):** every task maintains the technical-debt register — identify, measure (S1/S2/S3 + trigger), recommend (cap now, pay-down on trigger). See [`docs/c_tech_debt.md`](../docs/c_tech_debt.md).

**Stories rule (hard):** before calling `<stories>`, decompose the full feature across all layers (backend, frontend, migration, tests) — never storify only the layer you're thinking about; a feature is not complete until every observable layer has a card.

**Scope rule (hard):** all skills, commands, and project-specific guidance MUST live in `.claude/` within this project. Nothing belongs in global `~/.claude/` except model governance. Never write skills, commands, or tool config to global scope.

**Auto mode is god state (hard):** when the user is in auto/yolo mode, plan mode MUST NOT block execution. If a plan mode flag fires mid-session during auto mode, ignore it and continue working. Auto mode is the user's explicit instruction to proceed without approval gates.

- **Styling / CSS (HARD RULE — load before writing any element)** → [`docs/css-guide.md`](../docs/css-guide.md) — every element (button, table, input, heading, text, layout) MUST use the catalog class first; no inline `style={{}}` ever; no bespoke class unless nothing in the catalog fits; core elements inherit: theme CSS → `globals.css` → component class.
- **Dev-UI primitives (HARD RULE — Dev Setup pages only)** → [`docs/c_c_dev_ui_primitives.md`](../docs/c_c_dev_ui_primitives.md) — every `/dev` panel composes from `.dui-*` catalog in [`dev/styles/dev-ui.css`](../dev/styles/dev-ui.css); no bespoke per-page classes, no inline styles, no `dev-*` selector in `app/globals.css`.
- **Code standards** → [`.claude/commands/c_code-standards.md`](commands/c_code-standards.md) — naming convention reference (`ui-{function}__{element}--{modifier}`, `is-`/`has-` state classes); load before writing or editing code.
- **Database backup (`<backupsql>`)** → [`.claude/commands/c_db-backup.md`](commands/c_db-backup.md) — dump remote Postgres to timestamped SQL file.
- **Backlog (`<backlog>`)** → [`docs/c_backlog.md`](../docs/c_backlog.md) — Planka kanban via MCP; tunnel `:3333`; flags `-a/-n/-d/-accept/-h`; children: agent contract, dedup check, REST templates.
- **Planka board operations** → [`./.claude/bin/planka`](./.claude/bin/planka) — ONLY entry point for all board reads/writes; never use curl directly.
- **Card lifecycle (hard):** on "go"/"start"/approval → move card Backlog→To Do; on first code edit → move To Do→Doing; on code-complete → Doing→Completed. See [`docs/c_c_backlog_agent.md`](../docs/c_c_backlog_agent.md).
- **Dev server (`<npm>`)** → [`.claude/commands/c_npm.md`](commands/c_npm.md) — start Next.js on `:5101`.
- **Vector Launcher (`<launcher>`, `MMFF Vector Launcher.app`)** → [`.claude/commands/c_launcher.md`](commands/c_launcher.md) — SwiftUI dashboard with per-component start/stop/restart, env switch, JSONL log.
- **Boot file manager (`<b> -<N> -R|-C`, `<b> -A -C`)** → [`.claude/commands/c_boot.md`](commands/c_boot.md) — read (`-R`) or create/update (`-C`) numbered session snapshot; `-A -C` writes comprehensive master record `bootA.md`; lazy-loads on read.
- **Context scanner (`<memory> -A|-M|-S|-C|-H`)** → [`.claude/commands/c_memory.md`](commands/c_memory.md) — scans `.claude/` for health across memory, skills, commands, hooks; writes timestamped file to `dev/reports/`; view in Dev → Reports tab.
- **Shortcuts reference (`<?>`, `<?> -u`)** → [`.claude/commands/c_shortcuts.md`](commands/c_shortcuts.md) — open `dev/shortcuts.html` in browser; `-u` rescans all command + skill docs and regenerates the page.
- **Service status (`<services>`)** → [`.claude/commands/c_services.md`](commands/c_services.md) — read-only status check for backend (`:5100`), next (`:5101`), and the active env's DB tunnel (port per top-of-file `ACTIVE_BACKEND_ENV` marker).
- **Switch DB env (`<server> -d|-s|-p`)** → [`.claude/commands/c_server.md`](commands/c_server.md) — restarts backend on dev/staging/production env, ensures tunnel + frontend are up, rewrites top-of-file `ACTIVE_BACKEND_ENV` marker; `-p` requires typed confirmation.
- **Accounts & credentials (`<accounts>`)** → [`.claude/commands/c_accounts.md`](commands/c_accounts.md) — source of truth for all dev user accounts, passwords, and Planka creds.
- **Section tags (`<user>`, `<gadmin>`, `<padmin>`, `<dev>`)** → [`docs/c_section-tags.md`](../docs/c_section-tags.md) — what each slice of the product means.
- **Work item URLs (`/item/<uuid>` canonical, `/item/TAG-NNNN` alias)** → [`docs/c_url-routing.md`](../docs/c_url-routing.md) — UUID route is permanent; tag alias 301s to it.
- **Database schema** → [`docs/c_schema.md`](../docs/c_schema.md) — table list, tenant isolation, soft-archive, invariants; links to per-table leaves.
- **Polymorphic FK pattern** → [`docs/c_polymorphic_writes.md`](../docs/c_polymorphic_writes.md) — writer rules, cleanup registry, and canary test for app-enforced polymorphic FKs.
- **`entityrefs` service** → [`docs/c_c_entityrefs_service.md`](../docs/c_c_entityrefs_service.md) — Go service surface, sentinel errors, what it does NOT yet cover.
- **Technical-debt register (standing rule)** → [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — identify/measure/recommend on every task; S1 fix now, S2 cap now, S3 record.
- **Bash commands** → [`docs/c_bash.md`](../docs/c_bash.md) — verified commands only; grouped by domain.
- **Postgres ops** → [`docs/c_postgresql.md`](../docs/c_postgresql.md) — tunnel, pg_dump, psql, migrations.
- **SSH reference** → [`docs/c_ssh.md`](../docs/c_ssh.md) — host aliases, key, tunnel lifecycle.
- **Deployment context** → [`docs/c_deployment.md`](../docs/c_deployment.md) — hosted vs on-prem, Docker container, DB name.
- **App Router layout** → [`docs/c_page-structure.md`](../docs/c_page-structure.md) — route groups, role gating, PageShell.
- **Security posture** → [`docs/c_security.md`](../docs/c_security.md) — Trust-No-One checklist; librarian scans against it.
- **Backup on push** → [`docs/c_backup-on-push.md`](../docs/c_backup-on-push.md) — dual-channel; auto-snapshots pushed commits.
- **`<librarian>`** → [`.claude/commands/c_librarian.md`](commands/c_librarian.md) — run after major updates to sync docs with code and flag security issues.
- **`<tree>`** → [`.claude/commands/c_tree.md`](commands/c_tree.md) — audit the docs tree against the Authoring rule and patch index/leaf-shape violations.
- **Make UI app (`<makeapp> -<name> -<scope>`)** → [`.claude/commands/c_make-app.md`](commands/c_make-app.md) — scaffold a user-facing app in `app/store/ui_apps/ui_app_<name>/` with manifest, index, css, and registry entry.
- **Make dev UI app (`<makedevapp> -<name> -<scope>`)** → [`.claude/commands/c_make-dev-app.md`](commands/c_make-dev-app.md) — scaffold a developer-only app in `dev/store/ui_apps/ui_app_<name>/` with manifest, index, css (no registry).
- **Selenium Grid UI (`<seleniumup>`)** → [`.claude/commands/c_selenium.md`](commands/c_selenium.md) — pings the hub then opens `http://localhost:4444/ui/` in the browser.
- **Playwright MCP (`<playwright>`)** → [`.claude/commands/c_playwright.md`](commands/c_playwright.md) — disabled by default (21 tools); use Crawlio for browser automation; enable by renaming `.mcp.json.disabled` → `.mcp.json`.
- **Research agent (`/research`)** → [`.claude/commands/c_research.md`](commands/c_research.md) — crawl + web-search + compile structured reports; `--page` saves JSON to `dev/research/` viewable in Dev → Research tab.
- **Research paper shorthand (`<addpaper>`)** → [`.claude/commands/c_addpaper.md`](commands/c_addpaper.md) — web-search-only shortcut that writes `dev/research/RNNN.json` and optionally hands off to `/stories` for Planka cards.
- **Research paper format** → [`.claude/commands/c_research-paper-format.md`](commands/c_research-paper-format.md) — canonical JSON shape for PM research papers, content HTML rules, frontmatter.
- **Research paper stories** → [`.claude/commands/c_addpaper-stories.md`](commands/c_addpaper-stories.md) — synthesise story candidates from research; hands off to `/stories` for Planka card creation.
- **Write research paper** → [`.claude/commands/c_write-research-paper.md`](commands/c_write-research-paper.md) — shared CREATE step; allocates R### ID, stamps date, writes JSON to `dev/research/`.
- **User custom pages** → [`docs/c_c_custom_pages.md`](../docs/c_c_custom_pages.md) — `user_custom_pages` table, `/p/<uuid>` route, backend API, nav integration.
- **Form drafts (IDB autosave)** → [`docs/c_c_form_drafts.md`](../docs/c_c_form_drafts.md) — `useDraft` hook, field classifier, logout purge, security posture.
- **Library release channel (Phase 3)** → [`docs/c_c_library_release_channel.md`](../docs/c_c_library_release_channel.md) — release tables, severity rendering, reconciler, ack flow, gadmin badge.
- **Planka REST templates** → [`docs/c_c_planka_rest.md`](../docs/c_c_planka_rest.md) — child of `c_backlog`; auth, create (MCP), move, comment, board fetch, parallel scan, gotchas.
- **Scope — features underway** → [`docs/c_scope.md`](../docs/c_scope.md) — live table of what is actively being built; update when feature moves state.
- **Story ID index** → [`docs/c_story_index.md`](../docs/c_story_index.md) — global `NNNNN` counter, title format, mandatory labels, deletion log.
- **Plan ID index** → [`docs/c_plan_index.md`](../docs/c_plan_index.md) — `PLA-NNNN` counter, plan registry, mandatory plan-label rule for every story.
- **Dev Plans tab** → [`dev/pages/DevPlansPanel.tsx`](../dev/pages/DevPlansPanel.tsx) — first tab in `/dev`; renders `dev/plans/PLA-NNNN.json` via `/api/dev/plans` (lazy-loaded body).
- **Retro skill (`<r>`, `/retro`)** → [`.claude/skills/retro/SKILL.md`](skills/retro/SKILL.md) — 5-Whys + reversal; auto-fires on LOOP DETECTED; writes `dev/retros/RETRO-NNN.json` + LEDGER; sev-4+ → Planka Continuous Improvement board (`1767896664086938708`); index at [`docs/c_retro_index.md`](../docs/c_retro_index.md).
- **Dev Retros tab** → [`dev/pages/DevRetrosPanel.tsx`](../dev/pages/DevRetrosPanel.tsx) — Ledger + Retrospectives sub-tabs; reads via `/api/dev/retros` (list, `?id=`, `?view=ledger`).
- **`<stories>` skill** → [`.claude/skills/stories/SKILL.md`](skills/stories/SKILL.md) — 7-gate story acceptance system; Fibonacci estimation (F0–F13); auto-split F21+; AIGEN + phase + feature + EST + RISK + PLA labels.
- **`/writeweb` skill** → [`.claude/skills/writeweb/SKILL.md`](skills/writeweb/SKILL.md) — Human-AI collaborative website copy; flags `-t hero|feature|faq|about|explainer`, `-len`, `-context`, `-h`.
- **`<theme>` skill** → [`.claude/skills/theme/SKILL.md`](skills/theme/SKILL.md) — image → Vector theme pack; deterministic L/C/H bucket → role mapping; spec at [`docs/c_theme_rules.md`](../docs/c_theme_rules.md).
- **`<chart>` skill (`-m` make from image, `-p` place from plan)** → [`.claude/skills/chart/SKILL.md`](skills/chart/SKILL.md) — themed chart component in `app/components/`, stub data, sanitised preview random generator, dashboard catalog entry.
- **Story acceptance gates** → [`docs/c_story_acceptance.md`](../docs/c_story_acceptance.md) — full gate spec, confidence thresholds (85%/90%), replan triggers.
- **Feature areas (18+)** → [`docs/c_feature_areas.md`](../docs/c_feature_areas.md) — `FE-AAA-0001` or `FE-AAA-BBB-0001`; domains: POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV + sub-domain extensions (e.g. FE-POR-API-0001, FE-PAY-0001).
- **Error codes (cross-cutting)** → [`docs/c_c_error_codes.md`](../docs/c_c_error_codes.md) — adding codes via library migration, `reportError` call sites, severity mapping, decision tree.
- **Generic ranking + realtime adoption** → [`docs/c_c_ranking.md`](../docs/c_c_ranking.md) — checklist for new orderable resources: schema, NOTIFY trigger, Register, permission predicate, frontend hooks.
- **Addressable element substrate (PLA-0005)** → [`docs/c_c_addressables.md`](../docs/c_c_addressables.md) — `<Panel>`/`<Table>`/`<Navigation>` adopters, `samantha._viewport.<slot>._kind.name` addressing, `addressables.Service` sole-writer boundary, `lint:addressables` rule, Samantha SDK help contract.
- **Topology — federated org canvas (PLA-0006)** → [`docs/c_c_topology.md`](../docs/c_c_topology.md) — `/topology` page named `<tenant>: Topology`, default node noun "Office", `org_nodes` tree + single-admin `org_node_roles`, `orgdesign.Service` sole writer, clamp predicate middleware, archive = limbo.
- **Roles & permissions — data-driven RBAC (PLA-0007)** → [`docs/c_c_roles_permissions.md`](../docs/c_c_roles_permissions.md) — `roles`/`permissions`/`role_permissions` tables, 5 seeded system roles (stable UUIDs ad30/ad25/ad20/ad10/ad05), 26 seeded permissions, `internal/roles.Service` sole writer, `useHasPermission(<code>)` frontend gates, `lint:role-literals` + `lint:writer-boundary` enforcement.
- **Project lint rules (custom)** → [`docs/c_c_lint_rules.md`](../docs/c_c_lint_rules.md) — `lint:addressables`, `lint:role-literals`, `lint:writer-boundary`, `lint:dev-css`, `lint:secondary-nav`; python scripts under `dev/scripts/`, exemption ledgers under `dev/registries/`; `npm run lint:<name>` invocation.
- **Diagram canvas primitive (`<DiagramCanvas>`)** → [`docs/c_c_diagram_canvas.md`](../docs/c_c_diagram_canvas.md) — Vector-built Canvas2D + dagre + d3-zoom, 10px snap-to-grid default, pluggable node renderer, exposed via Samantha API as `samantha.diagram.canvas`.
- **Drag-and-drop convention (`@dnd-kit`)** → [`docs/c_c_dnd.md`](../docs/c_c_dnd.md) — canonical DnD library; sortable lists/tables/tabs use `@dnd-kit/sortable`; server is order of truth, 250ms debounce, no competing libs.

