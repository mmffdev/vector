# vector-dev swarm stack

Source of truth for the dev Postgres tier, Valkey cache, and Valkey browser UI on host `vector-dev-pg` (77.68.33.216).

Before 2026-05-18 the stack was deployed entirely out-of-band — running services existed only as in-memory Swarm specs with no repo record. That made `pg_stat_statements` enablement (added via `docker service update --args …`) silently re-deployment-fatal: a future `docker stack rm vector-dev && docker stack deploy …` from a forgotten compose file would have lost the preload. This file is the fix.

## Files

- [`vector-dev-stack.yml`](vector-dev-stack.yml) — declarative stack: `postgres` (pgvector, with pg_stat_statements), `adminer`, `homepage`, `valkey` on `6379`, and read-only `valkey_ui` on `3003`. Image digests pinned where it matters (postgres). External secrets: `postgres_password`, `valkey_password`.

## Deploy / re-deploy

```bash
# From the manager node (vector-dev-pg):
ssh -o ClearAllForwardings=yes vector-dev-pg 'docker secret inspect valkey_password >/dev/null 2>&1 || openssl rand -base64 48 | docker secret create valkey_password - >/dev/null'
scp -o ClearAllForwardings=yes infra/swarm/vector-dev-stack.yml vector-dev-pg:/tmp/
ssh -o ClearAllForwardings=yes vector-dev-pg "docker stack deploy -c /tmp/vector-dev-stack.yml vector-dev"
```

`docker stack deploy` is idempotent — running it against an already-deployed stack diffs the spec and rolls only the changed services. Postgres roll = ~5-10s of dropped connections (backend pgxpool reconnects automatically; SSH tunnel survives).

## Before a deploy

1. **Backup all three DBs** via `<backupsql>` (canonical recipe in [`.claude/commands/c_db-backup.md`](../../.claude/commands/c_db-backup.md)).
2. **Diff first.** Pull the live spec (instructions below) and diff against `vector-dev-stack.yml`. If they don't match, **the live spec drifted** — either reconcile the file or back out the live change. Never deploy when the file is behind reality.

## Re-syncing the file with the live spec

If anyone ever changes a service out-of-band (`docker service update …`), pull the change back into the file:

```bash
ssh -o ClearAllForwardings=yes vector-dev-pg 'for s in vector-dev_postgres vector-dev_adminer vector-dev_homepage vector-dev_valkey vector-dev_valkey_ui; do
  echo "=== $s ==="
  docker service inspect "$s" --format "
image: {{.Spec.TaskTemplate.ContainerSpec.Image}}
args: {{.Spec.TaskTemplate.ContainerSpec.Args}}
env:{{range .Spec.TaskTemplate.ContainerSpec.Env}}
  - {{.}}{{end}}
mounts:{{range .Spec.TaskTemplate.ContainerSpec.Mounts}}
  - type={{.Type}} source={{.Source}} target={{.Target}}{{end}}
secrets:{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}
  - name={{.SecretName}} mode={{.File.Mode}}{{end}}
ports:{{range .Endpoint.Ports}}
  - {{.PublishedPort}}:{{.TargetPort}}/{{.Protocol}}{{end}}
replicas: {{.Spec.Mode.Replicated.Replicas}}
"
done'
```

Compare the output to `vector-dev-stack.yml`. Patch the file, commit, then deploy.

## What lives outside this stack file

- **Host bind-mount** for homepage config: `/opt/vector-dev/homepage-config` on the manager node. Ops-owned; not version-controlled here.
- **External secrets** `postgres_password`, `valkey_password`: created out-of-band via `docker secret create`. Referenced as `external: true` in the stack file. Rotation procedure for Postgres is documented in `vector-dev-stack.yml` comments.
- **`pgdata` volume**: holds the entire dev DB tier. Backups live in `local-assets/backups/` (and iCloud mirror) via `<backupsql>`. **Never delete this volume.**
- **`valkeydata` volume**: holds Valkey append-only persistence. Keep it unless deliberately rebuilding the cache substrate.

## Smoke test

The boot path verifies pg_stat_statements is still preloaded after any restart — see `dev/scripts/ssh_manager.sh` (`pg_stat_statements check` step). If the check fails after a deploy, the args block in `vector-dev-stack.yml` was dropped or overridden; re-apply the file.

Valkey smoke test:

```bash
ssh -o ClearAllForwardings=yes vector-dev-pg 'cid=$(docker ps -q --filter label=com.docker.swarm.service.name=vector-dev_valkey | head -n1); docker exec "$cid" sh -lc "valkey-cli -a \"$(cat /run/secrets/valkey_password)\" ping"'
```

Valkey UI smoke test:

```bash
# 1. SPA shell — should 200 (Redis Commander serves the HTML shell unauthenticated)
curl -s -o /dev/null -w "shell %{http_code}\n" http://localhost:3003/

# 2. API call without auth — should 401 with body "Unauthorized - Missing Token"
#    (this is correct behaviour — the SPA performs the auth handshake in the browser)
curl -s http://localhost:3003/apiv2/server/info

# 3. Full auth handshake — POST credentials to /signin (NOT /login), get JWT, hit API
PASS=$(cat /tmp/vector-valkey-password)
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"username\":\"vector\",\"password\":\"${PASS}\"}" \
  http://localhost:3003/signin | python3 -c 'import json,sys; print(json.load(sys.stdin)["bearerToken"])')
curl -s -H "Authorization: Bearer ${TOKEN}" \
  http://localhost:3003/apiv2/server/info | python3 -m json.tool | head -20
```

**Browser usage:**

1. Open `http://localhost:3003` (via SSH tunnel for remote, direct on the swarm host).
2. Login modal appears. Username `vector`; password is the contents of the `valkey_password` Docker secret — locally cached at `/tmp/vector-valkey-password` after install. `cat /tmp/vector-valkey-password | pbcopy` copies it without echoing.
3. After login: left sidebar lists "Vector Valkey" → DB 0–15. Empty until S12 of PLA067 lands the PendingStore implementation and starts writing debounce/digest ZSETs.

**Auth model (gotcha worth knowing):** Redis Commander does NOT use HTTP basic auth even though `--http-auth-username` and `--http-auth-password` are passed at start. Those flags configure a JWT-backed session — `/signin` is the login endpoint (not `/login`), it returns `{bearerToken, queryToken}`, and every `/apiv2/*` call requires `Authorization: Bearer <jwt>`. A 401 "Unauthorized - Missing Token" on `/apiv2/*` without the token is correct, expected behaviour, NOT a misconfiguration. The SPA shell at `/` serves unauthenticated so the browser can load the login JS.

**UI is read-only:** the service starts with `--read-only --nosave --no-log-data` so the browser cannot mutate Valkey state. Inspect-only — the right posture for a dev cache that backend code writes to.
