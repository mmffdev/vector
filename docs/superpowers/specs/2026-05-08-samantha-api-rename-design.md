# Design: Rename API surface to `/samantha/v*`

**Date:** 2026-05-08
**Status:** Approved
**Author:** Claude (brainstorming session)

---

## Problem

The current API surface is mounted at `/v1/api/*`. This has two issues:

1. `/v1` gives no indication of which service is being called — when multiple services or external clients exist, the URL is ambiguous.
2. `/api/` is redundant inside a versioned service prefix.

No external clients exist yet. This is the right time to establish the correct URL shape before any client adoption occurs.

---

## Decision

Rename the entire API surface to `/samantha/v*/` where:

- `samantha` — the service name (permanent, never changes except by explicit product decision)
- `v*` — the API version integer (1, 2, 3…)
- resource path — no `/api/` prefix (redundant)

### URL shape before and after

| Before | After |
| --- | --- |
| `http://host/v1/api/work-items` | `http://host/samantha/v1/work-items` |
| `http://host/v1/api/auth` | `http://host/samantha/v1/auth` |
| `http://host/v1/api/topology` | `http://host/samantha/v1/topology` |
| `http://host/v1/api/v2/work-items` | `http://host/samantha/v1/v2/work-items` → **rename to** `http://host/samantha/v2/work-items` |
| `http://host/api/env` | `http://host/env` |
| `http://host/api/status/pipeline` | `http://host/status/pipeline` |
| `http://host/healthz` | `http://host/healthz` (unchanged) |
| `http://host/ws` | `http://host/ws` (unchanged) |

---

## Scope

### In scope

1. **Go router** (`backend/cmd/server/main.go`)
   - Mount point: `r.Route("/v1", ...)` → `r.Route("/samantha/v1", ...)`
   - All sub-route strings inside the block: `/api/xxx` → `/xxx`
   - Unversioned infra routes: `/api/env`, `/api/status/pipeline`, `/api/env/switch` → `/env`, `/status/pipeline`, `/env/switch`
   - The internal v2 sub-routes `/api/v2/work-items` and `/api/v2/timeboxes/sprints` become top-level versioned routes `/samantha/v2/work-items` and `/samantha/v2/timeboxes/sprints` — pulled out of the v1 block entirely

2. **Frontend `api()` helper** (`app/lib/api.ts`)
   - `API_BASE`: `${host}/v1` → `${host}/samantha/v1`
   - All call-site path strings: `api("/api/work-items")` → `api("/work-items")`

3. **Frontend `apiInfra()` call sites**
   - `/api/env` → `/env`, `/api/status/pipeline` → `/status/pipeline`

4. **OpenAPI spec** (`openapi.yaml`)
   - Server URLs updated
   - All path entries: `/api/xxx` → `/xxx`

5. **Docusaurus API reference** (`api-reference/docs/rest-api/`)
   - Path strings in MDX docs updated

### Out of scope

- `app/api/v2/*` Next.js PoC route handlers — internal direct-DB, not part of the Samantha surface
- Middleware, auth, permissions, DTOs, handler logic — no behavioural changes
- Any new registry, versioning middleware, or deprecation tooling

---

## Implementation notes

- Pure string rename — no logic changes anywhere
- ~30–40 route path strings in Go
- ~40 `api("/api/…")` call sites in the frontend
- The v2 sub-routes moving out of the v1 block is the only structural Go change (they become a separate `r.Route("/samantha/v2", ...)` block)

---

## Future versioning convention (established by this change)

When v2 ships for a resource:

- New routes register under `/samantha/v2/`
- v1 routes stay live through the grace period
- Grace period = communicated to clients at v2 launch; v1 returns `Deprecation` + `Sunset` headers during the window
- After sunset: v1 routes removed, return 410 Gone for one additional release cycle

This rename establishes `samantha` as the permanent service identifier. The name changes only by explicit product decision, never as a code refactor.
