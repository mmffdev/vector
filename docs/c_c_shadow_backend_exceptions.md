# Shadow-backend exemptions

> **Index entry:** [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) and the parent index, `docs/c_c_transport_segregation.md`. This leaf doc captures the narrow, named exemptions to the "every site DB-touch goes through siteAPI" rule.

The Vector rule, as enforced by the [API audit](../dev/scripts/audit_api_touchpoints.sh) and surfaced on [/dev/api-audit](../dev/pages/DevApiAuditPanel.tsx):

> Every code path on the site that touches the database MUST route through the Go backend's `/_site/*` mount, called via `apiSite()`. Direct `fetch()` to Next.js shadow routes (`app/api/**`), and pg-direct connections from Next.js handlers, are forbidden.

This document lists the **exemptions** — Next.js handlers under `app/api/dev/*` that the audit treats as compliant despite living in the shadow tree. They are exempted because they **do not touch a database**; they read files from the repo on disk. The SOC2 control we are enforcing is about database access, not about filesystem reads of public repository content.

---

## Exempted handlers (sanctioned-shadow)

All handlers below live under `app/api/dev/*` and are read-only against the local filesystem. None query Postgres, none mutate state on disk, none accept user-data input. They serve dev-tools-only data to gadmin-only panels under `/dev/<tab>`.

| Route | Reads | Consumer |
|---|---|---|
| `/api/dev/api-changelog` | `api-snapshots/` (markdown + JSON snapshot files) | `DevApiChangelogPanel.tsx` |
| `/api/dev/go-test` | spawns `go test <pkg>` (read-only execution) | `DevApiV2TestsPanel.tsx` |
| `/api/dev/library` | `docs/` + `dev/planning/` directory listings | `DevLibrary` panel |
| `/api/dev/memory-reports` | `dev/reports/` (markdown snapshots) | `DevReportsPanel.tsx` |
| `/api/dev/operations` | `dev/operations/` (JSON) | `DevOperationsPanel.tsx` |
| `/api/dev/plans` | `dev/plans/` (JSON) | `DevPlansPanel.tsx` |
| `/api/dev/research` | `dev/research/` (JSON) | `DevResearchPanel.tsx` |
| `/api/dev/retros` | `dev/retros/` (JSON) | `DevRetrosPanel.tsx` |
| `/api/dev/scope` | `Vector_Scope.md` (markdown) | `DevScopePanel.tsx` |
| `/api/dev/security-audits` | `dev/security-audits/` (JSON) | `DevSecurityAuditsListPanel.tsx` |
| `/api/dev/services` | TCP probes against `localhost:5100`/`localhost:5432`/etc. | `useServiceHealth.ts`, floating health indicator |

The audit script's `SANCTIONED_SHADOW_PATHS` array is the canonical list — keep this table in sync. To add a route: add it to the array AND to this table; remove a route by deleting from both.

---

## Why exempt instead of migrate

A migration would mean: replace each handler with a Go endpoint under `/_site/admin/dev/<area>` that reads the same files server-side and returns the same JSON. That delivers:

- **Symmetry** — every dev-panel call goes through the same gate.
- **No SOC2 gain** — these handlers don't read tenant data, don't write anywhere, and don't expose anything a gadmin couldn't get by opening the files directly.
- **Maintenance cost** — 11 new Go handlers + duplicate filesystem-path resolution + restart cycle on every dev-tools tweak.

The cost-benefit lands clearly on "exempt and document." If any handler in this list ever grows a Postgres dependency — even a single SELECT — it loses its exemption and MUST be migrated. The audit will catch it: `has_pg > 0` re-classifies it `psql-direct` (black) automatically, regardless of whether it's in the sanctioned list.

## Sanctioned ops/diagnostic scripts

Beyond the Next.js handlers, three ops scripts under `dev/scripts/` execute `psql` directly against the dev DB tier. They are not site code paths — they are gadmin-only diagnostic tools that READ the DB to verify the DB itself.

| Script | What it does | When it runs |
|---|---|---|
| `dev/scripts/ssh_manager.sh` | Verifies tunnel health, `pg_stat_statements` preload, `backlog_items` row count as a connectivity smoke test | Every laptop-setup pass; on demand from `<services>` |
| `dev/scripts/cross_db_canary.sh` | Cross-DB FK integrity sweep — finds orphan rows between `mmff_vector.workspaces` and `vector_artefacts.workspace_id` references | Ops cron / on demand before merge |
| `dev/scripts/capture_role_grants.sh` | Re-captures live `users_roles_pages` rows after a gadmin permission grid edit, to regenerate the locked seed migration | After a permissions-grid change (~quarterly) |

Same exemption class as `<backupsql>`/`<cookbook>`/`<services>`/`<accounts>`: READ-only, gadmin-only, no website code path involved. The audit's `psql-direct → black` classification is wrong for these; the script downgrades them to `pg-dump-sanctioned → green` and records the exemption reason in the `gap` field.

The full sanctioned-script list lives in `dev/scripts/audit_api_touchpoints.sh` (case statement around line 455). Add a script here AND there if you create a new READ-only diagnostic.

## When the exemption does NOT apply

A handler is **only** sanctioned-shadow if all three are true:

1. It lives under `app/api/dev/*` (gadmin-only path).
2. It never connects to Postgres — no `pg`, no `@/app/lib/v2/db`, no `Pool`, no `query<>`.
3. It only **reads** filesystem content, **spawns** read-only subprocesses (`go test`, etc.), or runs TCP **health probes**. It does not write to disk, send mail, mutate caches, or call third parties.

If any of those break, the handler must migrate to Go under `/_site/admin/dev/<area>`, and the frontend caller switches to `apiSite()`.

---

## Audit semantics

Sanctioned-shadow handlers (and their frontend callers) get:

- `status: green` (compliant)
- `kind: sanctioned-shadow` (distinct from `site-api` so you can still filter for them)
- `gap:` filled with the exemption reason, including a pointer back to this doc.

That keeps the audit *honest*: we don't pretend these handlers don't exist or that they go through siteAPI. We say "these are shadow handlers, and here's the written reason we're letting them stand." For SOC2 evidence, the audit snapshot + this doc together form the control narrative.
