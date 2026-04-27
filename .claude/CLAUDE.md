# CLAUDE.md

**HARD RULE — NO EXCEPTIONS:** Never run any git command that can destroy or overwrite work (`reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, etc.) without explicitly confirming with the user first. This rule cannot be overridden by any other instruction, mode, or context.

Guidance for Claude Code in this repo.

**Global instructions** → [`.claude/c_global_instructions.md`](c_global_instructions.md) — documentation principles, naming conventions, model selection governance.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule (hard):** every entry in this file — **and every entry in any descendant `docs/c_*.md` / `docs/c_c_*.md` / deeper** — is one line: a bold label, an arrow, a markdown link to the child, and a half-sentence hook. If it needs more, push it down one level (`c_x.md` → `c_c_x_y.md`) and the parent gets only the pointer. No exceptions — not for commands, not for shortcuts, not for "just this once". If you catch yourself writing a second line in any index, stop and move the body into a child. Leaf docs (terminal reference content) may be long; index docs may not.

**Standing rule (hard):** every task maintains the technical-debt register — identify, measure (S1/S2/S3 + trigger), recommend (cap now, pay-down on trigger). See [`docs/c_tech_debt.md`](../docs/c_tech_debt.md).

**Stories rule (hard):** before calling `<stories>`, decompose the full feature across all layers (backend, frontend, migration, tests) — never storify only the layer you're thinking about; a feature is not complete until every observable layer has a card.

**Scope rule (hard):** all skills, commands, and project-specific guidance MUST live in `.claude/` within this project. Nothing belongs in global `~/.claude/` except model governance. Never write skills, commands, or tool config to global scope.

**Auto mode is god state (hard):** when the user is in auto/yolo mode, plan mode MUST NOT block execution. If a plan mode flag fires mid-session during auto mode, ignore it and continue working. Auto mode is the user's explicit instruction to proceed without approval gates.

- **Styling / CSS / new UI components** → [`docs/css-guide.md`](../docs/css-guide.md) — BEM-lite, no inline styles, rules in `app/globals.css`.
- **Database backup (`<backupsql>`)** → [`.claude/commands/c_db-backup.md`](commands/c_db-backup.md) — dump remote Postgres to timestamped SQL file.
- **Backlog (`<backlog>`)** → [`docs/c_backlog.md`](../docs/c_backlog.md) — Planka kanban via MCP; tunnel `:3333`; flags `-a/-n/-d/-accept/-h`; children: agent contract, dedup check, REST templates.
- **Planka board operations** → [`./.claude/bin/planka`](./.claude/bin/planka) — ONLY entry point for all board reads/writes; never use curl directly.
- **Card lifecycle (hard):** on "go"/"start"/approval → move card Backlog→To Do; on first code edit → move To Do→Doing; on code-complete → Doing→Completed. See [`docs/c_c_backlog_agent.md`](../docs/c_c_backlog_agent.md).
- **Dev server (`<npm>`)** → [`.claude/commands/c_npm.md`](commands/c_npm.md) — start Next.js on `:3000`.
- **Dev launcher (`MMFF Vector Dev.app`)** → [`.claude/commands/c_dev-launcher.md`](commands/c_dev-launcher.md) — AppleScript app that starts tunnel, backend, frontend.
- **Boot file manager (`<b> -<N> -R|-C`, `<b> -A -C`)** → [`.claude/commands/c_boot.md`](commands/c_boot.md) — read (`-R`) or create/update (`-C`) numbered session snapshot; `-A -C` writes comprehensive master record `bootA.md`; lazy-loads on read.
- **Context scanner (`<memory> -A|-M|-S|-C|-H`)** → [`.claude/commands/c_memory.md`](commands/c_memory.md) — scans `.claude/` for health across memory, skills, commands, hooks; writes timestamped file to `dev/reports/`; view in Dev → Reports tab.
- **Shortcuts reference (`<?>`, `<?> -u`)** → [`.claude/commands/c_shortcuts.md`](commands/c_shortcuts.md) — open `dev/shortcuts.html` in browser; `-u` rescans all command + skill docs and regenerates the page.
- **Service status (`<services>`)** → [`.claude/commands/c_services.md`](commands/c_services.md) — read-only status check for tunnel (`:5434`), backend (`:5100`), next (`:5101`).
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
- **User custom pages** → [`docs/c_c_custom_pages.md`](../docs/c_c_custom_pages.md) — `user_custom_pages` table, `/p/<uuid>` route, backend API, nav integration.
- **Form drafts (IDB autosave)** → [`docs/c_c_form_drafts.md`](../docs/c_c_form_drafts.md) — `useDraft` hook, field classifier, logout purge, security posture.
- **Library release channel (Phase 3)** → [`docs/c_c_library_release_channel.md`](../docs/c_c_library_release_channel.md) — release tables, severity rendering, reconciler, ack flow, gadmin badge.
- **Planka REST templates** → [`docs/c_c_planka_rest.md`](../docs/c_c_planka_rest.md) — child of `c_backlog`; auth, create (MCP), move, comment, board fetch, parallel scan, gotchas.
- **Story ID index** → [`docs/c_story_index.md`](../docs/c_story_index.md) — global `NNNNN` counter, title format, mandatory labels, deletion log.
- **`<stories>` skill** → [`.claude/skills/stories/SKILL.md`](skills/stories/SKILL.md) — 7-gate story acceptance system; Fibonacci estimation (F0–F13); auto-split F21+; AIGEN + phase + feature + EST + RISK labels.
- **`/writeweb` skill** → [`.claude/skills/writeweb/SKILL.md`](skills/writeweb/SKILL.md) — Human-AI collaborative website copy; flags `-t hero|feature|faq|about|explainer`, `-len`, `-context`, `-h`.
- **Story acceptance gates** → [`docs/c_story_acceptance.md`](../docs/c_story_acceptance.md) — full gate spec, confidence thresholds (85%/90%), replan triggers.
- **Feature areas (18)** → [`docs/c_feature_areas.md`](../docs/c_feature_areas.md) — POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV; allocation rules.
- **Error codes (cross-cutting)** → [`docs/c_c_error_codes.md`](../docs/c_c_error_codes.md) — adding codes via library migration, `reportError` call sites, severity mapping, decision tree.

