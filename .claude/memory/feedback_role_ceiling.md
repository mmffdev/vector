---
name: Role ceiling on account management
description: Hard rule — an admin can only create or modify accounts at their own role level or below; never above.
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Rule:** Any account-management action (create user, update role, activate/deactivate, password reset, delete) must reject if the target role is *above* the actor's role. Role hierarchy: `gadmin > padmin > user`.

- **gadmin** may act on gadmin, padmin, user
- **padmin** may act on padmin, user (NOT gadmin)
- **user** — no account-management rights at all

**Why:** Prevents privilege escalation via account-management endpoints — e.g. a padmin creating a gadmin account, demoting a gadmin so they can be re-promoted, or resetting a gadmin's password. This is the classic "low-priv resets high-priv" attack and is a hard security invariant, not a UX preference. Confirmed during the Workspace Settings / Portfolio Settings split: the brief moves user-management into Portfolio Settings for padmins and we can't open that door without this ceiling enforced server-side.

**How to apply:**
- Every user-management handler/service method must accept the *actor* and check `actor.Role >= target.Role` before proceeding. Reject with 403 (not 400) when violated — it's an authorisation failure, not a validation failure.
- Enforce on Create: reject if `req.Role > actor.Role`.
- Enforce on Update: reject if the *target's current role* is above actor's, AND reject if the *requested new role* is above actor's.
- Enforce equivalently on any password-reset / deactivate / delete endpoints, regardless of whether they're currently gated to gadmin-only at the route layer — the service-level check is defence-in-depth so opening the route later doesn't reintroduce the gap.
- Frontend should mirror (hide create-gadmin option for padmin, hide role dropdown options above actor's level) but frontend mirroring is cosmetic; the gate is the backend.
- Tests must cover: padmin attempts to create gadmin → 403; padmin attempts to change a user's role to gadmin → 403; padmin attempts to update a gadmin's record → 403; gadmin doing any of the above → 200.

**Current state (2026-04-23):** route-layer gate in main.go only lets gadmin hit POST/PATCH `/api/admin/users`. Service layer has no ceiling check yet. Must be added before the Workspace Settings split opens user-list access to padmins.
