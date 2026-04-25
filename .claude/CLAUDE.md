# CLAUDE.md

Guidance for Claude Code in this repo.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule (hard):** every entry in this file is one line. If it needs more, it goes in a child doc under `docs/c_*.md` and this file gets only the pointer. No exceptions — not for commands, not for shortcuts, not for "just this once". If you catch yourself writing a second line, stop and move it.

**Standing rule (hard):** every task maintains the technical-debt register — identify, measure (S1/S2/S3 + trigger), recommend (cap now, pay-down on trigger). See [`docs/c_tech_debt.md`](../docs/c_tech_debt.md).

- **Styling / CSS / new UI components** → [`docs/css-guide.md`](../docs/css-guide.md) — BEM-lite, no inline styles, rules in `app/globals.css`.
- **Database backup (`<backupsql>`)** → [`.claude/commands/c_db-backup.md`](commands/c_db-backup.md) — dump remote Postgres to timestamped SQL file.
- **Backlog (`<backlog>`)** → [`docs/c_backlog.md`](../docs/c_backlog.md) — Planka kanban via MCP; tunnel `:3333`; flags `-a/-n/-d/-accept/-h`; children: agent contract, dedup check, REST templates.
- **Dev server (`<npm>`)** → [`.claude/commands/c_npm.md`](commands/c_npm.md) — start Next.js on `:3000`.
- **Dev launcher (`MMFF Vector Dev.app`)** → [`.claude/commands/c_dev-launcher.md`](commands/c_dev-launcher.md) — AppleScript app that starts tunnel, backend, frontend.
- **Service status (`<services>`)** → [`.claude/commands/c_services.md`](commands/c_services.md) — read-only status check for tunnel (`:5434`), backend (`:5100`), next (`:5101`).
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
- **Make UI app (`<makeapp> -<name> -<scope>`)** → [`.claude/commands/c_make-app.md`](commands/c_make-app.md) — scaffold a user-facing app in `app/store/ui_apps/ui_app_<name>/` with manifest, index, css, and registry entry.
- **Make dev UI app (`<makedevapp> -<name> -<scope>`)** → [`.claude/commands/c_make-dev-app.md`](commands/c_make-dev-app.md) — scaffold a developer-only app in `dev/store/ui_apps/ui_app_<name>/` with manifest, index, css (no registry).
- **Selenium Grid UI (`<seleniumup>`)** → [`.claude/commands/c_selenium.md`](commands/c_selenium.md) — pings the hub then opens `http://localhost:4444/ui/` in the browser.
- **User custom pages** → [`docs/c_c_custom_pages.md`](../docs/c_c_custom_pages.md) — `user_custom_pages` table, `/p/<uuid>` route, backend API, nav integration.
- **Form drafts (IDB autosave)** → [`docs/c_c_form_drafts.md`](../docs/c_c_form_drafts.md) — `useDraft` hook, field classifier, logout purge, security posture.
- **Library release channel (Phase 3)** → [`docs/c_c_library_release_channel.md`](../docs/c_c_library_release_channel.md) — release tables, severity rendering, reconciler, ack flow, gadmin badge.
- **Planka REST templates** → [`docs/c_c_planka_rest.md`](../docs/c_c_planka_rest.md) — child of `c_backlog`; auth, create (MCP), move, comment, board fetch, parallel scan, gotchas.

