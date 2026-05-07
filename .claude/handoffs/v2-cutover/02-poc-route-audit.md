# v2 PoC route audit — parity gaps vs production `/api/work-items`

> Read-only audit of the `GET /api/v2/work-items` PoC route handler against the
> production Go handler at `backend/internal/workitems/handler.go`. Each
> concern names the production behaviour, the v2 PoC behaviour, a status
> (PRESENT / PARTIAL / MISSING), and the gap that would close to reach
> parity. No remediation, no opinions — gap inventory only.

Files compared:
- Production handler — `backend/internal/workitems/handler.go`
- Production service / SQL — `backend/internal/workitems/service.go`
- Production route mount — `backend/cmd/server/main.go` (no `/api/v2` route exists)
- Production auth middleware — `backend/internal/auth/middleware.go`
- Production CSRF — `backend/internal/security/csrf.go`
- Production Problem Details — `backend/internal/httperr/httperr.go`
- v2 PoC list/create — `app/api/v2/work-items/route.ts`
- v2 PoC get/patch/delete — `app/api/v2/work-items/[id]/route.ts`
- v2 PoC pool — `app/lib/v2/db.ts`

---

## Authentication
- **Production**: caller resolved from `Authorization: Bearer <jwt>` (or `?access_token=` for WS) by `(*Service).RequireAuth` middleware, which parses the access token and loads the user from DB; mounted on the `/api/work-items` group at `backend/cmd/server/main.go:707`. Handler reads the user from context via `auth.UserFromCtx(r.Context())` at `backend/internal/workitems/handler.go:29`.
- **v2 PoC**: no authentication. The route exports `GET`/`POST` directly with no middleware wrapper; identity is hard-coded as the constants `POC_SUBSCRIPTION_ID`/`POC_WORKSPACE_ID`/`POC_USER_ID` defined at `app/lib/v2/db.ts:51-53` and consumed at `app/api/v2/work-items/route.ts:57`.
- **Status**: MISSING
- **Gap**: bind v2 to the same JWT/API-key auth as production (replace fixture `POC_USER_ID` with a context-resolved user identity).

## Tenant scoping (`subscription_id`)
- **Production**: derived from the authenticated user's claim — `u.SubscriptionID.String()` is passed to `Svc.ListWorkItems` at `backend/internal/workitems/handler.go:68`, then bound as `$1` in the WHERE clause (`wi.subscription_id = $1`) at `backend/internal/workitems/service.go:63`.
- **v2 PoC**: hard-coded fixture `POC_SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000001"` (`app/lib/v2/db.ts:51`) bound as `$1` to `WHERE a.subscription_id = $1` at `app/api/v2/work-items/route.ts:53-57`.
- **Status**: PARTIAL
- **Gap**: replace the fixture constant with the per-request authenticated subscription so cross-tenant isolation holds.

## RBAC permission gate
- **Production**: `GET /api/work-items` is gated only by `RequireAuth` + `RequireFreshPassword` (and the per-route rate limiter) — no `RequirePermission` is wrapped on the list handler at `backend/cmd/server/main.go:706-726`. (The wider permissions catalogue defines only `work_items.settings.edit` for the configuration surface — `backend/internal/permissions/catalogue.go:83` — there is no `work_items.read` code today.) `RequirePermission` itself is implemented at `backend/internal/auth/middleware.go:90-117` and used elsewhere in `main.go`.
- **v2 PoC**: no permission check; the handler invokes the SQL directly with no middleware (`app/api/v2/work-items/route.ts:34-66`).
- **Status**: PARTIAL
- **Gap**: at minimum reach the production baseline of authenticated + fresh-password; if a `work_items.read` code is later added, wire `RequirePermission`.

## Query params accepted
- **Production**: `limit`, `offset`, `parent_id`, `item_type`, `status`, `priority`, `sprint_id`, `owner_id`, `sort`, `dir` — all parsed at `backend/internal/workitems/handler.go:33-66`. The `?owner_id=` filter was added by commit `a3287d6` and is wired through to the service at `backend/internal/workitems/service.go:94-98`.
- **v2 PoC**: zero params honoured — the handler `GET()` takes no `req` argument and the `WHERE` clause has only `subscription_id`, `scope='work'`, `archived_at IS NULL` (`app/api/v2/work-items/route.ts:34, 53-56`). `limit`/`offset`/`sort`/`dir`/`item_type`/`status`/`priority`/`owner_id` are all silently ignored.
- **Status**: MISSING
- **Gap**: parse and bind every production query param (including the `a3287d6` `?owner_id=` filter) before WorkItemsTree can repoint.

## ORDER BY whitelist
- **Production**: explicit allow-list switch covering `id|title|status|priority|points|sprint|due` — anything outside the whitelist falls back to default ordering and is never interpolated as raw SQL. Implemented at `backend/internal/workitems/service.go:106-150` (commit `c8fc029`); default fallback is `coalesce(wi.sprint_position, wi.backlog_position) NULLS LAST, wi.key_num ASC` at `service.go:110`.
- **v2 PoC**: no whitelist and no `sort` param at all. Order is fixed at `ORDER BY at.sort_order, a.position, a.number` at `app/api/v2/work-items/route.ts:56`.
- **Status**: MISSING
- **Gap**: implement the same `sort` keyword whitelist (`id|title|status|priority|points|sprint|due`) plus `dir` clamp; do not interpolate user input into SQL.

## Error format (RFC 9457 Problem Details)
- **Production**: every error path goes through `httperr.Write` / `httperr.WriteValidation`, which emit `Content-Type: application/problem+json` with `type/title/status/detail/instance` (and optional `violations[]`) — see `backend/internal/httperr/httperr.go:33-54`. Used by every error branch in `backend/internal/workitems/handler.go` (e.g. lines 71, 77, 109, 115, 118).
- **v2 PoC**: ad-hoc `NextResponse.json({ error: <string> }, { status: <code> })` at `app/api/v2/work-items/route.ts:62-65, 77-79, 89, 92-95, 144-147` and `app/api/v2/work-items/[id]/route.ts:60, 63-66, 100-103, 117-120`. Content-Type is `application/json`, no `type/title/instance` fields, no `violations[]` shape.
- **Status**: MISSING
- **Gap**: emit RFC 9457 `application/problem+json` bodies on every 4xx/5xx, matching `httperr.Problem`.

## Response shape parity
- **Production list**: `{ "items": [...], "total": <int> }` — `writeJSON(... map[string]any{"items": items, "total": total})` at `backend/internal/workitems/handler.go:80`. Each item carries the work-item wire shape (id, key_num, item_type, title, description, status, flow_state_id, flow_state_name, flow_state_canonical_code, priority, story_points, sprint_id, sprint ref, parent_id, root_feature_id, owner_id + owner display ref, created_by, created_at, updated_at, archived_at, due_date, children_count, rollup_points) — see select list at `backend/internal/workitems/service.go:161-183`.
- **v2 PoC**: `{ "items": [...] }` only, no `total`. Each row is a different shape — `id, number, title, description, position, type_name, type_prefix, state_name, state_kind, parent_artefact_id, created_at, updated_at` — selected at `app/api/v2/work-items/route.ts:37-58`. Missing fields vs production: `key_num` (uses `number` instead), `item_type`, `status`, `flow_state_id`, `priority`, `story_points`, `sprint_id`/sprint ref, `root_feature_id`, owner ref, `created_by`, `archived_at`, `due_date`, `children_count`, `rollup_points`. Field names also drift (`parent_artefact_id` vs `parent_id`).
- **Status**: PARTIAL
- **Gap**: add `total` (a separate count query mirroring `Svc.CountWorkItems`); project the full work-item wire shape including owner/sprint refs and rollup_points; align field names so existing frontend consumers do not need a remap layer.

## Audit logging
- **Production**: the `workitems` package does **not** import or call the `internal/audit` package — no audit rows are written by `Create`, `Patch`, `Archive`, `Bulk`, or any work-items mutation (verified by grep of `handler.go` and `service.go`; audit consumers are limited to `auth`, `roles`, `users`, `workspaces`, `wsperms`, `orgdesign`, `libraryreleases`).
- **v2 PoC**: also no audit logging (no audit import in `app/api/v2/work-items/route.ts` or `[id]/route.ts`).
- **Status**: PRESENT (parity by absence — neither side writes audit_log on work-items mutations).
- **Gap**: none for parity. (If the cutover wants to *add* audit, that is a new requirement beyond the production baseline.)

## Realtime / NOTIFY
- **Production**: the `workitems` package does **not** call `pg_notify` or use `internal/realtime` — `grep -rn "pg_notify\|NOTIFY\|hub\.\|notify" backend/internal/workitems/` returns zero hits inside the handler/service. Postgres-level NOTIFY for ranking exists as a trigger on the legacy per-type table `o_artefacts_execution_work_items` at `db/schema/069_ranking_notify_trigger.sql:78-84`, consumed by `internal/ranking` — but the trigger fires off DML against `o_artefacts_execution_work_items`, not `obj_work_items` (the table the production list endpoint actually reads/writes).
- **v2 PoC**: no NOTIFY, no realtime hub usage (verified by grep of `app/api/v2/`).
- **Status**: PRESENT (parity by absence — work-items handler-level realtime does not exist on either side).
- **Gap**: none for parity. (Note: if ranking NOTIFY is to follow the cutover, the trigger from `069_ranking_notify_trigger.sql` will need to be re-attached to `vector_artefacts.artefacts` — but that is a ranking concern, not a work-items handler concern.)

## Rate limit
- **Production**: `httprate.LimitByIP(120, time.Minute)` mounted on the `/api/work-items` route group at `backend/cmd/server/main.go:709`. Same 120/min bucket on sprints, custom-field-library, work-item-templates, etc.
- **v2 PoC**: no rate limiting — the Next.js route handler exports `GET`/`POST` with no wrapping middleware (`app/api/v2/work-items/route.ts:34, 68`).
- **Status**: MISSING
- **Gap**: add a 120-req/min/IP bucket equivalent (either when the v2 reader is repointed at the Go backend, or by adding equivalent middleware on the Next.js route).

## CSRF
- **Production**: `security.CSRF` is mounted globally at `backend/cmd/server/main.go:306`. State-changing methods require a `csrf_token` cookie + matching `X-CSRF-Token` header (`backend/internal/security/csrf.go:58-81`); GET/HEAD/OPTIONS pass through (`csrf.go:60-63`). Login/refresh/password-reset and `/v1/api/admin/api-keys/*` are exempt (`csrf.go:83-99`).
- **v2 PoC**: no CSRF check. The PATCH at `app/api/v2/work-items/[id]/route.ts:70-105`, the DELETE at `app/api/v2/work-items/[id]/route.ts:107-122`, and the POST at `app/api/v2/work-items/route.ts:68-149` all execute their mutations without inspecting `csrf_token` cookie or `X-CSRF-Token` header.
- **Status**: MISSING
- **Gap**: enforce double-submit CSRF on every state-changing v2 method (POST/PATCH/PUT/DELETE), matching `security.CSRF`.

---

## Summary table

| Concern | Status |
| --- | --- |
| Authentication | MISSING |
| Tenant scoping | PARTIAL |
| RBAC permission gate | PARTIAL |
| Query params | MISSING |
| ORDER BY whitelist | MISSING |
| Error format (RFC 9457) | MISSING |
| Response shape parity | PARTIAL |
| Audit logging | PRESENT |
| Realtime / NOTIFY | PRESENT |
| Rate limit | MISSING |
| CSRF | MISSING |

If the cutover stops here, the parallel agent can rely on these capabilities; everything marked MISSING is a story to write before WorkItemsTree can be repointed.
