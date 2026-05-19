---
name: audit
description: Run codebase audits and refresh their snapshot files. Flags — `-api` regenerates the siteAPI compliance snapshot at dev/audits/api-touchpoints.json by running dev/scripts/audit_api_touchpoints.sh (consumed by the /dev/api-audit page). More flags will be added later.
---

# `<audit>` Skill

One entrypoint for repo-wide audits. Flag-driven; each flag runs a specific audit script and reports the headline numbers. The audit scripts are the source of truth for compliance state — re-running keeps the corresponding dev page in sync.

Current flags:
| Flag | Script | Snapshot | Dev page |
|---|---|---|---|
| `-api` | [`dev/scripts/audit_api_touchpoints.sh`](../../../dev/scripts/audit_api_touchpoints.sh) | [`dev/audits/api-touchpoints.json`](../../../dev/audits/api-touchpoints.json) | [/dev/api-audit](../../../dev/pages/DevApiAuditPanel.tsx) |

Future flags (e.g. `-rbac`, `-routes`, `-css`) will live alongside `-api`; never break the `-api` contract.

---

## Flow — `-api`

### Step 1 — Run the audit

```bash
bash dev/scripts/audit_api_touchpoints.sh
```

The script is read-only — no DB connections, no network. Just grep + jq across `app/`, `dev/`, `.claude/skills/`. Runs in ~2 seconds. Idempotent; overwrites the snapshot.

### Step 2 — Report the headline

Echo the script's stderr summary to the user, formatted as:

```
API audit refreshed — <total> touchpoints
  🟢 Compliant: <green>     (apiSite / apiRoot / sanctioned)
  🟡 Warn:       <yellow>   (SSE / samanthaAPI-from-site)
  🔴 Bypass:     <red>      (raw fetch to /api/dev/* or /api/v2/*)
  ⛔ PG-Direct:  <black>    (Next.js handler → Postgres directly)
  ⚪ Unknown:    <grey>     (manual review)

Compliance: <pct>% green.
Snapshot: dev/audits/api-touchpoints.json
View: /dev/api-audit
```

The percentages come from the script itself; do not re-compute.

### Step 3 — Flag drift

If a previous snapshot exists at `dev/audits/api-touchpoints.json.prev` (we don't currently keep one — but the option is open for the future), diff totals and surface the delta:

> "Compliance went from 76% → 78% green (+8 compliant, −5 bypass)."

For now, just report current state.

---

## What the `-api` audit covers

- **Frontend touchpoints** — every `apiSite` / `apiV2` / `apiRoot` / `fetch(` / `EventSource` call in `app/**` and `dev/**`.
- **Shadow backend** — every `app/api/**/route.ts` handler, classified by whether it reads from Postgres directly (`black`), the filesystem (`green`), or shells out (`green`).
- **Scripts + skills** — every `psql` / `pg_dump` / `curl` in `dev/scripts/**`, `.claude/skills/**/SKILL.md`, `.claude/commands/c_*.md`. Sanctioned exceptions (backups, migrations, cookbook harvest) get green; everything else flags.

Not covered:
- Backend route mounts in `main.go` — chi's nested `r.Route()` prefixes need stateful parsing to classify correctly. Separate audit eventually.
- DB schema drift, RBAC ledger drift — those have their own (separate) audit channels.

---

## Error handling

| Failure | Response |
|---|---|
| `jq` not on PATH | "Missing dep: brew install jq. Aborting." |
| Script exits non-zero | Surface stderr verbatim. The snapshot is overwritten on success only — if the script crashes, the previous snapshot survives. |
| Script not executable | `chmod +x dev/scripts/audit_api_touchpoints.sh` first. |

---

## See also

- [`.claude/skills/artefacts/SKILL.md`](../artefacts/SKILL.md) — sibling skill, same flag-based shape (`<artefacts> -d`).
- [`docs/c_c_transport_segregation.md`](../../../docs/c_c_transport_segregation.md) — the rule being measured (`/_site` is the canonical BFF mount).
- [`backend/internal/portfoliomodels/dev_reset.go`](../../../backend/internal/portfoliomodels/dev_reset.go) — `ApiAudit` handler that serves the snapshot via `/_site/admin/dev/api-audit`.
