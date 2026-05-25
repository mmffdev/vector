# Pool-swap sites in main.go — for post-wipe cleanup

> **Purpose:** Under the post-wipe-and-reseed plan, `mmff_vector` dies and `pool` is decommissioned. Every site below changes from `pool` → `vaPool` (or gets deleted entirely if the service was registry-only). This doc enumerates them so the post-wipe sweep is mechanical.
>
> Captured 2026-05-25 directly from `backend/cmd/server/main.go` (post-bookmarks-cleanup). Re-run the grep below before acting — line numbers drift.
>
> ```
> grep -n "NewService\|NewHandler\|topology\.New\|\.New(pool\|\.New(vaPool\|\.New(devPool\|\.New(libPools" backend/cmd/server/main.go
> ```

## Sites currently using `pool` (mmff_vector) — ALL swap to `vaPool` post-wipe

| Line | Service | Call | Post-wipe target |
|---|---|---|---|
| 165 | `audit` | `audit.New(pool)` | `vaPool` (audit_logs already lives there since PLA-0023 P1; pool ref is legacy) |
| 176 | `auth` | `auth.NewService(pool, ...)` | `vaPool` (users live there post-wipe) |
| 216 | `apikeys` | `apikeys.New(pool)` | `vaPool` |
| 225 | `users` | `users.New(pool, ...)` | `vaPool` |
| 231 | `cspreport` | `cspreport.NewService(pool)` | `vaPool` |
| 235 | `roles` | `roles.New(pool, ...)` | `vaPool` |
| 258 | `nav` | `nav.New(pool, navRegistry)` | `vaPool` (pages live there post-wipe) |
| 260 | `custompages` | `custompages.New(pool)` | `vaPool` |
| 268 | `addressables` | `addressables.New(pool, ...)` | `vaPool` |
| 282 | `pageaccess` | `pageaccess.New(pool, ...)` | `vaPool` |
| 293 | `usertaborder` | `usertaborder.New(pool)` | `vaPool` |
| 299 | `portfoliomodels` | `portfoliomodels.NewService(libPools.RO, pool, nil)` | `(libPools.RO, vaPool, nil)` |
| 327 | `libraryreleases` | `libraryreleases.NewService(libPools.RO, pool, pool)` | `(libPools.RO, vaPool, vaPool)` |
| 366 | `workspaces` | `workspaces.New(pool, ...)` | `vaPool` (master_record_workspaces lives there post-merge per PLA064 Phase 2) |
| 533 | `topology` | `topology.New(pool, vaPool)` | `topology.New(vaPool)` — drop cross-pool argument |
| 563 | `portfolio` | `portfolio.NewService(vaPool).WithVectorPool(pool)` | drop `.WithVectorPool(pool)` — cross-pool join goes away |

## Sites currently using `vaPool` — NO change

| Line | Service |
|---|---|
| 437 | `webhooks.New(vaPool)` |
| 439 / 442 | `artefactitems.NewService(vaPool, pool, "work"|"strategy")` — drop the `pool` second arg post-wipe |
| (others) | All `vaPool`-first services unchanged |

## Sites currently using `devPool` — NO change (mmff_dev survives wipe)

| Line | Service |
|---|---|
| 488 / 512 | `devreports.NewService(devPool)` |

## Sites currently using `libPools` — NO change (mmff_library survives wipe)

`libPools.RO` / `libPools.RW` continue to point at the library spine; the 5 portfolio templates + 14 layer defs survive untouched.

## Post-wipe step-by-step

1. After wipe + new migration set applied to `vector_artefacts`, every line above using `pool` switches to `vaPool`.
2. The `pool` variable declaration + its env-var reads (`DB_HOST`/`DB_PORT`/`DB_NAME=mmff_vector`/`DB_USER`/`DB_PASSWORD`) are deleted from main.go.
3. `mmff_vector` database itself is `DROP`ped on the dev host AFTER the new `vector_artefacts` schema is verified working end-to-end.
4. `docs/c_c_db_routing.md` rewritten — three pools → two (`vaPool` + `libPools`), plus `devPool` for reports.
5. SY003 regenerated.

## Origin

Originally captured by subagent F during plan-mode (2026-05-25 pre-compact). F's output was research-only — plan mode blocked file writes. This doc re-derives the same enumeration directly from current source, post-bookmarks-cleanup, and adds the post-wipe target column F's brief did not include. F's work is fully superseded by this doc.
