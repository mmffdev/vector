# Sentinel Clamp Model

Sentinel is the request-time authority for scoped Vector reads. Frontend `useSentinel()` owns the UI state bag (`sentinel_user`, `sentinel_grants`, `sentinel_focus_node`, `sentinel_can`, etc.), but the backend middleware recomputes the real clamp on every protected request. Never treat frontend scope state as the gate.

Backend route groups for work/portfolio artefacts mount `auth.RequireAuth`, `RequireFreshPassword`, then `sentinel.Middleware`. The middleware:

- Reads authenticated user, tenant/subscription, role id, and JWT workspace claim.
- Resolves `WorkspaceID` from JWT claim, falling back to the first live workspace the actor has an active grant on; always calls `HasActiveRole` to reject forged/stale workspace claims.
- Resolves focus node in this order: URL `?meg=` > `users.default_focus_node_id` > workspace root > tenant root.
- Validates URL/default focus against the current workspace and the actor's grant predicate (`GrantOnNode`, with descend-inheritance; gadmin short-circuits by role id).
- Resolves the allowed topology set as focus + ancestors/descendants according to `ScopeUp`/`ScopeDown`, then attaches `sentinel.Clamp` to context.

`sentinel.Clamp` carries `TenantID`, `UserID`, `Role`, `RoleID`, `WorkspaceID`, `FocusNodeID`, `ScopeUp`, `ScopeDown`, `AllowedSubtreeIDs`, and `SubtreeResolved`. `SubtreeResolved` is important: resolved-empty fails closed; no middleware or deliberate post-write bypass no-ops.

Artefact list/search reads consume the clamp through the consumer-side `topologyclamp` adapter, passing their own trusted topology column such as `a.artefacts_id_topology_node`. Legacy caller-supplied topology narrowing must intersect with the same clamp. Single-row reads post-filter against `AllowedSubtreeIDs` and return not-found for out-of-clamp rows to avoid existence leaks. `WithBypassedSubtreeClamp` is only for the immediate post-write read after a separate write authorization already succeeded.

For `/scope` and future strategic grids: fetch roots/children through the existing server POST `/query` contract and let Sentinel + workspace + topology clamps decide visibility. The grid should not infer what a user can view from `sentinel_grants` or client-side tree state; those are presentation hints, not authority.

Known watchpoint: `backend/internal/lintchecks/sentinel_clamp_test.go` is the structural ratchet, but its table-name regex still keys on older singular `artefact_*` names. Core artefact services are currently clamped by direct code, but the lint should be widened to include live `artefacts*` table names before relying on it as complete coverage.
