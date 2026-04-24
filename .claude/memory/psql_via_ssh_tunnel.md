---
name: psql access via SSH tunnel
description: All psql/pg_dump access goes through SSH tunnel localhost:5434 → remote mmffdev.com:5432; never local Postgres
type: reference
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
The Vector PM Postgres lives in a Docker container on `mmffdev.com`, bound to loopback only. Laptop access is **exclusively** via SSH tunnel: `localhost:5434` → server `:5432`.

**Tunnel commands:**
- One-off setup: `bash dev/scripts/ssh_manager.sh` (writes SSH config alias + opens tunnel)
- Open tunnel: `ssh -N -f mmffdev-pg`
- Health check: `nc -z localhost 5434`
- Close: `pkill -f mmffdev-pg`

**psql template:**
```
PGPASSWORD=… psql -h localhost -p 5434 -U mmff_dev -d mmff_vector
```

**Port discipline:**
- `5434` = the tunnel — what every backend service, test, migration, and backup script uses
- `5432` = the remote container's internal port (tunnel destination, server side)
- `5433` = reserved for any locally-installed Postgres (commented-out fallback in `dev/scripts/ssh_manager.sh:268`); **not currently used**

**Where this applies:**
- Backend runtime (`backend/.env.local` → `DB_PORT=5434`)
- Integration tests (read `DB_PORT` env var)
- All `db/schema/*.sql` migration headers
- `<backupsql>` shortcut and `dev/scripts/backup-on-push.sh`
- `MMFF Vector Dev.app` watches port 5434 as the tunnel health indicator

If something tries to hit Postgres on a port other than 5434, it's a bug — there is no local DB to fall back to.
