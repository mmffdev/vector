# Tools & Commands Index

Load when the user invokes a shortcut, command, or skill not listed in CLAUDE.md.

## Commands

- **Database backup (`<backupsql>`)** → [`.claude/commands/c_db-backup.md`](commands/c_db-backup.md) — dump remote Postgres to timestamped SQL file.
- **Dev server (`<npm>`)** → [`.claude/commands/c_npm.md`](commands/c_npm.md) — start Next.js on `:5101`.
- **Vector Launcher (`<launcher>`, `MMFF Vector Launcher.app`)** → [`.claude/commands/c_launcher.md`](commands/c_launcher.md) — SwiftUI dashboard with per-component start/stop/restart, env switch, JSONL log.
- **Boot file manager (`<b> -<N> -R|-C`, `<b> -A -C`)** → [`.claude/commands/c_boot.md`](commands/c_boot.md) — read (`-R`) or create/update (`-C`) numbered session snapshot; `-A -C` writes comprehensive master record `bootA.md`; lazy-loads on read.
- **Context scanner (`<memory> -A|-M|-S|-C|-H`)** → [`.claude/commands/c_memory.md`](commands/c_memory.md) — scans `.claude/` for health across memory, skills, commands, hooks; writes timestamped file to `dev/reports/`; view in Dev → Reports tab.
- **Shortcuts reference (`<?>`, `<?> -u`)** → [`.claude/commands/c_shortcuts.md`](commands/c_shortcuts.md) — open `dev/shortcuts.html` in browser; `-u` rescans all command + skill docs and regenerates the page.
- **Service status (`<services>`)** → [`.claude/commands/c_services.md`](commands/c_services.md) — read-only status check for backend (`:5100`), next (`:5101`), and the active env's DB tunnel (port per top-of-file `ACTIVE_BACKEND_ENV` marker).
- **Switch DB env (`<server> -d|-s|-p`)** → [`.claude/commands/c_server.md`](commands/c_server.md) — restarts backend on dev/staging/production env, ensures tunnel + frontend are up, rewrites top-of-file `ACTIVE_BACKEND_ENV` marker; `-p` requires typed confirmation.
- **Accounts & credentials (`<accounts>`)** → [`.claude/commands/c_accounts.md`](commands/c_accounts.md) — source of truth for all dev user accounts and passwords.
- **Section tags (`<user>`, `<gadmin>`, `<padmin>`, `<dev>`)** → [`docs/c_section-tags.md`](../docs/c_section-tags.md) — what each slice of the product means.
- **Work item URLs (`/item/<uuid>` canonical, `/item/TAG-NNNN` alias)** → [`docs/c_url-routing.md`](../docs/c_url-routing.md) — UUID route is permanent; tag alias 301s to it.
- **Bash commands** → [`docs/c_bash.md`](../docs/c_bash.md) — verified commands only; grouped by domain.
- **Postgres ops** → [`docs/c_postgresql.md`](../docs/c_postgresql.md) — tunnel, pg_dump, psql, migrations.
- **SSH reference** → [`docs/c_ssh.md`](../docs/c_ssh.md) — host aliases, key, tunnel lifecycle.
- **Deployment context** → [`docs/c_deployment.md`](../docs/c_deployment.md) — hosted vs on-prem, Docker container, DB name.
- **Backup on push** → [`docs/c_backup-on-push.md`](../docs/c_backup-on-push.md) — dual-channel; auto-snapshots pushed commits.
- **`<librarian>`** → [`.claude/commands/c_librarian.md`](commands/c_librarian.md) — run after major updates to sync docs with code and flag security issues.
- **`<tree>`** → [`.claude/commands/c_tree.md`](commands/c_tree.md) — audit the docs tree against the Authoring rule and patch index/leaf-shape violations.
- **Make UI app (`<makeapp> -<name> -<scope>`)** → [`.claude/commands/c_make-app.md`](commands/c_make-app.md) — scaffold a user-facing app in `app/store/ui_apps/ui_app_<name>/` with manifest, index, css, and registry entry.
- **Make dev UI app (`<makedevapp> -<name> -<scope>`)** → [`.claude/commands/c_make-dev-app.md`](commands/c_make-dev-app.md) — scaffold a developer-only app in `dev/store/ui_apps/ui_app_<name>/` with manifest, index, css (no registry).
- **Selenium Grid UI (`<seleniumup>`)** → [`.claude/commands/c_selenium.md`](commands/c_selenium.md) — pings the hub then opens `http://localhost:4444/ui/` in the browser.
- **Playwright MCP (`<playwright>`)** → [`.claude/commands/c_playwright.md`](commands/c_playwright.md) — disabled by default (21 tools); use Crawlio for browser automation; enable by renaming `.mcp.json.disabled` → `.mcp.json`.
- **Research agent (`/research`)** → [`.claude/commands/c_research.md`](commands/c_research.md) — crawl + web-search + compile structured reports; `--page` saves JSON to `dev/research/` viewable in Dev → Research tab.
- **Research paper shorthand (`<addpaper>`)** → [`.claude/commands/c_addpaper.md`](commands/c_addpaper.md) — web-search-only shortcut that writes `dev/research/RNNN.json` and optionally hands off to `/stories` for plan JSON stories.
- **Research paper format** → [`.claude/commands/c_research-paper-format.md`](commands/c_research-paper-format.md) — canonical JSON shape for PM research papers, content HTML rules, frontmatter.
- **Research paper stories** → [`.claude/commands/c_addpaper-stories.md`](commands/c_addpaper-stories.md) — synthesise story candidates from research; hands off to `/stories` for plan JSON writing.
- **Write research paper** → [`.claude/commands/c_write-research-paper.md`](commands/c_write-research-paper.md) — shared CREATE step; allocates R### ID, stamps date, writes JSON to `dev/research/`.
- **User custom pages** → [`docs/c_c_custom_pages.md`](../docs/c_c_custom_pages.md) — `user_custom_pages` table, `/p/<uuid>` route, backend API, nav integration.
- **Form drafts (IDB autosave)** → [`docs/c_c_form_drafts.md`](../docs/c_c_form_drafts.md) — `useDraft` hook, field classifier, logout purge, security posture.
- **Library release channel (Phase 3)** → [`docs/c_c_library_release_channel.md`](../docs/c_c_library_release_channel.md) — release tables, severity rendering, reconciler, ack flow, gadmin badge.
- **Dev Plans tab** → [`dev/pages/DevPlansPanel.tsx`](../dev/pages/DevPlansPanel.tsx) — first tab in `/dev`; renders `dev/plans/PLA-NNNN.json` via `/api/dev/plans` (lazy-loaded body).
- **Dev Retros tab** → [`dev/pages/DevRetrosPanel.tsx`](../dev/pages/DevRetrosPanel.tsx) — Ledger + Retrospectives sub-tabs; reads via `/api/dev/retros` (list, `?id=`, `?view=ledger`).

## Skills

- **Scope tracker (`<scope> -r|-a|-u`)** → [`.claude/skills/scope/SKILL.md`](skills/scope/SKILL.md) — `Vector_Scope.md` as single source of truth; `-r` opens discussion on in-flight items, `-a` adds from session context, `-u` runs codebase check and applies ✅/🔵/❌/⚠️ markers + P1–P5 priority; commit hook appends notes per item; session-start hook surfaces in-flight count.

- **Retro skill (`<r>`, `/retro`)** → [`.claude/skills/retro/SKILL.md`](skills/retro/SKILL.md) — 5-Whys + reversal; auto-fires on LOOP DETECTED; writes `dev/retros/RETRO-NNN.json` + LEDGER; sev-4+ findings logged to tech debt; index at [`docs/c_retro_index.md`](../docs/c_retro_index.md).
- **`/writeweb` skill** → [`.claude/skills/writeweb/SKILL.md`](skills/writeweb/SKILL.md) — Human-AI collaborative website copy; flags `-t hero|feature|faq|about|explainer`, `-len`, `-context`, `-h`.
- **`<theme>` skill** → [`.claude/skills/theme/SKILL.md`](skills/theme/SKILL.md) — image → Vector theme pack; deterministic L/C/H bucket → role mapping; spec at [`docs/c_theme_rules.md`](../docs/c_theme_rules.md).
- **`<chart>` skill (`-m` make from image, `-p` place from plan)** → [`.claude/skills/chart/SKILL.md`](skills/chart/SKILL.md) — themed chart component in `app/components/`, stub data, sanitised preview random generator, dashboard catalog entry.
- **`<css>` skill (`<css> <target>`, `--apply`, `--strip-debug`)** → [`.claude/skills/css/SKILL.md`](skills/css/SKILL.md) — audit a named element against the CSS/HTML naming convention; output violations + full TSX+CSS proposal; apply renames after confirmation.
- **`<search>` skill (`<search> <term>`, `--case-sensitive`)** → [`.claude/skills/search/SKILL.md`](skills/search/SKILL.md) — fan-out repo search; 4 parallel Haiku sub-agents over frontend / backend / infra-docs-tooling / assets-other buckets; returns one collated `file:line — snippet` report grouped by area.
- **`<treelist>` skill** → [`.claude/skills/treelist/SKILL.md`](skills/treelist/SKILL.md) — canonical SVG tree-connector pattern (│ ├ └) for any depth; Spine component, ancestorMoreChildren encoding, workspace isolation rule, CSS checklist.
- **`<migration>` skill (`<migration> [vector|artefacts|library] [slug]`, `--backfill <file>`)** → [`.claude/skills/migration/SKILL.md`](skills/migration/SKILL.md) — pick DB, compute next NNN descending, scaffold `db/<dbname>/schema/NNN_<slug>.sql` with header + `BEGIN;`/`COMMIT;` wrapper, dry-run, apply, verify `schema_migrations`; always targets `backend/.env.dev`; backfill mode records a manually-applied file.
