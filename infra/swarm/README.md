# vector-dev swarm stack

Source of truth for the dev Postgres tier on host `vector-dev-pg` (77.68.33.216).

Before 2026-05-18 the stack was deployed entirely out-of-band — running services existed only as in-memory Swarm specs with no repo record. That made `pg_stat_statements` enablement (added via `docker service update --args …`) silently re-deployment-fatal: a future `docker stack rm vector-dev && docker stack deploy …` from a forgotten compose file would have lost the preload. This file is the fix.

## Files

- [`vector-dev-stack.yml`](vector-dev-stack.yml) — declarative stack: `postgres` (pgvector, with pg_stat_statements), `adminer`, `homepage`. Image digests pinned where it matters (postgres). External secret `postgres_password`.

## Deploy / re-deploy

```bash
# From the manager node (vector-dev-pg):
scp infra/swarm/vector-dev-stack.yml vector-dev-pg:/tmp/
ssh vector-dev-pg "docker stack deploy -c /tmp/vector-dev-stack.yml vector-dev"
```

`docker stack deploy` is idempotent — running it against an already-deployed stack diffs the spec and rolls only the changed services. Postgres roll = ~5-10s of dropped connections (backend pgxpool reconnects automatically; SSH tunnel survives).

## Before a deploy

1. **Backup all three DBs** via `<backupsql>` (canonical recipe in [`.claude/commands/c_db-backup.md`](../../.claude/commands/c_db-backup.md)).
2. **Diff first.** Pull the live spec (instructions below) and diff against `vector-dev-stack.yml`. If they don't match, **the live spec drifted** — either reconcile the file or back out the live change. Never deploy when the file is behind reality.

## Re-syncing the file with the live spec

If anyone ever changes a service out-of-band (`docker service update …`), pull the change back into the file:

```bash
ssh vector-dev-pg 'for s in vector-dev_postgres vector-dev_adminer vector-dev_homepage; do
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
- **External secret** `postgres_password`: created out-of-band via `docker secret create`. Referenced as `external: true` in the stack file. Rotation procedure documented in `vector-dev-stack.yml` comments.
- **`pgdata` volume**: holds the entire dev DB tier. Backups live in `local-assets/backups/` (and iCloud mirror) via `<backupsql>`. **Never delete this volume.**

## Smoke test

The boot path verifies pg_stat_statements is still preloaded after any restart — see `dev/scripts/ssh_manager.sh` (`pg_stat_statements check` step). If the check fails after a deploy, the args block in `vector-dev-stack.yml` was dropped or overridden; re-apply the file.
