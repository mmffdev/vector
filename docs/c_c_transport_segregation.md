# Transport Segregation (PLA-0039)

Two HTTP transports serve the backend. Both call the same Service layer — no SQL lives in handlers.

## Transports

| Transport | Mount | Auth | Audience |
|---|---|---|---|
| **Site** (BFF) | `/_site` | Session cookie + JWT | Next.js frontend only |
| **Public** | `/samantha/v2` | API key (Bearer) | External callers / future integrations |

Back-compat root shim: `mountSiteRoutes` is also mounted at `/` with `Deprecation: true` + `Link: </_site>; rel="successor-version"` headers. Frozen — no new routes. Removed after ≤2 release cycles.

## Shared Service Core

```
Request → Handler (parse + auth + render)
                 ↓
           Domain Service (SQL + business logic)
```

Handler rule: parse request, check auth, call `svc.Method()`, render response. No SQL in handlers. Enforced by `lint:no-db-in-handlers` (ledger at `dev/registries/no_db_in_handlers_exempt.json` — must stay empty).

## Transport Context

`internal/transport` package annotates every request context with `transport.Site` or `transport.Public` at the router-middleware boundary:

```go
transport.FromContext(ctx)         // → (Transport, bool)
transport.FromContextOr(ctx, Site) // → Transport (with fallback)
```

Middleware is wired in `backend/cmd/server/main.go` via `tagSite` (on `/_site` + root shim) and an inline middleware on `/samantha/v2`.

## Audit: source_transport

`audit_log.source_transport` records which transport admitted each request. `audit.Logger.Log` reads `transport.FromContext(ctx)` automatically — no caller change needed. Legacy rows (pre-PLA-0039) are NULL.

Schema: `db/schema/143_audit_log_source_transport.sql` — `CHECK (source_transport IN ('site', 'public'))`.

## Lint Trio

| Lint | Rule | Ledger |
|---|---|---|
| `lint:no-db-in-handlers` | Handlers must not touch DB directly | `dev/registries/no_db_in_handlers_exempt.json` |
| `lint:public-helper-allowlist` | Only vetted callers may use `apiV2()` | `dev/registries/public_helper_allowlist.json` |
| `lint:public-dto-mapper` | Public-transport handlers must project via `MapPublic*` | `dev/registries/public_dto_mapper_exempt.json` |

All three ledgers end empty → invariant. Run via `npm run lint:<name>`.

## DTO / MapPublic Convention

Public-transport handlers (`/samantha/v2`) must not serialize `internal/models` structs directly. Use a `MapPublic*` function in the domain package's `dto.go`:

```go
// backend/internal/artefactitemsv2/dto.go
func MapPublicWorkItem(w WorkItem) WorkItem { return w }
```

When internal and public shapes diverge, edit `dto.go` — not handler call sites. `lint:public-dto-mapper` enforces this.

Package registry: `dev/registries/public_transport_packages.json` — add a package here when it gains a `/samantha/v2` mount.

## Gateway Rule (frozen)

- New public endpoints → `/samantha/v2` only.
- New BFF endpoints → `/_site` only.
- Root back-compat mount is **frozen** — do not add routes there.

See [`docs/c_security.md`](c_security.md) for the full gateway rule note.

## Frontend Helpers

| Helper | Transport | Usage |
|---|---|---|
| `apiSite()` | `/_site` BFF | All UI → backend calls |
| `apiV2()` | `/samantha/v2` | Public API (allow-listed callers only) |
| `apiRoot()` | Root (healthz, env) | Transport-agnostic infra endpoints |

`lint:public-helper-allowlist` guards `apiV2` call sites.

## Phase 2 — BFF Migration (PLA-0039 / B22, completed 2026-05-09)

All frontend call sites migrated from `apiV2()` → `apiSite()`. Allowlist shrunk to 1 entry (`app/lib/api.ts` — definition only). The public allowlist is now effectively sealed; any new `apiV2` caller requires an explicit entry + SOC 2 audit-event review.

### Full `/_site` route inventory (after B22)

| Route prefix | Handler | B22 item |
|---|---|---|
| `/_site/roles` | roles.Handler | B22.1–B22.15 (Phase 1) |
| `/_site/permissions` | roles.Handler | B22.1–B22.15 |
| `/_site/workspaces` | workspaces.Handler | B22.1–B22.15 |
| `/_site/api-keys` | apikeys.Handler | B22.1–B22.15 |
| `/_site/topology` | orgDesignH | B22.16 |
| `/_site/work-items` | artefactitemsv2.Handler (scope=work) | B22.17 |
| `/_site/portfolio-items` | artefactitemsv2.Handler (scope=strategy) | B22.18 |
| `/_site/portfolio` | portfolioMasterRecordH | B22.19 |
| `/_site/workspace/{id}/portfolio` | workspaceLayersH (GET /layers) | B22.19 |
| `/_site/flows` | flowsH | B22.20 |
| `/_site/workspace/{id}/fields` | fieldsH | B22.21 |
| `/_site/rank` | rankH | B22.22 |
| `/_site/timeboxes/sprints` | timeboxsprints.Handler | B22.23 |
| `/_site/timeboxes/releases` | timeboxreleases.Handler | B22.23 |
