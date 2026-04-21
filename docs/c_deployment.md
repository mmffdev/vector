# Deployment context

> Last verified: 2026-04-21

How the platform runs, where the boundaries are, and what about "deploy" is different depending on which mode a customer chose.

## Stack

- **Frontend:** Next.js 15 (App Router), React, plain CSS + CSS variables — see [css-guide.md](css-guide.md).
- **Backend:** Go (see `backend/internal/**`).
- **Database:** PostgreSQL 16 in Docker — [c_postgresql.md](c_postgresql.md).
- **Host OS:** Ubuntu LTS under Plesk.
- **Control panel:** Plesk on the host.

## Two deployment modes (SoW §1.1)

The same container images and schema run in both modes. The schema is portable between them.

### Hosted (cloud)

- Operated by us. Customers are tenants on shared infrastructure.
- We run upgrades, backups, and monitoring.
- Default route for most customers.
- Single Postgres instance, tenant-isolated by row (see [c_schema.md](c_schema.md) invariant 1).

### On-premise

- Operated by the customer inside their own environment.
- Customer controls hosts, network boundary, upgrade cadence.
- Introduces an **update-distribution** concern that hosted doesn't have: how does a release reach the customer and apply its migrations safely?

Planned (not yet built) for on-prem: signed release artefacts, opt-in customer-side updater, explicit version pinning, deterministic migration ordering driven from `db/schema/*.sql`. Called out in SoW §1.1 so it doesn't get forgotten during capacity planning. Does NOT change the schema.

## Containers

Only one runtime container today:

- **`mmff-ops-postgres`** — Postgres 16. Bound to host loopback only; never exposed to the public internet. Reached from the laptop via SSH tunnel (see [c_ssh.md](c_ssh.md)).

Frontend/backend processes run outside Docker today (`npm run dev` for the frontend — see [c_npmrun.md](c_npmrun.md); Go binary for the backend). This will change when we package for on-prem distribution.

## Environments

| Environment | Where | How to reach |
|---|---|---|
| Local dev | laptop | `npm run dev`, tunnel → remote DB |
| Staging | `mmffdev.com` | SSH (`mmffdev-admin`), Plesk |
| Production | TBD | no prod DB yet |

## Secrets

- `backend/.env.local` — local DB password. **Gitignored.** One line per var.
- SSH keys — `~/.ssh/id_ed25519` (root@mmffdev.com), `~/.ssh/mmffdev` (Plesk user).
- No secrets in the repo. No `.env` files committed.

## Database name and role (every time, always)

- DB: `mmff_vector`
- Role: `mmff_dev`
- Port (via tunnel): `5434` → `5432` on the host.

## Related docs

- [c_postgresql.md](c_postgresql.md) — reaching the DB.
- [c_ssh.md](c_ssh.md) — host aliases.
- [c_db-backup.md](c_db-backup.md) — snapshotting the DB (`<backupsql>`).
- [c_backup-on-push.md](c_backup-on-push.md) — auto-snapshot on every push.
