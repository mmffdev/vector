# Adminer — web DB UI

> Parent: [c_postgresql.md](c_postgresql.md)
> Last verified: 2026-04-24

Adminer 4 in Docker on `mmffdev.com`, reachable from the laptop through the SSH tunnel at [http://localhost:8081](http://localhost:8081). It's the "phpMyAdmin for Postgres" — single-file PHP UI for browsing tables, editing rows, running SQL.

## Access

1. Tunnel up: `ssh -N -f mmffdev-pg` (forwards `5434` and `8081` — see [c_ssh.md](c_ssh.md)).
2. TCP check: `nc -z localhost 8081`.
3. Open [http://localhost:8081](http://localhost:8081).

Login fields:

| Field | Value |
|---|---|
| System | PostgreSQL |
| Server | `mmff-ops-postgres` (pre-filled via `ADMINER_DEFAULT_SERVER`) |
| Username | `mmff_dev` |
| Password | from `backend/.env.local` → `DB_PASSWORD` |
| Database | `mmff_vector` |

## Security posture

Matches Postgres: container listens on `127.0.0.1:8081` on the server (loopback-only, never exposed to the public internet). The only way to reach it from the laptop is the SSH tunnel. If the tunnel is down, Adminer is unreachable — this is intentional.

## Container lifecycle (on the server)

All commands run via `ssh mmffdev-admin`.

### Start (first time / after removal)

```bash
docker run -d \
  --name adminer \
  --restart unless-stopped \
  --network mmff-ops-db_default \
  -p 127.0.0.1:8081:8080 \
  -e ADMINER_DEFAULT_SERVER=mmff-ops-postgres \
  -e ADMINER_DESIGN=dracula \
  adminer:4
```

The `--network` flag puts Adminer on the same Docker network as `mmff-ops-postgres`, so the server field can use the container name as hostname.

### Check status

```bash
docker ps --filter name=adminer
docker logs --tail 20 adminer
```

### Stop / start / restart

```bash
docker stop adminer
docker start adminer
docker restart adminer
```

### Remove entirely

```bash
docker stop adminer && docker rm adminer
```

No volumes — Adminer is stateless, so removal is clean.

### Upgrade

```bash
docker pull adminer:4
docker stop adminer && docker rm adminer
# then re-run the Start command above
```

## Gotchas

1. **Dead page on http://localhost:8081**. The tunnel is stale (started before the `LocalForward 8081` line was added). Kill and restart: `pkill -f 'ssh -N.*-L 5434:localhost:5432.*root@mmffdev.com' ; ssh -N -f mmffdev-pg`. Verify with `nc -z localhost 8081`.
2. **"Server refused the connection"** inside Adminer. Means the login hit Adminer but Adminer can't reach Postgres — usually the server field got edited away from `mmff-ops-postgres`. Reset it.
3. **Don't bind to `0.0.0.0`**. The `127.0.0.1:8081:8080` form is deliberate — changing it to `-p 8081:8080` exposes Adminer to the public internet.
