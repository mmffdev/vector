# S03 — Inverse-Sentinel Resolver + broadcast.Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Land `v2/broadcast/` package — the entry point for broadcast events (workspace, topology_node, topology_subtree, tenant, platform fanout modes). Contains: `Resolver` interface + impl (inverse-Sentinel: given a scope, return the user set), `broadcast.Service` (auth check → resolver → atomic write of event + N recipient rows), `Auth` helper (gadmin / pAdmin+ownership / sub-admin checks).

**Story estimate:** 8

**Wave:** 2 — parallel-safe with S02, S05, S07, S08 (each in own worktree)

**Branch:** `notif-v2-s03` (flat naming convention)

---

## Read first (REQUIRED)

1. **Spec sections:**
   - "Architecture" → `v2/broadcast/` package layout (resolver, service, auth files)
   - "Interfaces" → `broadcast.Service` + `broadcast.Resolver`
   - "End-to-end flow" → "Broadcast event — fan-out at delivery" subsection
   - Locked decisions #11 (six fan-out modes), #12 (snapshot at fire-time), #13 (inverse-Sentinel lives in v2/broadcast/, NOT in sentinel package)

2. **Spec data model:**
   - `notifications_events_v2` — same table S02 writes; broadcast writes here too but with broadcast fanout_mode + non-NULL id_workspace/id_topology_node + NULL id_recipient_user
   - `notifications_event_recipients` — broadcast writes N rows here (one per resolved recipient) inside the same tx as the event

3. **Existing project code:**
   - `backend/internal/sentinel/` — the forward Sentinel package. Read `types.go` for the Resolver interface, `resolver.go` for `FirstLiveWorkspace`, `handler.go` for `GrantOnNode`. Your inverse resolver consumes Sentinel primitives but does NOT live in this package.
   - `backend/internal/topology/` — the topology service (post-RF1.4.1). Your resolver queries `topology_nodes` for descendants when subtree=true. Read the service to find the right call.
   - `backend/internal/users/` (or wherever active-users lookup lives) — used for tenant + platform recipient resolution.

4. **HARD RULES:** strangler-fig (no v1 imports), inspect-index-before-commit, explicit-path `git add`, sentinel rule (no need on this story — but broadcast handlers in S11 will need it; you're not building handlers yet).

---

## File structure

| File | Purpose |
|---|---|
| `backend/internal/notifications/v2/broadcast/resolver.go` | `Resolver` interface + Postgres impl |
| `backend/internal/notifications/v2/broadcast/resolver_test.go` | Integration tests (real DB, seeded topology + users) |
| `backend/internal/notifications/v2/broadcast/auth.go` | `CheckPlatformAuth`, `CheckTopologyAuth(nodeID)`, `CheckTenantAuth` — pure functions taking sentinel.Clamp + node|sub IDs |
| `backend/internal/notifications/v2/broadcast/service.go` | `BroadcastRequest`, `BroadcastResult`, `Service` interface + impl |
| `backend/internal/notifications/v2/broadcast/service_test.go` | Integration tests: Broadcast() writes event + N recipients + sets resolved_at/recipient_count; PreviewRecipientCount() returns N without write |

---

## Tasks

### Task 1 — Worktree confirm + dev DB readiness

- [ ] **1.1** `git branch --show-current` → expect `notif-v2-s03`
- [ ] **1.2** Verify `topology_nodes`, `users`, `master_record_workspaces` all in `vector_artefacts` (post-refactor 2026-05-26):
  ```bash
  psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "\dt topology_nodes users master_record_workspaces" 2>&1 | head -10
  ```

### Task 2 — `resolver.go`

- [ ] **2.1** Write the `Resolver` interface per spec. Four methods (`UsersForTopologyNode(ctx, nodeID, subtree)`, `UsersForWorkspace(ctx, workspaceID)`, `UsersForSubscription(ctx, subscriptionID)`, `UsersForPlatform(ctx)`). Each returns `([]uuid.UUID, error)`.

- [ ] **2.2** Implement `pgResolver` struct holding `*pgxpool.Pool`. Each method runs a single SQL query against `vector_artefacts`:
  - `UsersForTopologyNode(nodeID, subtree=false)` → users whose clamp includes nodeID. The "clamp includes" check is the same one Sentinel's forward resolver does in reverse. Read `backend/internal/sentinel/sql.go` for the join shape — you want the inverse: instead of "for user U, which nodes?", you want "for node N, which users?". Likely uses `users_roles_workspaces` + `topology_nodes` joins.
  - `UsersForTopologyNode(nodeID, subtree=true)` → recursive CTE over `topology_nodes` rooted at nodeID, then join users via the workspace clamp.
  - `UsersForWorkspace(workspaceID)` → `SELECT users_id FROM users JOIN users_roles_workspaces ON ... WHERE users_roles_workspaces_id_workspace = $1 AND users_is_active`
  - `UsersForSubscription(subscriptionID)` → `SELECT users_id FROM users WHERE users_id_subscription = $1 AND users_is_active`
  - `UsersForPlatform()` → `SELECT users_id FROM users WHERE users_is_active`

  Watch column names — every column under the column-prefix HARD RULE. Look at `\d users` to confirm.

- [ ] **2.3** Compile + commit. Subject: `feat(notif-v2): broadcast.Resolver — inverse-Sentinel impl`.

### Task 3 — `resolver_test.go` (integration)

- [ ] **3.1** Tag `//go:build integration`. Seed a small topology fixture in `t.Cleanup`-able transactions: parent node A with children B and C, two test users (U1 clamped to B, U2 clamped to A). Test cases:
  - `UsersForTopologyNode(A, subtree=false)` → only U2
  - `UsersForTopologyNode(A, subtree=true)` → U1 + U2
  - `UsersForWorkspace(wsContainingA)` → both users (if both in same workspace)
  - `UsersForSubscription(subID)` → both
  - `UsersForPlatform()` → both (and probably more — assert the test users are in the set, don't assert exact count)
  - Property: `subtree=true ⊇ subtree=false` for any node

- [ ] **3.2** Run with integration tag. Commit.

### Task 4 — `auth.go`

- [ ] **4.1** Three pure functions:
  ```go
  // CheckPlatformAuth — only gadmin role
  func CheckPlatformAuth(ctx context.Context, userID uuid.UUID, ...) error
  
  // CheckTopologyAuth — pAdmin+ AND owns the node (sentinel.GrantOnNode)
  func CheckTopologyAuth(ctx context.Context, userID, nodeID uuid.UUID, ...) error
  
  // CheckTenantAuth — subscription admin role
  func CheckTenantAuth(ctx context.Context, userID, subscriptionID uuid.UUID, ...) error
  ```
  Each returns `nil` on success, a typed error (define `ErrNotAuthorized`) on rejection. Use the existing roles package (`backend/internal/roles/`) to check roles; use `sentinel.GrantOnNode` (commit f89fe4ed reference) for the topology check.

- [ ] **4.2** Unit tests for the auth functions (with mocked role+sentinel interfaces).

- [ ] **4.3** Compile + commit.

### Task 5 — `service.go`

- [ ] **5.1** `BroadcastRequest` per spec (SentByUserID, EventType, Priority, Data, Mode, SubscriptionID, WorkspaceID, TopologyNodeID, DryRun). `BroadcastResult` (EventID, RecipientCount).

- [ ] **5.2** `Service` interface: `Broadcast(ctx, req)` and `PreviewRecipientCount(ctx, req)`.

- [ ] **5.3** Implement `service` struct holding `*pgxpool.Pool`, `Resolver`, and an `Auth` interface (so tests can swap auth).

- [ ] **5.4** `Broadcast`:
  1. Auth check based on `req.Mode` — call the right `Check*Auth` function
  2. Resolve recipients via `Resolver` (correct method per Mode)
  3. Begin tx
  4. INSERT into `notifications_events_v2` with broadcast fields (Mode, scope IDs, recipient_count=len(users), resolved_at=now())
  5. INSERT N rows into `notifications_event_recipients` (one per user, with `resolved_reason` matching Mode)
  6. Commit
  7. Return `BroadcastResult{EventID: id, RecipientCount: len(users)}`
  
  If `req.DryRun == true`: do auth + resolve only; return `RecipientCount` without writes; EventID = `uuid.Nil`.

- [ ] **5.5** `PreviewRecipientCount` = auth + resolve only (no DB write). Returns `len(users)`.

- [ ] **5.6** Compile + commit.

### Task 6 — `service_test.go` (integration)

- [ ] **6.1** Tagged integration test. Cases:
  - Broadcast(workspace) writes 1 event + N recipients atomically; `notifications_events_v2.resolved_at IS NOT NULL`, `recipient_count = N`
  - Broadcast(topology_subtree) with cascade includes descendant users
  - Broadcast(platform) writes event with `id_subscription IS NULL`
  - PreviewRecipientCount(workspace) returns N, writes zero rows
  - Auth rejection (e.g. non-gadmin attempting platform) returns ErrNotAuthorized, writes zero rows
  - DryRun=true with valid auth returns RecipientCount, writes zero rows
  - Snapshot semantics: after Broadcast, adding a new user to the workspace does NOT add a recipient row for them retroactively (verify by query)

- [ ] **6.2** Run with `-tags=integration`. Commit.

### Task 7 — Lint discipline

- [ ] **7.1** No new architectural rule unique to this story (the spec's hard rules around broadcast scope are already enforceable via the existing CHECK constraints on events_v2). Document this in your report ("no new lint needed for S03 — spec invariants enforced at DB layer via mig 120 CHECK constraints").

- [ ] **7.2** Verify existing lints still pass: `lint:no-v1-broker-imports`, `lint:no-direct-outbox-write` (from S02). The `lint:no-direct-outbox-write` check should PASS because broadcast.Service IS inside v2/.

### Task 8 — Final verification

- [ ] **8.1** Full build + vet, unit tests, integration tests (DATABASE_URL set).
- [ ] **8.2** Lint pass on existing rules.
- [ ] **8.3** No imports from v1 notifications, no imports from S02 producer package (S03 is a separate doorway — it writes directly to the events_v2 table, not via Producer, because broadcasts have different shape). DO IMPORT from S02's domain package (your types).

### Task 9 — Report

```
S03 WORKER — STATUS: READY FOR VALIDATION
Branch: notif-v2-s03
Commits (oldest first):
  ... (one per file basically: resolver.go, resolver_test.go, auth.go + auth tests, service.go, service_test.go)
Spec sections covered: Interfaces (Service, Resolver), End-to-end flow (broadcast variant), Decisions #11/#12/#13
Lints landed: none new (rationale in report)
Vector_Scope.md: untouched (validator does the consolidated commit)
Open questions for validator: ...
```

---

## Definition of Done

1. 5 files exist under `backend/internal/notifications/v2/broadcast/`
2. Build + vet clean
3. Unit + integration tests PASS
4. No imports from v1 notifications package
5. Validator PASS verdict
6. Branch merged into `feature/notifications-v2` by Validator

---

## Risks

| Risk | Mitigation |
|---|---|
| Inverse Sentinel query complexity (recursive CTE for subtree) | Write the CTE once, parameterise, test against fixture; the topology service may already have a helper for descendants — check before rolling your own |
| Auth check coupling to existing roles package | Take role-resolver as interface; don't hard-import the concrete role service — keeps testability and lets the handler in S11 inject the right service |
| Recipient resolution ordering / determinism | Within a single tx the INSERTs will be in iteration order of the user slice; sort the slice by user ID before INSERT to make the test assertion deterministic |
| Large user set on platform broadcast | spec calls out fan-out at fire time may be slow for 100k+ users. For S03 implement it straightforwardly; the spec accepts platform broadcasts being slow-but-rare. Don't add async pre-emption now — that's YAGNI |
| Idempotency on broadcast event_key | Same idempotency contract as producer (UNIQUE on (subscription_id, event_key) — but platform events have NULL subscription_id, so the constraint allows multiple identical platform events). The constraint matches the spec — don't add extra dedup |
