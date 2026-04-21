# CLAUDE.md

Guidance for Claude Code in this repo.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule (hard):** every entry in this file is one line. If it needs more, it goes in a child doc under `docs/c_*.md` and this file gets only the pointer. No exceptions — not for commands, not for shortcuts, not for "just this once". If you catch yourself writing a second line, stop and move it.

- **Styling / CSS / new UI components** → [`docs/css-guide.md`](../docs/css-guide.md) — BEM-lite, no inline styles, rules in `app/globals.css`.
- **Database backup (`<backupsql>`)** → [`docs/c_db-backup.md`](../docs/c_db-backup.md) — dump remote Postgres to timestamped SQL file.
- **Dev server (`<npmrun>`)** → [`docs/c_npmrun.md`](../docs/c_npmrun.md) — start Next.js on `:3000`.
- **Section tags (`<user>`, `<gadmin>`, `<padmin>`, `<dev>`)** → [`docs/c_section-tags.md`](../docs/c_section-tags.md) — what each slice of the product means.
- **Work item URLs (`/item/<uuid>` canonical, `/item/TAG-NNNN` alias)** → [`docs/c_url-routing.md`](../docs/c_url-routing.md) — UUID route is permanent; tag alias 301s to it.
- **Database schema** → [`docs/c_schema.md`](../docs/c_schema.md) — table list, tenant isolation, soft-archive, invariants; links to per-table leaves.
- **Bash commands** → [`docs/c_bash.md`](../docs/c_bash.md) — verified commands only; grouped by domain.
- **Postgres ops** → [`docs/c_postgresql.md`](../docs/c_postgresql.md) — tunnel, pg_dump, psql, migrations.
- **SSH reference** → [`docs/c_ssh.md`](../docs/c_ssh.md) — host aliases, key, tunnel lifecycle.
- **Deployment context** → [`docs/c_deployment.md`](../docs/c_deployment.md) — hosted vs on-prem, Docker container, DB name.
- **App Router layout** → [`docs/c_page-structure.md`](../docs/c_page-structure.md) — route groups, role gating, PageShell.
- **Security posture** → [`docs/c_security.md`](../docs/c_security.md) — Trust-No-One checklist; librarian scans against it.
- **Backup on push** → [`docs/c_backup-on-push.md`](../docs/c_backup-on-push.md) — dual-channel; auto-snapshots pushed commits.
- **`<librarian>`** → [`docs/c_librarian.md`](../docs/c_librarian.md) — run after major updates to sync docs with code and flag security issues.
