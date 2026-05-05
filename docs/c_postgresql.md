# PostgreSQL — operations overview

> Last verified: 2026-04-21

Where the DB lives, how you reach it, and how to run things against it.

## Where it lives

- **Remote primary** — Postgres 16 in Docker container `mmff-ops-postgres` on `mmffdev.com`. Port `5432` inside the container, bound to the host's loopback only (never exposed to the public internet).
- **Local access** — SSH tunnel on `localhost:5434` → `server:5432`. That tunnel is the ONLY way the laptop reaches the DB.
- **Database name** — `mmff_vector`.
- **App role** — `mmff_dev`. Password in `backend/.env.local` (`DB_PASSWORD=…`).

## Reach it in three steps

1. Tunnel up: `ssh -N -f mmffdev-pg` (see [c_c_bash_ssh.md](c_c_bash_ssh.md)).
2. TCP check: `nc -z localhost 5434`.
3. SQL check: `psql … -c 'SELECT 1;'` (see [c_c_bash_postgres.md](c_c_bash_postgres.md)).

If any step fails, don't skip forward — the later ones depend on earlier.

## Leaves

| Topic | Leaf |
|---|---|
| Apply a migration, verify its effect | [c_c_postgresql_migrations.md](c_c_postgresql_migrations.md) |
| Tunnel lifecycle (start, stop, health-check) | [c_c_postgresql_tunnel.md](c_c_postgresql_tunnel.md) |
| Introspection cookbook + backfill verification recipes | [c_c_db_playbook.md](c_c_db_playbook.md) |

## Gotchas that bite

1. **`pg_dump` not on PATH.** libpq is keg-only on macOS — use the absolute path `/opt/homebrew/opt/libpq/bin/pg_dump`. Shim it in a shell alias at your own risk; scripts should always use the full path.
2. **Port 5434, not 5433.** `5433` is the local dev Postgres (if you ever run one). `5434` is the tunnel to remote. They are different databases with different data; do not mix them up.
3. **`ON ERROR STOP` missing** will silently half-apply a migration. Always pass `-v ON_ERROR_STOP=1` to `psql` when running `-f`.
4. **Role naming**. The seed role is `mmff_dev`, NOT `mmffdev` or `mmff_vector_admin`. `psql -U mmff_dev` is correct.

## Schema

Column-level detail for every table lives in [c_schema.md](c_schema.md) and its leaves. This file is about *talking to* the DB, not what's in it.
