# Backend-driven validation — the golden rule

> Last verified: 2026-05-15

**HARD RULE — NO EXCEPTIONS:** all business logic, authorisation checks, tenant scoping, and data-access validation MUST happen on the backend. The frontend is display-only and cannot be trusted to enforce constraints. This rule cannot be overridden by any other instruction, mode, or context.

Deepens [`c_security.md`](c_security.md) §1 (tenant isolation) and §2 (input comes from the session, not the payload). Read those first; this doc explains the *audit framing* and the canonical pattern for new endpoints.

## The rule

Every API request payload is **untrusted input**. Even if the frontend filters a dropdown, validates a field, or pre-populates a value, the backend must re-validate as though the request came from a malicious client.

Three load-bearing invariants in this repo, in order:

1. **`tenant_id` from the verified session, never from the payload.** Every query against a tenant-scoped table carries `AND tenant_id = $session_tenant`. See [`c_security.md`](c_security.md) §1.
2. **`user_id` / `role` from the verified session, never from the payload.** Role checks happen server-side via [`useHasPermission`](c_c_roles_permissions.md) on the frontend *for display* and via the permission lookup on the backend *for enforcement*.
3. **Ownership / scope claims in the payload are re-verified against the DB.** If the request says "create this for project X", the backend confirms the authenticated user (within their tenant) is entitled to write to project X — by querying.

## Why this matters for audit

Financial-enterprise procurement audits (SOC 2, FedRAMP, PCI-DSS) require demonstrable evidence that:

1. Access control is enforced server-side, not client-side.
2. A compromised frontend (XSS, MITM, insider threat) cannot grant unauthorised access.
3. Privilege escalation is structurally impossible — the server accepts only what the authenticated user is entitled to do within their tenant.

A missing backend check can trigger a **failed audit** and kill a procurement contract. The frontend is *never* the boundary.

## Pattern — frontend display vs. backend enforcement

### Frontend (convenience only)

```tsx
// app/(user)/.../SomePicker.tsx
// Display only artefacts the caller can see (tenant + role pre-filter from the API).
const visible = artefacts.filter(a => a.archived_at == null);
<select>{visible.map(a => <option value={a.id}>{a.title}</option>)}</select>
```

**This is NOT security.** A user with dev-tools can:

- Edit the HTML to add an `<option>` with any UUID.
- Craft a POST request by hand carrying a foreign `tenant_id`, `project_id`, or `artefact_id`.
- The frontend filter is defeated in seconds.

### Backend (the contract)

```go
// backend/internal/<service>/service.go
func (s *Service) Create(ctx context.Context, sess session.Session, req CreateRequest) (CreateResult, error) {
    // 1. Tenant + user come from the verified session — NEVER from the payload.
    tid := sess.TenantID
    uid := sess.UserID

    // 2. If the payload names a scope (project, folder, parent artefact, etc.),
    //    re-verify it lives in the caller's tenant AND the caller is entitled to write there.
    if req.ParentID != nil {
        var ownerTenant uuid.UUID
        err := s.pool.QueryRow(ctx, `
            SELECT tenant_id
              FROM artefacts
             WHERE id = $1
               AND archived_at IS NULL
        `, *req.ParentID).Scan(&ownerTenant)
        if err != nil {
            return CreateResult{}, errors_codes.NotFound("parent_artefact_missing")
        }
        if ownerTenant != tid {
            // Cross-tenant attempt — return 404, not 403, to avoid leaking existence.
            return CreateResult{}, errors_codes.NotFound("parent_artefact_missing")
        }
    }

    // 3. Permission check via the data-driven RBAC service.
    if !s.perms.UserHas(ctx, uid, "artefact.create") {
        return CreateResult{}, errors_codes.Forbidden("artefact_create_denied")
    }

    // ... insert with tenant_id = tid, created_by = uid.
}
```

The DB round-trip is **non-negotiable**. Every business rule must be re-verified server-side, in the caller's tenant, against the live state of the data.

See [`c_c_error_codes.md`](c_c_error_codes.md) for the project's error-code conventions (don't invent ad-hoc `ErrUnauthorized` sentinels) and [`c_c_roles_permissions.md`](c_c_roles_permissions.md) for the permission-lookup surface.

## Checklist for every endpoint

When adding or modifying a handler:

- [ ] **`tenant_id` is taken from the session**, never from the request body or query string.
- [ ] **`user_id` / role is taken from the session**, never from the request body.
- [ ] **Every payload field that names a resource** (`*_id` columns: `parent_id`, `project_id`, `folder_id`, `artefact_id`, `team_id`, …) is re-verified to live in the caller's tenant.
- [ ] **Every data-modifying operation** runs a permission check before the write.
- [ ] **The frontend dropdown / pre-fill is convenience only** — the backend is the contract.
- [ ] **Cross-tenant lookups return 404, not 403** — don't leak existence.
- [ ] **Errors flow through [`errors_codes`](c_c_error_codes.md)** — no bespoke sentinels.

## When the audit comes

Auditors will ask:

> "Show me where the server validates that this user, within this tenant, is entitled to create this resource — before the row is inserted."

If the answer is "the frontend filters the dropdown", the audit **fails**.
If the answer is "the service queries the DB for tenant + permission before the write", the audit **passes**.

## Related

- [`c_security.md`](c_security.md) — Trust-No-One posture; tenant isolation is rule #1.
- [`c_c_schema_auth.md`](c_c_schema_auth.md) — session / user schema + auth model.
- [`c_c_roles_permissions.md`](c_c_roles_permissions.md) — data-driven RBAC; `useHasPermission` + backend permission lookup.
- [`c_c_error_codes.md`](c_c_error_codes.md) — error-code library + decision tree.
- [`c_c_db_routing.md`](c_c_db_routing.md) — service → pool → DB → tables map (read before any psql).
