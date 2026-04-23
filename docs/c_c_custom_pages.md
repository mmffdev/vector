# User custom pages

> Last verified: 2026-04-23
> Parent: [c_schema.md](c_schema.md) · [c_url-routing.md](c_url-routing.md) · [c_page-structure.md](c_page-structure.md)

A user-authored container page (think Jira "plan"). The page owns one or more views; the page itself has no content — it's a labelled holder.

## Data model

Two tables (migration 016):

- **`user_custom_pages`** — one row per page. Owner is `(user_id, tenant_id)`. Label unique per owner within tenant. Hard delete; no soft-archive.
- **`user_custom_page_views`** — render modes within a page. Enum `custom_view_kind` ∈ {`timeline`, `board`, `list`}. View at `position = 0` is default. At least one view must exist at all times (enforced at the API layer on delete).

Caps: 50 pages per `(user_id, tenant_id)`, 8 views per page, label max 64 chars.

## Route

```
/p/<page-uuid>
/p/<page-uuid>?vid=<view-uuid>
```

Frontend: `app/(user)/p/[id]/page.tsx`. Omitting `?vid` renders `position = 0`. See [c_url-routing.md](c_url-routing.md).

## Nav catalogue integration

The nav handler (`nav.CatalogueWithCustom`) merges custom pages into the standard catalogue on every `GET /api/nav/catalogue` call. Each page appears as:

```
item_key = "custom:<page.id>"
kind     = "user_custom"
href     = "/p/<page.id>"
```

Pinning writes a `user_nav_prefs` row with `item_key = "custom:<page.id>"`. Deletion of the page does NOT cascade to `user_nav_prefs` via FK (the key is a string, not a UUID FK). The frontend calls `DELETE /api/custom-pages/{id}` and then issues a nav-prefs cleanup; callers must not rely on DB-level cascade for prefs cleanup.

## Backend API

All routes under `/api/custom-pages` require `RequireAuth` + `RequireFreshPassword`. Rate-limited at 120 req/min/IP.

| Method | Route | Handler | Notes |
|---|---|---|---|
| `GET` | `/api/custom-pages/` | `List` | Returns pages without views. |
| `POST` | `/api/custom-pages/` | `Create` | Seeds one Timeline view at position 0. |
| `GET` | `/api/custom-pages/{id}` | `Get` | Returns page with all views. |
| `PATCH` | `/api/custom-pages/{id}` | `Patch` | Rename or change icon. |
| `DELETE` | `/api/custom-pages/{id}` | `Delete` | Cascades views in DB. |

Handler always pins `user_id` and `tenant_id` from the session JWT — never from the request body. `Get` / `Patch` / `Delete` return 404 for both "not found" and "belongs to another user/tenant" to avoid existence leakage.

## Go package

`backend/internal/custompages/` — `service.go` (business logic, DB) + `handler.go` (HTTP). Sentinel errors: `ErrNotFound`, `ErrEmptyLabel`, `ErrLabelTooLong`, `ErrDuplicateLabel`, `ErrPageCap`, `ErrViewCap`, `ErrInvalidViewKind`, `ErrLastView`.

## Security notes

- Tenant and user isolation enforced by filtering every query on `user_id = $caller AND tenant_id = $caller` — not just `id`. Cross-user GET returns 404.
- Cap check (50 pages) done inside a transaction to prevent race past the limit.
- No soft-archive: delete is permanent. Consider this before adding bulk-delete or admin-delete flows.

## Not yet built

- View CRUD endpoints (add / reorder / delete view within a page).
- Share / duplicate a custom page.
- Soft-archive / restore.
