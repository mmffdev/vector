# Security posture — "Trust No One"

> Last verified: 2026-04-21

The platform is built Zero-Trust for authentication, authorisation, and data access (SoW §8). This is the checklist every code-touching task runs against; the librarian scans changed files against these rules.

## The non-negotiables

### 1. Tenant isolation (the big one)

**Every query against a tenant-scoped table MUST filter by `tenant_id`.**

- Schema-side: every business table carries `tenant_id UUID NOT NULL REFERENCES tenants(id)`.
- App-side: every handler pulls `tenant_id` from the authenticated session, never from request payload.
- Anti-pattern: `SELECT * FROM portfolio WHERE id = $1` — missing tenant filter. Correct: `SELECT * FROM portfolio WHERE id = $1 AND tenant_id = $2`.
- There is no cross-tenant read API. None. Admin tooling is per-tenant or runs as superuser on the server.

Flag any new query that touches a tenant-scoped table without a `tenant_id` predicate. Severity: **high**.

### 2. Input comes from the session, not the payload

`tenant_id`, `user_id`, `role` — pulled from the verified JWT / session, never accepted from the client.

Anti-pattern: `UPDATE users SET role = $1 WHERE id = $2` where `$1` is request body. Correct: verify the caller is `gadmin` server-side before running the update; never trust client-supplied role.

### 3. Passwords and tokens

- Passwords: bcrypt cost 12. Stored in `users.password_hash`. Never logged, never returned in JSON (struct tag `json:"-"`).
- Refresh tokens: raw token given to client once; only `SHA-256(token)` stored server-side in `sessions.token_hash`. Revocation = flip `sessions.revoked = true`.
- Password reset tokens: same pattern — raw out, hash in (`password_resets.token_hash`).
- Access tokens (JWT): stateless, short-lived, not tracked server-side.

Anti-pattern: storing raw refresh token, logging `Authorization` header contents, returning `password_hash` in any response shape. Severity: **high**.

### 4. Append-only history is append-only

`item_state_history` has BEFORE UPDATE and BEFORE DELETE triggers that raise `check_violation`. Do not disable them from app code. If you need to "fix" a bad transition, append a correcting transition — do not mutate history.

`audit_log` is append-only by convention. Writer code must never UPDATE or DELETE rows.

### 5. Locked fields for directory-sync'd users

Users with `auth_method = 'ldap'` have certain profile fields (email, display name, potentially others) owned by the corporate directory. The UI must NOT allow editing those fields — not just hide the button; reject the API call too.

### 6. Secrets handling

- `.env.local` is gitignored. Never commit it.
- `.env` with real values is never committed (only `.env.example` with placeholders).
- SSH keys live under `~/.ssh/`. Never in the repo.
- No secrets in logs, even masked — don't log the field at all.

### 7. DB port never exposed

Postgres is bound to loopback on the host. Laptop reach is via SSH tunnel only (see [c_postgresql.md](c_postgresql.md)). Any change that exposes `5432` to the public internet is a severity-**high** flag, no exceptions.

## What "Trust No One" does NOT cover

SoW §6 is explicit: "Trust No One" applies to **auth, authz, and data access**. It does NOT apply to product configuration. Admins can add portfolio layers, rename states, change tags — these are trusted configuration operations that do not require secondary approval. Do not over-apply Zero Trust to config UX (it makes the product unusable).

## Security-flag format (librarian's output)

When the librarian finds a potential violation, it appends one JSONL row to `local-assets/security-flags.jsonl`:

```json
{"ts": "2026-04-21T14:22:03Z", "severity": "high|med|low", "file": "backend/internal/handlers/portfolio.go", "line": 42, "summary": "<=100 chars>", "policy_ref": "c_security.md#tenant-isolation", "hash": "<sha1(file+line+summary)>", "state": "open"}
```

### Severity guide

Severity = **impact IF reached × who can reach it**. A missing tenant filter on a function that only a `gadmin`-gated route can reach is not the same as one that any authenticated user can hit. Trace the handler → route → middleware chain before scoring.

- **high** — an attacker at or below **padmin** can trigger cross-tenant data access / modification, store credentials in plaintext, expose the DB port, bypass auth, or mutate append-only history. If the only reachable caller is gadmin-gated, it is NOT high — gadmin can cross tenants by design.
- **med** — violates a Trust-No-One rule but reachable only by gadmin, OR reachable by lower roles but on a non-critical path (e.g., logs secrets, accepts `role`/`tenant_id` from request body with a server-side fallback).
- **low** — latent violation (internal-only function not yet wired to a handler; single-tenant today but will matter later), cosmetic (missing `json:"-"` on a sensitive field not currently serialised), or weak error message hinting at schema.

### Scoring procedure (mandatory)

Every flag must be scored by walking this short checklist, not by pattern-match alone:

1. **Name the vuln path.** One sentence: *"<role> via <route> can <bad-thing>"*. If you can't name the path, the flag is either `low` (latent) or shouldn't be filed.
2. **Find the lowest role that can reach it.** Grep `main.go` / router for `RequireRole` on the handler; that's the ceiling. No `RequireRole` + under `RequireAuth` = any logged-in user.
3. **Sweep siblings.** When you flag a pattern (e.g., "SELECT by id without tenant filter"), grep the same file for the same pattern — file all hits in one pass. Missing one is a contract violation, not an oversight.
4. **Write the summary to name the path.** Not *"UPDATE without tenant filter"* — *"padmin in tenant A can UPDATE tenant B rows via PATCH /api/admin/users/:id"*. The path is the finding; the code is the evidence.

A librarian run that files flags without naming the path in the summary is a failed run; re-score before logging.

### Triage workflow

A human marks a flag by editing the JSONL row's `state` field: `open` → `resolved` or `accepted_risk`. The librarian's dedupe key is `sha1(file+line+summary)` — same issue doesn't re-file, but a resolved issue that re-appears in code does re-file as a new `open` entry.

### Visibility

- **high** flags surface in the librarian's completion notification.
- **med** and **low** flags only show in the SessionStart digest — prevents alarm fatigue.

Full librarian contract: [c_librarian.md](c_librarian.md).

## Related

- [c_c_schema_auth.md](c_c_schema_auth.md) — `users`, `sessions`, `password_resets`, `user_workspace_permissions`.
- [c_c_schema_history.md](c_c_schema_history.md) — append-only triggers.
- [c_deployment.md](c_deployment.md) — secrets locations, env files.
