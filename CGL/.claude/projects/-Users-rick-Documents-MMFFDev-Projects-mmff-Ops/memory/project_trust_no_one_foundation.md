---
name: Trust-no-one security foundation
description: Zero-trust posture for mmff-Ops — session-only identity, strict zod validation, prepared statements, execFile only, project_id stamping, defaults deny. Deeplink hashes are obfuscation not auth.
type: project
originSessionId: f9e1df41-a67e-453d-9a5b-b23b674c9d40
---
# Trust-No-One Foundation

**Status:** Documented in ScopePage.tsx (Security Foundation — Trust No One section) as of 2026-04-20. This is the security contract for all new and edited code.

**Why:** The repo is private and dev-mode commits include sensitive data. Before prod go-live there must be a defensible security posture across identity, scope, validation, SQL, shell, audit, and deps. User explicitly wants this documented as a foundational principle, not a sprint feature.

**How to apply:** Treat this file as the reviewer's checklist for any PR that touches an API route, middleware, DB write, shell call, or auth-adjacent surface. If a change violates one of these points, flag it before merge.

## The seven pillars

### 1. Identity — session token only
- `X-Session-Token` (64-hex) verified against PG `sessions` table via `attachUserMiddleware`. No token → no identity.
- `X-User-Id` is retired. A client cannot assert its own identity.
- `X-Project-Id` is a scoping hint, not identity.
- No new trusted headers (`X-Admin`, `X-Role`, etc.) without a server-side DB verification step.
- Sessions carry expiry + revoked flags; middleware rejects stale/revoked tokens unconditionally.

### 2. Authorisation & scope
- Every `/api/dev` route inherits `attachUserMiddleware` + `attachProjectMiddleware`. Bypassing is a defect.
- Every INSERT stamps `project_id = req.projectId`.
- Reads filter by `project_id` — no cross-project leakage via missing filters.
- Defaults deny. If no explicit auth check exists on a route, it rejects.

### 3. Input validation
- Every POST/PUT uses `parseBody(schema, req, res)` from `c_server_validation.ts` with zod.
- `.strict()` on create schemas — unknown fields rejected, not stripped. Prevents mass-assignment.
- Never spread `req.body` into a DB insert. Pull named fields from the zod result only.
- Frontend validation is UX, not security. Backend is the only trust boundary.

### 4. SQL & shell
- Prepared statements only. `db.prepare()` at module load; `?` placeholders for user input. No string concat into SQL ever.
- No `exec()` with template strings. Use `execFile()` / `execFileAsync()` with args array so no shell is invoked.

### 5. Audit
- Append-only audit log for auth events (login, logout, revoke, failed auth). SEC-21 covers this.
- Rate-limiting keyed by session, not IP (SEC-15 covers this). Shared-NAT not collectively throttled.

### 6. Dependency hygiene
- New npm packages: >1M weekly downloads, `npm audit` clean.
- Security-relevant packages (auth, crypto, session) require explicit user approval.

### 7. Defaults deny everywhere
- Access is always explicit opt-in, never silently open.
- "Internal-only" is not an exemption. Every route is treated as externally reachable.

## What the deeplink hash URL system covers (and what it doesn't)

Deeplinks are `SHA-256(VITE_DEEPLINK_SEED:pageId:entityId)` → 8-char base-66.

**Covered (obfuscation):**
- Browser history / shoulder-surfing leakage of raw IDs
- Casual URL-guessing against sequential IDs
- Proxy log / screenshot / bookmark accidental disclosure

**NOT covered (still need API enforcement):**
- Authorisation — a known token is not a capability grant
- Tampering — tokens are not signed; seed holder can mint any token
- Replay / expiry — tokens are deterministic and eternal
- Seed compromise — leaked `VITE_DEEPLINK_SEED` makes all tokens predictable

**Rule:** a valid deeplink token is NEVER sufficient to authorise read or mutation. The middleware stack decides access; the hash only decides what the URL looks like.

## Reminders
- `VITE_DEEPLINK_SEED` must be rotated before production.
- Legacy rows with null `project_id` are read-scoped only; new inserts must stamp it.
- If you find code violating any pillar while working on something else, log a `<defect>` — don't silently fix and bundle.
