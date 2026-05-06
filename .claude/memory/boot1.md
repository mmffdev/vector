---
name: Session bootup — PLA-0019 Samantha API research + work-items perf investigation
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: dafbaa04-6546-45d4-81a9-59ae1b1e5ea5
---

## Current state (last updated: 2026-05-06)

**Active branch:** `main`
**Story index last issued:** `00444`
**Phase:** PH-0005

---

## Planka card states

**In progress / Doing:**
- 00444 — Wire portfolio.fields.* SDK runtime bindings (next story after 00443)

**Completed (committed, move to Completed in Planka):**
- 00440 — OpenAPI 3.1 spec (commit 3f45e48)
- 00441 — /v1/ URL versioning (commit in earlier session)
- 00442 — RFC 9457 error format (commit 737688c)
- 00443 — API key management (commit 5414a1c) — **THIS SESSION**

**Parked:**
- None.

---

## Uncommitted on branch

**Branch is clean** — all work from story 00443 committed and pushed.

**Untracked files (safe to ignore):**
- `MBP17 Connections.md`
- `backend.zip`
- `backend/server.old`
- `cookies.txt`

---

## What shipped this session

**Story 00443 — API key management (complete E2E):**
- **Database schema** (`backend/db/schema/120_api_keys.sql`): `api_keys` table with Blake3-hashed keys, soft-delete via `revoked_at`, subscription-scoped isolation, indexes on subscription_id/prefix/revoked_at/expires_at
- **Service layer** (`backend/internal/apikeys/apikeys.go`): Issue (16-char prefix for uniqueness), ValidateKey (expiration + revocation checks, last_used_at tracking), ListKeys, Revoke
- **Bearer token middleware** (`backend/internal/apikeys/middleware.go`): Validates `sam_live_` prefixed keys, sets `api_key_subscription_id` in context, falls through for JWT
- **Handler support** (`backend/internal/apikeys/handler.go`): Dual auth for Issue, List, Revoke endpoints (JWT user context + API key subscription_id context)
- **Auth middleware updates** (`backend/internal/auth/middleware.go`): RequireAuth checks for api_key_subscription_id before JWT parsing; RequirePermission passes through for API keys
- **CSRF exemptions** (`backend/internal/security/csrf.go`): All /v1/api/admin/api-keys sub-paths
- **OpenAPI spec** (`api-reference/static/openapi.yaml`): Three endpoints documented
- **Dev seeding** (`backend/.env.dev`): DEV_API_KEY hardcoded for local testing
- **Test helper** (`dev/scripts/test_api_keys.sh`): curl commands for API testing
- **Commit** `5414a1c`: Complete implementation with full explanation

---

## Key decisions made

**API key management (story 00443):**
- Simplified approach: hardcoded dev key in .env, deferred multi-key creation/exchange to later
- Unique prefix via 16-char extraction (includes random portion) to avoid UNIQUE constraint violations on prefix column
- Subscription-scoped access: API keys grant access only to issuing subscription, no user-level permissions needed
- Blake3 hashing: Cryptographically secure, industry-standard for key storage
- Soft-delete pattern: `revoked_at` timestamp allows audit trail, not hard deletion

---

## Recent commits

```
5414a1c feat(00443): complete API key management — issue, list, revoke with Bearer auth
c292f22 docs: add error handling guide and update auth endpoints
ed6a128 chore: mark PLA-0020 WS1-A and WS2-A complete, WS2-B in-progress
633366e feat(PLA-0020): E2E human-friendly feedback system — WS1-A + WS2-A
7ebfd1b feat: dev API key seeding and unit tests (story 00443)
867f62f feat: API key management schema and middleware (story 00443 — WIP)
3f45e48 feat: OpenAPI 3.1 spec for all Samantha REST endpoints (story 00440)
b5a714a chore: mark 00442 done in PLA-0019
```

---

## What's next

1. **Fix WorkItem JSON serialization** — change `omitempty` tags to show null values for optional fields
   - User feedback: "no null needs to be displayed as null" — means optional fields should appear as `null` in JSON rather than being omitted
   - Edit `backend/internal/workitems/types.go`: remove `omitempty` from description, priority, story_points, rollup_points, sprint_id, parent_id, root_feature_id, archived_at
   - Test with curl: `curl -H "Authorization: Bearer sam_live_..." http://localhost:5100/v1/work-items` should show null values
   - Commit and push

2. **Story 00444** — Wire portfolio.fields.* SDK runtime bindings (final story in PLA-0019)

3. **Planka:** Mark 00443 as Completed in the board

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Planka helper:** `./.claude/bin/planka` is the SOLE entry point for board reads/writes; subcommands: `create-card`, `label-card`, `move-card`, `update-card`, `delete-card`, `create-label`, `delete-label`, `board`, `comment`, `unlabel-card`, `verify-labels`.
- **Active backend env:** `dev` — DB tunnel at `localhost:5435`, env file `backend/.env.dev`.
- **Samantha SDK address format (frozen):** `samantha._viewport.<slot>._<kind>.<name>` — slots: app/header/footer/side_bar/modal/toast; name regex `/^[a-z0-9_]{1,64}$/`; leading underscore = system segment.
- **`samantha.diagram.canvas`:** frozen at v1.0.0, compile-time contract test at `app/lib/samantha.contract.ts`.
- **`samantha.portfolio.fields.*`:** contracted in `docs/c_samantha_sdk_fields.md`, backend live, `app/lib/samantha.ts` is empty stub — story 00444 wires it.
- **PLA-0019 Planka label ID:** `1768714873165841589` (wisteria-purple).
- **API key format:** `sam_live_<32-char-base62>` with 16-char unique prefix + Blake3 hash stored; validated via `ValidateKey()`.
- **Dev API key:** `sam_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1` hardcoded in `.env.dev` for local testing.
- **Story 00443 complete:** Full API key lifecycle working with Bearer token validation, subscription scoping, dual-auth support (JWT + API keys).
- **Pending feedback:** User's "no null needs to be displayed as null" request not yet implemented — requires code changes to WorkItem struct.
