# `backend/internal/entityrefs` — polymorphic writer service

> Parent: [`c_polymorphic_writes.md`](c_polymorphic_writes.md)
> Last verified: 2026-04-23

The Go package that centralises every write to the four app-enforced polymorphic FK relationships. All callers MUST route through it; bypassing it defeats the defence-in-depth layering.

## Package surface (`backend/internal/entityrefs/service.go`)

| Symbol | Purpose |
|---|---|
| `EntityKind` | `string` type for parent-table names. Constants: `KindCompanyRoadmap`, `KindWorkspace`, `KindPortfolio`, `KindProduct`. |
| `ErrUnknownEntityKind` | Returned when kind is not in the vocabulary. |
| `ErrEntityNotFound` | Returned when parent is absent OR belongs to another tenant (existence is sensitive — same error either way). |
| `ErrEntityArchived` | Returned when parent exists but is archived. |
| `Service.LoadParent(ctx, tx, kind, id, callerTenant)` | Pre-flight `SELECT … FOR UPDATE` on the parent. Call this first inside every custom writer that doesn't use the `Insert*` helpers. |
| `Service.InsertEntityStakeholder(ctx, tx, kind, entityID, userID, callerTenant, role)` | Validates parent, inserts into `entity_stakeholders`. Idempotent on the unique 4-tuple. |
| `Service.InsertPageEntityRef(ctx, tx, pageID, kind, entityID, callerTenant)` | Validates parent, inserts into `page_entity_refs`. Kind vocabulary is `{portfolio, product}` only — `KindWorkspace` returns `ErrUnknownEntityKind`. |
| `Service.CleanupChildren(ctx, tx, kind, id)` | Deletes all polymorphic child rows referencing `(kind, id)`. Call in every parent archive/delete handler, inside the same tx as the archive UPDATE. See [Cleanup registry](c_polymorphic_writes.md#cleanup-registry). |

## What the service does NOT cover

- `item_type_states` cleanup (parent kinds `portfolio_item_types`, `execution_item_types`) — not yet wired. First type-archive handler must extend `CleanupChildren` to cover these.
- `item_state_history` — append-only; parent tables (`portfolio_item`, `execution_item`) not yet built.

## Construction

```go
refs := entityrefs.New(pool)          // pool-level (for pooled operations)
// — or —
refs := &entityrefs.Service{Pool: pool}
```

Pass an open `pgx.Tx` to every method; the service never begins or commits its own transaction.

## Defence-in-depth chain

1. **Go layer (this package):** pre-flight `FOR UPDATE` + tenant/archive checks before every insert.
2. **DB layer:** migration 013 `dispatch_polymorphic_parent` triggers — reject bad inserts at `entity_stakeholders`, `page_entity_refs`, and `item_type_states` even if the Go layer is bypassed.
3. **Canary:** `backend/internal/dbcheck/orphans_test.go` `TestNoPolymorphicOrphans` — catches any orphans that accumulate post-deploy.

## Reference implementation

`backend/internal/nav/bookmarks.go` `Pin` — uses `Refs.InsertPageEntityRef`; see inline comments for the reasoning on why `loadEntity` and `InsertPageEntityRef` both check the parent.
