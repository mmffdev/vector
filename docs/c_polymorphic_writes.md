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

Sketch — mirrors `backend/internal/nav/bookmarks.go`. Pass an open `pgx.Tx` so the caller controls the transaction boundary; the service does no `Begin/Commit` of its own.

```go
type EntityRefService struct{ Pool *pgxpool.Pool }

// Insert validates the parent (tenant fence + archive check + FOR UPDATE)
// and writes the polymorphic row in the same tx. Loader picks the table
// from kind — caller passes only an opaque (kind, id) reference.
func (s *EntityRefService) Insert(ctx context.Context, tx pgx.Tx, kind EntityKind, id uuid.UUID, callerTenant uuid.UUID, pageID uuid.UUID) error {
    table, ok := parentTableFor(kind) // hard-coded enum → never user input
    if !ok { return ErrUnknownEntityKind }
    var tenantID uuid.UUID
    var archived *time.Time
    err := tx.QueryRow(ctx, fmt.Sprintf(
        `SELECT tenant_id, archived_at FROM %s WHERE id = $1 FOR UPDATE`, table), id,
    ).Scan(&tenantID, &archived)
    if errors.Is(err, pgx.ErrNoRows) || tenantID != callerTenant { return ErrEntityNotFound }
    if err != nil { return err }
    if archived != nil { return ErrEntityArchived }
    _, err = tx.Exec(ctx, `
        INSERT INTO page_entity_refs (page_id, entity_kind, entity_id)
        VALUES ($1, $2, $3) ON CONFLICT (entity_kind, entity_id) DO NOTHING`,
        pageID, string(kind), id)
    return err
}

// DeleteByParent wipes every polymorphic child row pointing at (kind, id).
// Called from the parent's archive/delete handler.
func (s *EntityRefService) DeleteByParent(ctx context.Context, tx pgx.Tx, kind EntityKind, id uuid.UUID) error {
    _, err := tx.Exec(ctx, `DELETE FROM page_entity_refs WHERE entity_kind = $1 AND entity_id = $2`, string(kind), id)
    return err
}
```

## Cleanup registry

`cleanupPolymorphicChildren(ctx, tx, kind, id)` iterates every polymorphic table whose vocabulary accepts `kind` and runs `DELETE … WHERE <kind-col> = $1 AND <id-col> = $2`. The map:

| Parent kind | Child tables to clean |
|---|---|
| `company_roadmap` | `entity_stakeholders` |
| `workspace` | `entity_stakeholders` *(only — `page_entity_refs` does not accept workspace)* |
| `portfolio` | `entity_stakeholders`, `page_entity_refs` |
| `product` | `entity_stakeholders`, `page_entity_refs` |
| `portfolio_item_types` | `item_type_states` |
| `execution_item_types` | `item_type_states` |
| `portfolio_item` *(future)* | `item_state_history` |
| `execution_item` *(future)* | `item_state_history` |

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

`backend/internal/nav/bookmarks.go` is the only live writer. Its insert side is correct (tenant fence, archive check, transactional, idempotent `ON CONFLICT`). Its **archive side does not exist** — there is currently no handler that archives or deletes a workspace/portfolio/product. The first such handler shipped MUST call `cleanupPolymorphicChildren(tx, kind, id)` (or the inline `DELETE FROM page_entity_refs WHERE entity_kind=$1 AND entity_id=$2`) inside its transaction. Until then the canary will pass purely because no parent ever goes away.
