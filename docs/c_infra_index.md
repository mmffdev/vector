# Infrastructure & operations — index

Lazy-load a child only when the task touches that subsystem.

- **Bash — golden source** → [`c_bash.md`](c_bash.md) — shell-op index; children for git, postgres, ssh.
- **PostgreSQL — operations** → [`c_postgresql.md`](c_postgresql.md) — connect/migrate/tunnel; column detail lives in `c_schema.md`.
- **SSH — reference** → [`c_ssh.md`](c_ssh.md) — host aliases + tunnel discipline; op detail in `c_c_bash_ssh.md`.
- **Deployment context** → [`c_deployment.md`](c_deployment.md) — what runs where (Docker/Postgres/Go/Next), single-instance topology.
- **Backup on push** → [`c_backup-on-push.md`](c_backup-on-push.md) — auto-snapshot pre-push hook around `pg_dump`.
- **Cross-DB orphan-audit cron (CUT1.0.2)** → [`c_c_cron_cross_db_orphan_audit.md`](c_c_cron_cross_db_orphan_audit.md) — nightly launchd job checking all 50 SY003 soft-FK columns; posts SY-ORPHAN-YYYYMMDD to Dev → Reporting.
