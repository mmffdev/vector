# Generic ranking + realtime — adopting a new orderable resource

This guide explains how to make any table participate in the
cross-cutting drag-and-drop ranking platform (backend rank service +
WebSocket fan-out + frontend hooks). The platform is resource-agnostic
by design: work items were the first adopter, defects/portfolio
levels/library items are next.

## Architecture in one paragraph

A small `ranking` package owns a compile-time registry of orderable
resources. Each registered resource carries: the table name, the
"scope column" (typically `sprint_id`), and a permission predicate.
The HTTP handler `POST /api/rank/move` dispatches by `resource_type`
in the request body, takes `SELECT FOR UPDATE` on the affected cohort
for last-write-wins concurrency, computes a gap-based integer
position, and writes it. A Postgres trigger on the table emits
`pg_notify('rank_changed', ...)` after every write; a single
goroutine on the backend (`realtime.StartRankListener`) listens and
publishes to an in-memory `Hub`. Browsers connect to `/ws`,
subscribe to `rank:<resource_type>:<subscription_id>:<scope>:<scope_id>`,
and refetch when a notification fires.

## Adoption checklist

For a new resource (e.g. `defect`), do the following in order.
None of the steps are optional.

### 1. Schema migration

Add the position columns and the position-scope CHECK constraint.
Convention from migration 068:

```sql
ALTER TABLE o_defects
  ADD COLUMN backlog_position INT NULL,
  ADD COLUMN sprint_position  INT NULL;

ALTER TABLE o_defects
  ADD CONSTRAINT o_defects_position_scope_chk
  CHECK (
    (sprint_id IS NULL  AND sprint_position IS NULL)
    OR
    (sprint_id IS NOT NULL AND sprint_position IS NOT NULL)
  );

CREATE INDEX o_defects_backlog_pos_idx
  ON o_defects (subscription_id, backlog_position)
  WHERE sprint_id IS NULL AND archived_at IS NULL;

CREATE INDEX o_defects_sprint_pos_idx
  ON o_defects (subscription_id, sprint_id, sprint_position)
  WHERE sprint_id IS NOT NULL AND archived_at IS NULL;
```

Backfill existing rows with `gap=100` in some deterministic order
(usually `created_at` or a key column). Do NOT leave existing rows
with NULL positions — the rank service treats NULL as "unknown" and
will reject moves that include them.

### 2. NOTIFY trigger

Attach the existing `notify_rank_changed` trigger function (see
migration 069). The function inspects `TG_TABLE_NAME` and emits one
JSON payload per write — you do not need a per-resource trigger
function, just a per-resource trigger.

```sql
CREATE TRIGGER o_defects_rank_notify
AFTER INSERT OR UPDATE OF backlog_position, sprint_position OR DELETE
ON o_defects
FOR EACH ROW
EXECUTE FUNCTION notify_rank_changed('defect');
```

### 3. Register the resource

In your package's wiring (or in `cmd/server/main.go`), call:

```go
ranking.Register("defect", ranking.ResourceConfig{
    Table:       "o_defects",
    ScopeColumn: "sprint_id",
    Permissions: defectsPermissions, // see step 4
})
```

Resource names are stable wire identifiers — do not rename them; the
frontend and trigger payloads use the same string.

### 4. Permission predicate

`PermissionChecker.CanRank(ctx, subscriptionID, rowID)` is called
once per move attempt, BEFORE the FOR UPDATE lock. It must:

- be cheap (a cached grant lookup or simple role check),
- never write,
- return `(false, nil)` for forbidden — that becomes a 403,
- return `(_, err)` only for unexpected failures — that becomes 500.

The rank service already enforces tenant isolation at the SQL layer
(`WHERE subscription_id = $1`), so the predicate's job is the
business-rule layer (e.g. "only the defect's reporter or a triage
admin can re-rank"). A permissive `func(...) (true, nil)` is
acceptable when you have no per-row rule.

### 5. List ordering

Update every endpoint that lists rows of this resource to order by
the position columns first:

```sql
ORDER BY coalesce(sprint_position, backlog_position) NULLS LAST, key_num ASC
```

The `coalesce` works because the CHECK constraint guarantees exactly
one of the two columns is non-NULL per row.

### 6. Sprint-membership transitions

When a row moves between scopes (story added to a sprint, story
removed from a sprint), you must clear the old scope's position and
seed the new one. Pattern from `workitems/service.go` PatchWorkItem:

- Entering a sprint: `sprint_position = MAX(sprint_position) + 100`,
  `backlog_position = NULL`.
- Leaving a sprint: `backlog_position = MIN(backlog_position) - 100`,
  `sprint_position = NULL`.

Wrap the whole transition in a transaction with FOR UPDATE on the
row so concurrent transitions do not race.

### 7. Frontend wiring

In the list component, use the four hooks:

```ts
const rank = useResourceRank({
  resourceType: "defect",
  onMoved: reorder.reconcile,
  onError: reorder.rollback,
});

const reorder = useOptimisticReorder({ items, setItems });

useRefetchOnPush({
  topic: rankTopic("defect", session.subscriptionID, "sprint", sprintID),
  refetch: () => mutateList(),
});
```

Spread `rank.handleProps(row.id)` on the drag-handle `<td>` and
`rank.rowProps(row.id)` on the `<tr>`. The shared
`<DragHandleColumn>` component renders the grip cell with the
catalog class.

Do NOT write inline drag styles — use the catalog classes
(`.drag-handle-cell`, `.drag-handle`, `.drag-row--dragging`,
`.drag-row--drop-above`, `.drag-row--drop-below`) which already live
in `app/globals.css`.

## Common mistakes

- **Forgetting the CHECK constraint.** Without it, a row can end up
  with both positions set or both NULL; the rank service produces
  garbage on that input. The constraint is the contract.
- **Calling Register from a request handler.** The registry is
  compile-time-only, by design. Runtime registration would let a
  malicious request graft a new resource onto the rank API.
- **Reading `subscription_id` from the request body.** Tenant scope
  comes from the session (`auth.UserFromCtx(ctx).SubscriptionID`),
  always. The request body is untrusted.
- **Subscribing to a topic built from concatenation.** Use
  `rankTopic(...)` — it produces the canonical format the backend
  validates against. A topic with the wrong subscription_id segment
  is silently rejected by `topicAllowed`.

## Testing

- **Unit (hub):** `internal/realtime/hub_test.go` covers fan-out,
  topic isolation, slow-consumer drop, and per-tenant subscribe
  authorization. Add a similar test for any new realtime channel
  you publish on.
- **Integration (last-write-wins):** `internal/ranking/service_integration_test.go`
  proves two concurrent movers serialize on the cohort lock and
  produce a consistent final ordering. Re-run after schema
  migrations to catch lock-name regressions.
- **E2E (drag + subtree):** `dev/tests/playwright/rank-drag.spec.ts`
  asserts that drag-drop reorders persist across reload and that
  dragging a parent row visually bundles its children.
