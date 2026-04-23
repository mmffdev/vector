# Polymorphic FK pattern — writer rules

Four tables in `mmff_vector` carry app-enforced polymorphic FKs (`entity_stakeholders`, `item_type_states`, `item_state_history`, `page_entity_refs`). Each pairs a `*_kind` discriminator with an opaque UUID pointing at one of several real tables. Postgres can enforce the kind vocabulary (CHECK) but cannot enforce referential integrity — every writer and every parent-archive handler must do that work in Go, in-transaction, or rows silently orphan.

## The four relationships

| Relationship | Parent kinds | Live writer | Risk |
|---|---|---|---|
| `entity_stakeholders` (`entity_kind` + `entity_id`) | `company_roadmap`, `workspace`, `portfolio`, `product` | none (dormant) | orphans on parent archive/delete |
| `item_type_states` (`item_type_kind` + `item_type_id`) | `portfolio_item_types`, `execution_item_types` | none (dormant) | orphans on type archive |
| `item_state_history` (`item_type_kind` + `item_id`) | `portfolio_item`, `execution_item` *(parent tables not yet built)* | none (dormant) | orphans once item tables ship |
| `page_entity_refs` (`entity_kind` + `entity_id`) | `portfolio`, `product` *(workspace not implemented — CHECK rejects it)* | `backend/internal/nav/bookmarks.go` | **no archive cleanup wired** |

## Five hard rules

1. **Pre-flight load with `FOR UPDATE` inside the same transaction as the insert.**
   Why: between a SELECT and an INSERT, a concurrent archive can slip in; row lock prevents the race.
2. **The loader (not the caller) sets `kind`.**
   Why: a caller passing both `kind` and `id` can lie; centralising kind assignment in the loader stops cross-kind ID injection.
3. **Enforce `parent.tenant_id = caller.tenant_id` at load time, reject otherwise (as not-found).**
   Why: the polymorphic row carries its own `tenant_id`, but writing one whose parent belongs to another tenant is a cross-tenant leak — and leaking existence via a distinct error is itself a leak.
4. **Reverse reads JOIN to the parent table (or UNION ALL across kinds), never trust the polymorphic row alone.**
   Why: an orphan row will read back as live data otherwise; a JOIN forces the orphan to disappear.
5. **Every archive/delete handler for a parent kind MUST call `cleanupPolymorphicChildren(tx, kind, id)` for every relationship pointing at that kind.**
   Why: this is the *only* mechanism standing in for `ON DELETE CASCADE`. Forget it once and the canary test (below) catches it; ship it without the call and orphans accumulate forever.

## Go pattern

The shared writer lives in `backend/internal/entityrefs` — every polymorphic insert and every parent-archive cleanup MUST route through it so the rules are expressed once and tested once. Pass an open `pgx.Tx` so the caller controls the transaction boundary; the service does no `Begin/Commit` of its own. Full service reference: [`c_c_entityrefs_service.md`](c_c_entityrefs_service.md).

Surface (see `backend/internal/entityrefs/service.go`):

- `LoadParent(ctx, tx, kind, id, callerTenant) (parentTenant, error)` — pre-flight `SELECT … FOR UPDATE` on the parent. Returns `ErrUnknownEntityKind`, `ErrEntityNotFound` (also for cross-tenant — existence is sensitive), or `ErrEntityArchived`. Used internally by every `Insert*`; exposed for callers that need the tenant for downstream work (e.g. `bookmarks.go` uses it to build a tenant-scoped page).
- `InsertEntityStakeholder(ctx, tx, kind, entityID, userID, callerTenant, role) (id, error)` — validates parent, then inserts (idempotent on the unique tuple).
- `InsertPageEntityRef(ctx, tx, pageID, kind, entityID, callerTenant) error` — validates parent, then inserts (idempotent on `(entity_kind, entity_id)`). Vocabulary narrower than `EntityKind`: only `KindPortfolio | KindProduct` — `KindWorkspace` returns `ErrUnknownEntityKind`.
- `CleanupChildren(ctx, tx, kind, id) (rowsDeleted, error)` — deletes from every polymorphic child table whose vocabulary accepts `kind`. Called from every parent's archive/delete handler inside the same tx as the archive UPDATE. Source of truth for the registry is the table below.

The writer's contract: callers build their own outer transaction, call `LoadParent` (or one of the `Insert*` methods which call it for them), do whatever else they need, commit. The dispatch trigger from migration 013 is a backstop — if a future writer bypasses this service, the trigger still rejects bad inserts at the database layer.

Reference implementation: `backend/internal/nav/bookmarks.go` `Pin` — uses `Refs.InsertPageEntityRef` for the polymorphic backlink, keeps its own `loadEntity` for the bookmark-specific name fetch.

## Cleanup registry

`entityrefs.Service.CleanupChildren(ctx, tx, kind, id)` iterates every polymorphic table whose vocabulary accepts `kind` and runs `DELETE … WHERE <kind-col> = $1 AND <id-col> = $2`. The map (see `childRelationshipsFor` in `backend/internal/entityrefs/service.go`):

| Parent kind | Child tables to clean | Handled by `CleanupChildren`? |
|---|---|---|
| `company_roadmap` | `entity_stakeholders` | yes |
| `workspace` | `entity_stakeholders` *(only — `page_entity_refs` does not accept workspace)* | yes |
| `portfolio` | `entity_stakeholders`, `page_entity_refs` | yes |
| `product` | `entity_stakeholders`, `page_entity_refs` | yes |
| `portfolio_item_types` | `item_type_states` | **no** — `item_type_states` cleanup is not yet wired into `CleanupChildren`; first type-archive handler must add it |
| `execution_item_types` | `item_type_states` | **no** — same as above |
| `portfolio_item` *(future)* | `item_state_history` | **no** — parent table not yet built |
| `execution_item` *(future)* | `item_state_history` | **no** — parent table not yet built |

`item_state_history` is append-only (UPDATE/DELETE rejected by trigger) — adding the cleanup call requires either lifting the trigger for cleanup-context deletes or a soft-tombstone column. Decide when item tables ship.

## Safe query patterns

For "all rows referencing any live parent of any kind", UNION ALL across the parent tables instead of trusting the polymorphic row:

```sql
SELECT es.*
FROM entity_stakeholders es
JOIN (
  SELECT 'workspace'::text AS kind, id, tenant_id FROM workspace WHERE archived_at IS NULL
  UNION ALL SELECT 'portfolio',     id, tenant_id FROM portfolio WHERE archived_at IS NULL
  UNION ALL SELECT 'product',       id, tenant_id FROM product   WHERE archived_at IS NULL
) parents ON parents.kind = es.entity_kind AND parents.id = es.entity_id
WHERE es.tenant_id = $1;
```

Orphans drop out automatically; archived parents drop out via `WHERE archived_at IS NULL`.

## Testing strategy

Two layers — both hit real Postgres via the tunnel; pattern after `backend/internal/nav/service_test.go`:

- **Per-relationship lifecycle test.** Create parent, insert child via the service, archive parent through its real handler, assert the child row is gone. One per (relationship × parent kind) cell — small, focused, runs on every PR that touches the relevant package.
- **Canary: `TestNoPolymorphicOrphans`.** A single integration test that runs four `SELECT count(*)` assertions (one per relationship) against the live DB and fails if any returns non-zero. Cheap, runs in CI, catches both forgotten cleanup calls and historical orphans introduced before the cleanup discipline existed. Lives at `backend/internal/dbcheck/orphans_test.go`.

## Open gap (as of 2026-04-23)

`backend/internal/nav/bookmarks.go` is the only live writer. Its insert side now routes through `entityrefs.Service` (Phase 2.2 of TD-001 pay-down). Migration 013 added BEFORE INSERT/UPDATE dispatch triggers as defence in depth — orphans cannot be inserted at all, regardless of which writer is used.

The remaining gap is the **archive side**: no handler currently archives or deletes a workspace/portfolio/product. The first such handler shipped MUST call `Refs.CleanupChildren(ctx, tx, kind, id)` inside its transaction, before the parent UPDATE. The dispatch trigger does not enforce this — it only catches inserts. The canary `TestNoPolymorphicOrphans` will catch a forgotten cleanup call post-deploy as a backstop. See [Phase 3 of `dev/planning/plan_db_polymorphic_paydown.md`](../dev/planning/plan_db_polymorphic_paydown.md).
