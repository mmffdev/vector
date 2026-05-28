# Saved Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the saved-views substrate (table + service + handler + reusable frontend component family) per [`docs/superpowers/specs/2026-05-28-saved-views-design.md`](../specs/2026-05-28-saved-views-design.md). At end-of-plan, six fixed OTV2 pages can mount `<SavedViewsControl kind target />` for one-line per-page adoption. Custom Pages becomes additive (new `kind` value), not refactor.

**Architecture:** One table `saved_views` in `vector_artefacts` with scope discriminator (`user|node|workspace`), kind discriminator (`objecttree|page_layout`), opaque internal `target` ID convention (`<kind>:<stable-id>`), JSONB body. Go sole-writer service enforces permissions (Rally pattern, permissive at node level) and tenant integrity. React reusable component family with headless `useSavedViews` hook + four chrome components, context-free contract.

**Tech Stack:** Postgres 16 + pgx/v5 (vector_artefacts pool); Go 1.22 + chi router; TypeScript + React 19 + Next.js 15; existing project utilities (`apiSite`, `sentinel`, `topology.Service`, `auth.Service`, `cache.Client`, `audit_logs`).

**Branch:** `feat/objecttree-fields-picker` (worktree at `/Users/rick/Documents/MMFFDev - Projects/Vector-feat-objecttree-fields-picker`). Already carries 4 commits: ColumnSpec enrichment + useColumnCatalogue hook + columnstore TD + design spec.

---

## File map

**Backend** (`backend/internal/savedviews/`):
- `doc.go` — package doc, swap-path documentation
- `types.go` — wire types, sentinel errors
- `sql.go` — named SQL constants only
- `store.go` — `ViewStore` interface + `PostgresViewStore` implementation
- `service.go` — `Service` with permission gating + tenant integrity + audit emission + cache invalidation
- `service_cache.go` — `CachedViewStore` wrapper around `ViewStore` + `cache.Client` (Task 12, opt-in)
- `handler.go` — chi HTTP surface, six endpoints
- `service_test.go` — integration tests covering permission rules + tenant integrity + cache invalidation

**Database** (`db/vector_artefacts/schema/`):
- `145_saved_views.sql` — table, indexes, trigger, triggers for updated_at
- `down/145_saved_views_DOWN.sql` — reverse

**Lints** (`dev/scripts/`):
- `lint_savedviews_writer_only.py` — block raw writes outside `backend/internal/savedviews/`
- `lint_savedviews_context_free.py` — block `useRouter` / `window.location` / route constants inside `app/components/SavedViews/`

**Frontend** (`app/components/SavedViews/`):
- `types.ts` — wire shapes
- `useSavedViews.ts` — headless hook
- `SavedViewsControl.tsx` — umbrella component
- `SavedViewsDropdown.tsx`
- `SaveAsNewViewModal.tsx`
- `ManageSavedViewsModal.tsx`
- `SaveChangesIndicator.tsx`

**CSS** (`app/globals.css`):
- `.saved-views__*` block, following existing `.column-picker__*` pattern

**Wire-up:**
- `backend/cmd/server/main.go` — construct service, mount routes
- `.claude/CLAUDE.md` — one-line pointer
- `docs/c_c_db_routing.md` — add saved_views row
- `docs/c_schema.md` — catalogue entry

---

## Phase 1 — Database substrate

### Task 1: Migration 145 — `saved_views` table, indexes, trigger

**Files:**
- Create: `db/vector_artefacts/schema/145_saved_views.sql`
- Create: `db/vector_artefacts/schema/down/145_saved_views_DOWN.sql`

- [ ] **Step 1: Write migration file**

`db/vector_artefacts/schema/145_saved_views.sql`:

```sql
-- ============================================================
-- 145_saved_views.sql
--
-- Saved views substrate — Rally-style "Save As New View" /
-- "Manage Saved Views". One table serves multiple consumers via
-- the `kind` discriminator (objecttree | page_layout) and three
-- sharing scopes (user | node | workspace).
--
-- Design: docs/superpowers/specs/2026-05-28-saved-views-design.md
--
-- WHY ONE TABLE: every saved view is the same shape — a JSON body
-- interpreted by its consumer, keyed by (kind, target, scope). The
-- consumer (ObjectTreeV2, future custom pages, etc.) owns the body
-- schema; the table is consumer-agnostic.
--
-- WHY DENORMALISED IDS: every read clamps on (subscription, scope,
-- scope_id, kind, target). Storing the four IDs on the row means
-- single index hit, no joins. Pattern matches `artefacts` table.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS + CREATE OR REPLACE TRIGGER FUNCTION.
--
-- ROLLBACK: db/vector_artefacts/schema/down/145_saved_views_DOWN.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS saved_views (
    saved_views_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    saved_views_id_subscription UUID NOT NULL,

    saved_views_kind            TEXT NOT NULL,
    saved_views_scope           TEXT NOT NULL,

    saved_views_id_user         UUID,
    saved_views_id_node         UUID,
    saved_views_id_workspace    UUID,

    saved_views_target          TEXT NOT NULL,
    saved_views_name            TEXT NOT NULL,
    saved_views_body            JSONB NOT NULL DEFAULT '{}'::jsonb,

    saved_views_id_user_created_by UUID NOT NULL,
    saved_views_created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_views_archived_at     TIMESTAMPTZ,

    CONSTRAINT saved_views_kind_check
        CHECK (saved_views_kind IN ('objecttree', 'page_layout')),

    CONSTRAINT saved_views_scope_check
        CHECK (saved_views_scope IN ('user', 'node', 'workspace')),

    CONSTRAINT saved_views_one_scope_id
        CHECK (
            (saved_views_scope = 'user'      AND saved_views_id_user      IS NOT NULL AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'node'      AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NOT NULL AND saved_views_id_workspace IS NULL)
         OR (saved_views_scope = 'workspace' AND saved_views_id_user      IS NULL     AND saved_views_id_node IS NULL     AND saved_views_id_workspace IS NOT NULL)
        ),

    CONSTRAINT saved_views_archived_after_created
        CHECK (saved_views_archived_at IS NULL OR saved_views_archived_at >= saved_views_created_at),

    CONSTRAINT saved_views_body_size_cap
        CHECK (octet_length(saved_views_body::text) <= 65536)
);

COMMENT ON TABLE saved_views IS
    'Saved view configurations — Rally-style "Save As New View" / "Manage Saved Views". '
    'One table serves multiple consumers via kind discriminator (objecttree, page_layout). '
    'Scope discriminator (user/node/workspace) controls sharing. '
    'Permission rules enforced in backend/internal/savedviews/service.go.';

COMMENT ON COLUMN saved_views.saved_views_target IS
    'OPAQUE INTERNAL IDENTIFIER following `<kind>:<stable-id>` convention. '
    'Examples: objecttree:work_items, objecttree:risks, future custom_page:<uuid>, '
    'objecttree:custom:<page_uuid>:<instance_uuid>. The ID after the colon is the '
    'STABLE identifier of the resource the view applies to, never the user-visible '
    'name. Names are resolved at render time from source-of-truth tables. '
    'ANTI-PATTERN: do NOT add a denormalised target_label column.';

-- Three partial indexes, one per scope. Postgres can Bitmap-Or when the
-- picker needs all three simultaneously. Each is point-lookup-shaped on
-- its scope column.
CREATE INDEX IF NOT EXISTS saved_views_by_user
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'user';

CREATE INDEX IF NOT EXISTS saved_views_by_node
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_node,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'node';

CREATE INDEX IF NOT EXISTS saved_views_by_workspace
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_workspace,
        saved_views_kind,
        saved_views_target
    )
    WHERE saved_views_archived_at IS NULL
      AND saved_views_scope = 'workspace';

CREATE INDEX IF NOT EXISTS saved_views_by_creator
    ON saved_views (
        saved_views_id_subscription,
        saved_views_id_user_created_by,
        saved_views_kind
    )
    WHERE saved_views_archived_at IS NULL;

-- updated_at touch trigger (project convention).
CREATE OR REPLACE FUNCTION saved_views_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.saved_views_updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS saved_views_touch_updated_at ON saved_views;
CREATE TRIGGER saved_views_touch_updated_at
    BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION saved_views_touch_updated_at();

COMMIT;
```

- [ ] **Step 2: Write DOWN script**

`db/vector_artefacts/schema/down/145_saved_views_DOWN.sql`:

```sql
-- ============================================================
-- 145_saved_views_DOWN.sql — reverses 145_saved_views.sql
-- ============================================================

BEGIN;
DROP TRIGGER IF EXISTS saved_views_touch_updated_at ON saved_views;
DROP FUNCTION IF EXISTS saved_views_touch_updated_at();
DROP TABLE IF EXISTS saved_views;
COMMIT;
```

- [ ] **Step 3: Dry-run the migration**

Run: `cd /Users/rick/Documents/MMFFDev\ -\ Projects/Vector-feat-objecttree-fields-picker && dev/scripts/dry_run_migration.sh vector_artefacts 145_saved_views.sql`
Expected: `BEGIN`, table created, indexes created, `ROLLBACK`, exit 0.

- [ ] **Step 4: Apply the migration**

Run: `cd backend && go run ./cmd/migrate -db vector_artefacts -apply`
Expected output line: `applied: 145_saved_views.sql`. Final summary: `up to date`.

- [ ] **Step 5: Verify schema**

Run: `PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts -c '\d saved_views'`
Expected: table description shows 13 columns, 4 partial indexes, 5 CHECK constraints, 1 trigger.

- [ ] **Step 6: Commit**

```bash
git add db/vector_artefacts/schema/145_saved_views.sql db/vector_artefacts/schema/down/145_saved_views_DOWN.sql
git commit -m "feat(db): mig 145 — saved_views table + indexes + trigger (substrate for saved-views design)"
```

---

## Phase 2 — Backend Go package: substrate

### Task 2: Package scaffolding — `doc.go`, `types.go`

**Files:**
- Create: `backend/internal/savedviews/doc.go`
- Create: `backend/internal/savedviews/types.go`

- [ ] **Step 1: Create `doc.go`**

`backend/internal/savedviews/doc.go`:

```go
// Package savedviews is the sole writer for the saved_views table in
// vector_artefacts. Implements Rally-style "Save As New View" + "Manage
// Saved Views" semantics with three sharing scopes (user | node |
// workspace) and a kind discriminator (objecttree | page_layout) so one
// table serves multiple consumers.
//
// Design: docs/superpowers/specs/2026-05-28-saved-views-design.md
// Plan:   docs/superpowers/plans/2026-05-28-saved-views.md
//
// # Architecture
//
// The package is layered:
//
//	store.go   — ViewStore interface + PostgresViewStore implementation
//	service.go — Service wraps a ViewStore; enforces permissions, tenant
//	             integrity, audit-log emission. Sole writer.
//	handler.go — chi HTTP surface; six endpoints under /_site/saved-views.
//
// # ViewStore swap path
//
// The ViewStore interface is the load-bearing future-proofing artefact.
// Every handler and the Service depend on the interface, never on
// *pgxpool.Pool directly. If a future scale curve makes Postgres the
// wrong substrate for this one table, the swap is:
//
//  1. Implement ViewStore against the new store.
//  2. Add a migration tool that reads from PostgresViewStore and writes
//     to the new store (the body shape is opaque JSON; no
//     re-schema-ing needed).
//  3. Flip the constructor in backend/cmd/server/main.go to the new
//     impl behind a feature flag.
//  4. Verify a week of dual reads (both stores returning identical
//     results), then retire PostgresViewStore.
//
// # Scale envelope
//
// See spec §5. Today's substrate handles up to ~10M rows on default
// Postgres settings, up to ~100M with autovacuum tuning + Valkey
// caching (CachedViewStore), up to ~500M with HASH partitioning on
// saved_views_id_subscription. Beyond that, the swap path above.
package savedviews
```

- [ ] **Step 2: Create `types.go`**

`backend/internal/savedviews/types.go`:

```go
package savedviews

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors. Handlers translate these to HTTP status codes.
var (
	ErrNotFound        = errors.New("saved view not found")
	ErrForbidden       = errors.New("caller may not perform this action on this saved view")
	ErrInvalidInput    = errors.New("invalid saved-view input")
	ErrNotNodeMember   = errors.New("caller is not a member of the target topology node")
	ErrNotWSAdmin      = errors.New("caller is not a workspace admin")
	ErrTenantMismatch  = errors.New("scope id does not belong to the caller's subscription")
	ErrBodyTooLarge    = errors.New("saved view body exceeds 64KB cap")
)

// Scope values.
const (
	ScopeUser      = "user"
	ScopeNode      = "node"
	ScopeWorkspace = "workspace"
)

// Kind values.
const (
	KindObjectTree = "objecttree"
	KindPageLayout = "page_layout"
)

// View is the wire shape returned by the handler. Field names match the
// column-prefix convention so the frontend addresses fields with the
// same prefix the table uses.
type View struct {
	ID             uuid.UUID       `json:"saved_views_id"`
	SubscriptionID uuid.UUID       `json:"saved_views_id_subscription"`
	Kind           string          `json:"saved_views_kind"`
	Scope          string          `json:"saved_views_scope"`
	UserID         *uuid.UUID      `json:"saved_views_id_user,omitempty"`
	NodeID         *uuid.UUID      `json:"saved_views_id_node,omitempty"`
	WorkspaceID    *uuid.UUID      `json:"saved_views_id_workspace,omitempty"`
	Target         string          `json:"saved_views_target"`
	Name           string          `json:"saved_views_name"`
	Body           json.RawMessage `json:"saved_views_body"`
	CreatedBy      uuid.UUID       `json:"saved_views_id_user_created_by"`
	CreatedAt      time.Time       `json:"saved_views_created_at"`
	UpdatedAt      time.Time       `json:"saved_views_updated_at"`
	ArchivedAt     *time.Time      `json:"saved_views_archived_at,omitempty"`
}

// ListVisibleQuery is the parameter struct for ListVisibleToUser.
// Returns the union of three result sets:
//   - user-scoped views where SubscriptionID matches + UserID matches Actor
//   - node-scoped views where SubscriptionID matches + NodeID is in Actor's node memberships
//   - workspace-scoped views where SubscriptionID matches + WorkspaceID matches Actor's workspace
// All filtered by Kind + Target + archived_at IS NULL.
type ListVisibleQuery struct {
	SubscriptionID uuid.UUID
	ActorUserID    uuid.UUID
	ActorWorkspace uuid.UUID
	ActorNodeIDs   []uuid.UUID // nodes the actor is a member of
	Kind           string
	Target         string
}

// CreateInput is the parameter struct for Service.Create. Scope+IDs must
// satisfy CHECK constraint (exactly one of id_user/id_node/id_workspace
// matching scope). Tenant integrity verified by service.
type CreateInput struct {
	SubscriptionID uuid.UUID
	Kind           string
	Scope          string
	UserID         *uuid.UUID
	NodeID         *uuid.UUID
	WorkspaceID    *uuid.UUID
	Target         string
	Name           string
	Body           json.RawMessage
	ActorUserID    uuid.UUID // becomes id_user_created_by
}

// UpdateScopeInput is the parameter struct for Service.UpdateScope.
// Used to promote/demote a view between sharing scopes. ViewID and
// ActorUserID identify the row + the caller; new scope + scope ID
// replace the existing values.
type UpdateScopeInput struct {
	SubscriptionID uuid.UUID
	ViewID         uuid.UUID
	NewScope       string
	NewUserID      *uuid.UUID
	NewNodeID      *uuid.UUID
	NewWorkspaceID *uuid.UUID
	ActorUserID    uuid.UUID
}
```

- [ ] **Step 3: Build to verify syntax**

Run: `cd backend && go build ./internal/savedviews/...`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/savedviews/doc.go backend/internal/savedviews/types.go
git commit -m "feat(savedviews): package scaffolding — doc.go + types.go [sentinel errors, scope/kind constants, wire types]"
```

---

### Task 3: SQL constants — `sql.go`

**Files:**
- Create: `backend/internal/savedviews/sql.go`

- [ ] **Step 1: Create `sql.go` with all named query constants**

`backend/internal/savedviews/sql.go`:

```go
package savedviews

// All SQL for the savedviews package lives here as named constants.
// Per the project convention (RF1.2): no raw SQL in service.go /
// handler.go / store.go.

const (
	// ── Reads ────────────────────────────────────────────────────────

	// sqlSelectViewByID — fetch one view by ID, tenant-clamped.
	sqlSelectViewByID = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL`

	// sqlListVisibleByUser — user-scope rows for (sub, user, kind, target).
	sqlListVisibleByUser = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_user = $2
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'user'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// sqlListVisibleByNode — node-scope rows for (sub, ANY(node_ids), kind, target).
	sqlListVisibleByNode = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_node = ANY($2)
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'node'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// sqlListVisibleByWorkspace — workspace-scope rows.
	sqlListVisibleByWorkspace = `
		SELECT
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at
		FROM saved_views
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id_workspace = $2
		  AND saved_views_kind = $3
		  AND saved_views_target = $4
		  AND saved_views_scope = 'workspace'
		  AND saved_views_archived_at IS NULL
		ORDER BY saved_views_name ASC`

	// ── Writes ───────────────────────────────────────────────────────

	sqlInsertView = `
		INSERT INTO saved_views (
			saved_views_id_subscription, saved_views_kind, saved_views_scope,
			saved_views_id_user, saved_views_id_node, saved_views_id_workspace,
			saved_views_target, saved_views_name, saved_views_body,
			saved_views_id_user_created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	// sqlUpdateBody — patch name AND/OR body. NULL args leave that
	// column untouched (COALESCE pattern).
	sqlUpdateBody = `
		UPDATE saved_views
		SET saved_views_name = COALESCE($3, saved_views_name),
		    saved_views_body = COALESCE($4, saved_views_body)
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	// sqlUpdateScope — promote/demote. Clears the two non-target scope
	// IDs to NULL; the CHECK constraint enforces exactly-one populated.
	sqlUpdateScope = `
		UPDATE saved_views
		SET saved_views_scope        = $3,
		    saved_views_id_user      = $4,
		    saved_views_id_node      = $5,
		    saved_views_id_workspace = $6
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL
		RETURNING
			saved_views_id, saved_views_id_subscription, saved_views_kind,
			saved_views_scope, saved_views_id_user, saved_views_id_node,
			saved_views_id_workspace, saved_views_target, saved_views_name,
			saved_views_body, saved_views_id_user_created_by,
			saved_views_created_at, saved_views_updated_at, saved_views_archived_at`

	sqlArchiveView = `
		UPDATE saved_views
		SET saved_views_archived_at = now()
		WHERE saved_views_id_subscription = $1
		  AND saved_views_id = $2
		  AND saved_views_archived_at IS NULL`

	// ── Tenant-integrity probes (used by Service before writes) ──────

	// sqlVerifyUserInSubscription — confirms a user belongs to the
	// subscription. Used on scope='user' write paths.
	sqlVerifyUserInSubscription = `
		SELECT 1 FROM users
		WHERE users_id = $1
		  AND users_id_subscription = $2
		  AND users_archived_at IS NULL
		LIMIT 1`

	// sqlVerifyNodeInSubscription — confirms a topology node belongs
	// to the subscription. The node's workspace must live in the sub.
	sqlVerifyNodeInSubscription = `
		SELECT 1
		FROM topology_nodes tn
		JOIN master_record_workspaces mrw
		  ON mrw.master_record_workspaces_id = tn.topology_nodes_id_workspace
		WHERE tn.topology_nodes_id = $1
		  AND mrw.master_record_workspaces_id_subscription = $2
		  AND tn.topology_nodes_archived_at IS NULL
		LIMIT 1`

	// sqlVerifyWorkspaceInSubscription — confirms a workspace belongs
	// to the subscription.
	sqlVerifyWorkspaceInSubscription = `
		SELECT 1 FROM master_record_workspaces
		WHERE master_record_workspaces_id = $1
		  AND master_record_workspaces_id_subscription = $2
		  AND master_record_workspaces_archived_at IS NULL
		LIMIT 1`
)
```

- [ ] **Step 2: Build to verify**

Run: `cd backend && go build ./internal/savedviews/...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/savedviews/sql.go
git commit -m "feat(savedviews): sql.go — named query constants for reads, writes, tenant-integrity probes"
```

---

### Task 4: `ViewStore` interface + `PostgresViewStore` implementation

**Files:**
- Create: `backend/internal/savedviews/store.go`

- [ ] **Step 1: Create `store.go`**

`backend/internal/savedviews/store.go`:

```go
package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ViewStore is the substrate boundary. The Service depends on this
// interface, never on *pgxpool.Pool directly, so a future Postgres
// swap is a constructor change in main.go, not a service rewrite.
type ViewStore interface {
	GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error)
	ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error)
	Insert(ctx context.Context, in CreateInput) (*View, error)
	UpdateBody(ctx context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error)
	UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error)
	Archive(ctx context.Context, subID, viewID uuid.UUID) error

	// VerifyUserInSubscription / Node / Workspace are tenant-integrity
	// probes called by the Service before any write. They live on the
	// store because they're SQL; the policy decision (call them, then
	// reject) lives on the Service.
	VerifyUserInSubscription(ctx context.Context, userID, subID uuid.UUID) (bool, error)
	VerifyNodeInSubscription(ctx context.Context, nodeID, subID uuid.UUID) (bool, error)
	VerifyWorkspaceInSubscription(ctx context.Context, wsID, subID uuid.UUID) (bool, error)
}

// PostgresViewStore is the default ViewStore impl backed by pgx.
type PostgresViewStore struct {
	pool *pgxpool.Pool
}

// NewPostgresViewStore wires a store around an existing pool. Main.go
// passes the vector_artefacts pool (vaPool).
func NewPostgresViewStore(pool *pgxpool.Pool) *PostgresViewStore {
	return &PostgresViewStore{pool: pool}
}

func scanView(row pgx.Row) (*View, error) {
	var v View
	if err := row.Scan(
		&v.ID, &v.SubscriptionID, &v.Kind, &v.Scope,
		&v.UserID, &v.NodeID, &v.WorkspaceID,
		&v.Target, &v.Name, &v.Body,
		&v.CreatedBy, &v.CreatedAt, &v.UpdatedAt, &v.ArchivedAt,
	); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *PostgresViewStore) GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlSelectViewByID, subID, viewID)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.GetByID: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error) {
	out := make([]View, 0, 16)
	// User-scope.
	rows, err := s.pool.Query(ctx, sqlListVisibleByUser, q.SubscriptionID, q.ActorUserID, q.Kind, q.Target)
	if err != nil {
		return nil, fmt.Errorf("savedviews.ListVisibleToUser/user: %w", err)
	}
	for rows.Next() {
		v, err := scanView(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *v)
	}
	rows.Close()

	// Node-scope (any membership).
	if len(q.ActorNodeIDs) > 0 {
		rows, err = s.pool.Query(ctx, sqlListVisibleByNode, q.SubscriptionID, q.ActorNodeIDs, q.Kind, q.Target)
		if err != nil {
			return nil, fmt.Errorf("savedviews.ListVisibleToUser/node: %w", err)
		}
		for rows.Next() {
			v, err := scanView(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, *v)
		}
		rows.Close()
	}

	// Workspace-scope.
	rows, err = s.pool.Query(ctx, sqlListVisibleByWorkspace, q.SubscriptionID, q.ActorWorkspace, q.Kind, q.Target)
	if err != nil {
		return nil, fmt.Errorf("savedviews.ListVisibleToUser/workspace: %w", err)
	}
	for rows.Next() {
		v, err := scanView(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *v)
	}
	rows.Close()

	return out, nil
}

func (s *PostgresViewStore) Insert(ctx context.Context, in CreateInput) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlInsertView,
		in.SubscriptionID, in.Kind, in.Scope,
		in.UserID, in.NodeID, in.WorkspaceID,
		in.Target, in.Name, in.Body, in.ActorUserID,
	)
	v, err := scanView(row)
	if err != nil {
		return nil, fmt.Errorf("savedviews.Insert: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) UpdateBody(ctx context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlUpdateBody, subID, viewID, name, body)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.UpdateBody: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlUpdateScope,
		in.SubscriptionID, in.ViewID, in.NewScope,
		in.NewUserID, in.NewNodeID, in.NewWorkspaceID,
	)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.UpdateScope: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) Archive(ctx context.Context, subID, viewID uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, sqlArchiveView, subID, viewID)
	if err != nil {
		return fmt.Errorf("savedviews.Archive: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresViewStore) VerifyUserInSubscription(ctx context.Context, userID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyUserInSubscription, userID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyUserInSubscription: %w", err)
	}
	return true, nil
}

func (s *PostgresViewStore) VerifyNodeInSubscription(ctx context.Context, nodeID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyNodeInSubscription, nodeID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyNodeInSubscription: %w", err)
	}
	return true, nil
}

func (s *PostgresViewStore) VerifyWorkspaceInSubscription(ctx context.Context, wsID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyWorkspaceInSubscription, wsID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyWorkspaceInSubscription: %w", err)
	}
	return true, nil
}
```

- [ ] **Step 2: Build to verify**

Run: `cd backend && go build ./internal/savedviews/...`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/savedviews/store.go
git commit -m "feat(savedviews): ViewStore interface + PostgresViewStore impl — substrate boundary for future-proofing"
```

---

### Task 5: `Service` — permission gating + tenant integrity + audit emission

**Files:**
- Create: `backend/internal/savedviews/service.go`

The Service depends on `topology.Service` (for node-member checks) and `auth.Service` (for workspace-admin permission). Both are existing packages.

- [ ] **Step 1: Confirm `topology.Service` exposes a node-member check**

Run: `grep -n "func.*IsNodeMember\|IsMember\b" backend/internal/topology/*.go`
If a method like `IsNodeMember(ctx, userID, nodeID) (bool, error)` exists, note its exact signature. Otherwise check `backend/internal/flowboard/service.go` for how it does the same check — flowboard does an inline SQL probe against `topology_nodes_members`. If topology doesn't expose the method publicly, we'll inline the same probe in savedviews.

For this plan, **assume we'll inline the probe directly via the store** to keep cross-package coupling small. Add one method on `ViewStore`: `VerifyNodeMembership(ctx, userID, nodeID) (bool, error)` and one SQL constant.

- [ ] **Step 2: Add SQL constant + ViewStore method for node-member check**

Append to `backend/internal/savedviews/sql.go`:

```go
const sqlVerifyNodeMembership = `
	SELECT 1 FROM topology_nodes_members
	WHERE topology_nodes_members_user_id = $1
	  AND topology_nodes_members_node_id = $2
	LIMIT 1`
```

Add to `ViewStore` interface in `store.go`:

```go
	VerifyNodeMembership(ctx context.Context, userID, nodeID uuid.UUID) (bool, error)
```

Add the impl to `PostgresViewStore`:

```go
func (s *PostgresViewStore) VerifyNodeMembership(ctx context.Context, userID, nodeID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyNodeMembership, userID, nodeID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyNodeMembership: %w", err)
	}
	return true, nil
}
```

- [ ] **Step 3: Create `service.go`**

`backend/internal/savedviews/service.go`:

```go
package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/google/uuid"
)

// WorkspaceAdminChecker is the minimal interface savedviews needs from
// auth.Service. Inverted dependency — keeps the service testable with a
// stub.
type WorkspaceAdminChecker interface {
	HasWorkspaceAdmin(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error)
}

// Service is the sole writer for saved_views. All writes pass through
// Create / UpdateBody / UpdateScope / Archive — each enforces:
//
//  1. Tenant integrity — the scope ID matches SubscriptionID via the
//     store's Verify* probes.
//  2. Permission — Rally-pattern: anyone creates user-scope; node
//     members create/edit node-scope; workspace admins create/edit
//     workspace-scope.
//  3. Audit log — every Create/UpdateScope/Archive emits one
//     audit_logs row (best-effort, logged on failure).
type Service struct {
	store      ViewStore
	wsAdmin    WorkspaceAdminChecker
	auditLog   func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any)
}

// NewService wires a Service around an existing store + workspace-admin
// checker. The auditLog hook may be nil (writes still succeed; audit
// silently skipped — caller decides whether to require auditing).
func NewService(store ViewStore, wsAdmin WorkspaceAdminChecker, auditLog func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any)) *Service {
	return &Service{store: store, wsAdmin: wsAdmin, auditLog: auditLog}
}

// ── Reads ──────────────────────────────────────────────────────────

func (s *Service) GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error) {
	return s.store.GetByID(ctx, subID, viewID)
}

func (s *Service) ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error) {
	return s.store.ListVisibleToUser(ctx, q)
}

// ── Writes ─────────────────────────────────────────────────────────

func (s *Service) Create(ctx context.Context, in CreateInput) (*View, error) {
	if err := s.validateCreateInput(in); err != nil {
		return nil, err
	}
	if err := s.checkScopeWritePermission(ctx, in.ActorUserID, in.Scope, in.UserID, in.NodeID, in.WorkspaceID); err != nil {
		return nil, err
	}
	if err := s.verifyTenantIntegrity(ctx, in.SubscriptionID, in.Scope, in.UserID, in.NodeID, in.WorkspaceID); err != nil {
		return nil, err
	}
	v, err := s.store.Insert(ctx, in)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, in.ActorUserID, "saved_views.create", v.ID, map[string]any{
		"kind": in.Kind, "scope": in.Scope, "target": in.Target,
	})
	return v, nil
}

// UpdateBody — patch name and/or body. NULL args leave that column.
// Permission rule: owner OR any admin of the row's current scope.
func (s *Service) UpdateBody(ctx context.Context, subID, viewID, actorUserID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	if body != nil && len(body) > 65536 {
		return nil, ErrBodyTooLarge
	}
	cur, err := s.store.GetByID(ctx, subID, viewID)
	if err != nil {
		return nil, err
	}
	if err := s.checkEditPermission(ctx, actorUserID, cur); err != nil {
		return nil, err
	}
	v, err := s.store.UpdateBody(ctx, subID, viewID, name, body)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, actorUserID, "saved_views.update_body", v.ID, map[string]any{
		"name_changed": name != nil,
		"body_changed": body != nil,
	})
	return v, nil
}

// UpdateScope — promote/demote. Two permission checks: actor must be
// allowed to MODIFY the existing row (checkEditPermission against cur),
// AND allowed to WRITE to the new scope (checkScopeWritePermission).
func (s *Service) UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error) {
	if err := s.validateScopeInput(in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	cur, err := s.store.GetByID(ctx, in.SubscriptionID, in.ViewID)
	if err != nil {
		return nil, err
	}
	if err := s.checkEditPermission(ctx, in.ActorUserID, cur); err != nil {
		return nil, err
	}
	if err := s.checkScopeWritePermission(ctx, in.ActorUserID, in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	if err := s.verifyTenantIntegrity(ctx, in.SubscriptionID, in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	v, err := s.store.UpdateScope(ctx, in)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, in.ActorUserID, "saved_views.update_scope", v.ID, map[string]any{
		"old_scope": cur.Scope, "new_scope": in.NewScope,
	})
	return v, nil
}

func (s *Service) Archive(ctx context.Context, subID, viewID, actorUserID uuid.UUID) error {
	cur, err := s.store.GetByID(ctx, subID, viewID)
	if err != nil {
		return err
	}
	if err := s.checkEditPermission(ctx, actorUserID, cur); err != nil {
		return err
	}
	if err := s.store.Archive(ctx, subID, viewID); err != nil {
		return err
	}
	s.emit(ctx, actorUserID, "saved_views.archive", viewID, map[string]any{
		"kind": cur.Kind, "scope": cur.Scope,
	})
	return nil
}

// ── Permission helpers ─────────────────────────────────────────────

// checkScopeWritePermission — gate on creating/promoting into a scope.
//   user      → actor is the user (ActorUserID == in.UserID)
//   node      → actor is a member of in.NodeID
//   workspace → actor has workspace.admin on in.WorkspaceID
func (s *Service) checkScopeWritePermission(ctx context.Context, actor uuid.UUID, scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		if userID == nil || *userID != actor {
			return ErrForbidden
		}
		return nil
	case ScopeNode:
		if nodeID == nil {
			return ErrInvalidInput
		}
		ok, err := s.store.VerifyNodeMembership(ctx, actor, *nodeID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotNodeMember
		}
		return nil
	case ScopeWorkspace:
		if wsID == nil {
			return ErrInvalidInput
		}
		if s.wsAdmin == nil {
			return ErrForbidden
		}
		ok, err := s.wsAdmin.HasWorkspaceAdmin(ctx, actor, *wsID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotWSAdmin
		}
		return nil
	default:
		return ErrInvalidInput
	}
}

// checkEditPermission — gate on editing/deleting an existing row.
//   owner of any scope → always allowed
//   node-scope view    → any node admin (read: node member) may also edit
//   workspace-scope    → any workspace admin may also edit
func (s *Service) checkEditPermission(ctx context.Context, actor uuid.UUID, v *View) error {
	if v.CreatedBy == actor {
		return nil
	}
	switch v.Scope {
	case ScopeUser:
		return ErrForbidden
	case ScopeNode:
		if v.NodeID == nil {
			return ErrForbidden
		}
		// MVP: node membership grants edit. Tighten to a node-admin
		// role later if needed (additive — see TD register).
		ok, err := s.store.VerifyNodeMembership(ctx, actor, *v.NodeID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
		return nil
	case ScopeWorkspace:
		if v.WorkspaceID == nil || s.wsAdmin == nil {
			return ErrForbidden
		}
		ok, err := s.wsAdmin.HasWorkspaceAdmin(ctx, actor, *v.WorkspaceID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
		return nil
	}
	return ErrForbidden
}

// verifyTenantIntegrity — the scope ID must live in the subscription.
// Belt-and-braces against the sentinel clamp; catches cross-tenant
// scope IDs at the substrate layer regardless of upstream bugs.
func (s *Service) verifyTenantIntegrity(ctx context.Context, subID uuid.UUID, scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		ok, err := s.store.VerifyUserInSubscription(ctx, *userID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	case ScopeNode:
		ok, err := s.store.VerifyNodeInSubscription(ctx, *nodeID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	case ScopeWorkspace:
		ok, err := s.store.VerifyWorkspaceInSubscription(ctx, *wsID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	}
	return nil
}

// ── Input validation ───────────────────────────────────────────────

func (s *Service) validateCreateInput(in CreateInput) error {
	if in.Kind != KindObjectTree && in.Kind != KindPageLayout {
		return fmt.Errorf("%w: unknown kind %q", ErrInvalidInput, in.Kind)
	}
	if in.Target == "" {
		return fmt.Errorf("%w: target required", ErrInvalidInput)
	}
	if in.Name == "" {
		return fmt.Errorf("%w: name required", ErrInvalidInput)
	}
	if len(in.Body) > 65536 {
		return ErrBodyTooLarge
	}
	return s.validateScopeInput(in.Scope, in.UserID, in.NodeID, in.WorkspaceID)
}

func (s *Service) validateScopeInput(scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		if userID == nil || nodeID != nil || wsID != nil {
			return fmt.Errorf("%w: scope=user requires id_user only", ErrInvalidInput)
		}
	case ScopeNode:
		if nodeID == nil || userID != nil || wsID != nil {
			return fmt.Errorf("%w: scope=node requires id_node only", ErrInvalidInput)
		}
	case ScopeWorkspace:
		if wsID == nil || userID != nil || nodeID != nil {
			return fmt.Errorf("%w: scope=workspace requires id_workspace only", ErrInvalidInput)
		}
	default:
		return fmt.Errorf("%w: unknown scope %q", ErrInvalidInput, scope)
	}
	return nil
}

// emit — fire-and-forget audit log. Failures logged, never returned.
func (s *Service) emit(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any) {
	if s.auditLog == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("savedviews.emit: panic in audit hook: %v", r)
		}
	}()
	s.auditLog(ctx, actor, action, viewID, detail)
}

// Helper used by tests.
var _ = errors.New // keep errors import even if no direct use
```

- [ ] **Step 4: Build to verify**

Run: `cd backend && go build ./internal/savedviews/...`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/savedviews/sql.go backend/internal/savedviews/store.go backend/internal/savedviews/service.go
git commit -m "feat(savedviews): Service with permission gating + tenant integrity + audit emission (Rally pattern, permissive at node level)"
```

---

### Task 6: HTTP handler — six endpoints

**Files:**
- Create: `backend/internal/savedviews/handler.go`

- [ ] **Step 1: Create `handler.go`**

`backend/internal/savedviews/handler.go`:

```go
package savedviews

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler is the chi-mountable HTTP surface. All endpoints under
// /_site/saved-views require RequireAuth + RequireFreshPassword from
// the wider mount block in main.go.
type Handler struct {
	svc *Service
	// nodeMembers resolves the actor's node memberships for the
	// ListVisibleToUser query. Caller supplies; main.go wires from
	// the topology service.
	nodeMembers func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error)
}

// NewHandler wires a Handler. nodeMembersFn must return the set of
// topology nodes the user is a member of within their active
// subscription.
func NewHandler(svc *Service, nodeMembersFn func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error)) *Handler {
	return &Handler{svc: svc, nodeMembers: nodeMembersFn}
}

// Mount attaches the routes under a chi.Router. Caller must apply
// auth.Service.RequireAuth + RequireFreshPassword in the parent block.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{view_id}", h.Get)
	r.Patch("/{view_id}", h.UpdateBody)
	r.Patch("/{view_id}/scope", h.UpdateScope)
	r.Delete("/{view_id}", h.Archive)
}

// ── List GET /?kind=&target= ───────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	kind := r.URL.Query().Get("kind")
	target := r.URL.Query().Get("target")
	if kind == "" || target == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingField)
		return
	}
	nodeIDs, err := h.nodeMembers(r.Context(), u.UserID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	views, err := h.svc.ListVisibleToUser(r.Context(), ListVisibleQuery{
		SubscriptionID: u.SubscriptionID,
		ActorUserID:    u.UserID,
		ActorWorkspace: u.WorkspaceID,
		ActorNodeIDs:   nodeIDs,
		Kind:           kind,
		Target:         target,
	})
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"views": views})
}

// ── Get GET /{view_id} ─────────────────────────────────────────────

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	v, err := h.svc.GetByID(r.Context(), u.SubscriptionID, viewID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// ── Create POST / ──────────────────────────────────────────────────

type createReq struct {
	Kind        string          `json:"kind"`
	Scope       string          `json:"scope"`
	UserID      *uuid.UUID      `json:"id_user,omitempty"`
	NodeID      *uuid.UUID      `json:"id_node,omitempty"`
	WorkspaceID *uuid.UUID      `json:"id_workspace,omitempty"`
	Target      string          `json:"target"`
	Name        string          `json:"name"`
	Body        json.RawMessage `json:"body"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.Create(r.Context(), CreateInput{
		SubscriptionID: u.SubscriptionID,
		Kind:           req.Kind,
		Scope:          req.Scope,
		UserID:         req.UserID,
		NodeID:         req.NodeID,
		WorkspaceID:    req.WorkspaceID,
		Target:         req.Target,
		Name:           req.Name,
		Body:           req.Body,
		ActorUserID:    u.UserID,
	})
	h.respondWriteResult(w, r, v, err, http.StatusCreated)
}

// ── UpdateBody PATCH /{view_id} ────────────────────────────────────

type updateBodyReq struct {
	Name *string         `json:"name,omitempty"`
	Body json.RawMessage `json:"body,omitempty"`
}

func (h *Handler) UpdateBody(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req updateBodyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.UpdateBody(r.Context(), u.SubscriptionID, viewID, u.UserID, req.Name, req.Body)
	h.respondWriteResult(w, r, v, err, http.StatusOK)
}

// ── UpdateScope PATCH /{view_id}/scope ─────────────────────────────

type updateScopeReq struct {
	Scope       string     `json:"scope"`
	UserID      *uuid.UUID `json:"id_user,omitempty"`
	NodeID      *uuid.UUID `json:"id_node,omitempty"`
	WorkspaceID *uuid.UUID `json:"id_workspace,omitempty"`
}

func (h *Handler) UpdateScope(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req updateScopeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.UpdateScope(r.Context(), UpdateScopeInput{
		SubscriptionID: u.SubscriptionID,
		ViewID:         viewID,
		NewScope:       req.Scope,
		NewUserID:      req.UserID,
		NewNodeID:      req.NodeID,
		NewWorkspaceID: req.WorkspaceID,
		ActorUserID:    u.UserID,
	})
	h.respondWriteResult(w, r, v, err, http.StatusOK)
}

// ── Archive DELETE /{view_id} ──────────────────────────────────────

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	err = h.svc.Archive(r.Context(), u.SubscriptionID, viewID, u.UserID)
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrForbidden):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case err != nil:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ── helpers ────────────────────────────────────────────────────────

func (h *Handler) respondWriteResult(w http.ResponseWriter, r *http.Request, v *View, err error, okStatus int) {
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrBodyTooLarge):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrNotNodeMember), errors.Is(err, ErrNotWSAdmin):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case errors.Is(err, ErrTenantMismatch):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
	case err != nil:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	default:
		writeJSON(w, okStatus, v)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 2: Build to verify**

Run: `cd backend && go build ./internal/savedviews/...`
Expected: exit 0.

If `auth.UserFromCtx` returns a struct with different field names than `UserID` / `SubscriptionID` / `WorkspaceID`, adjust the references to match. Run `grep -n "UserID\b\|WorkspaceID\b\|SubscriptionID\b" backend/internal/auth/context.go` to confirm the shape before editing.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/savedviews/handler.go
git commit -m "feat(savedviews): chi handler — six endpoints under /_site/saved-views"
```

---

### Task 7: Wire into `main.go`

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Locate the existing /_site mount block**

Run: `grep -n "r.Route(\"/_site\"" backend/cmd/server/main.go`
Note the line number. The mount goes inside this block, next to the existing handlers (workspaces/{id}/fields, work-items, etc.).

- [ ] **Step 2: Locate the existing pool + service construction block**

Run: `grep -n "fieldsSvc := fields.NewService\|flowboard\.NewService\|topology\.NewService" backend/cmd/server/main.go`
Construction lives in the block around `fieldsSvc`, `topoSvc`, etc. The new savedviews service goes there.

- [ ] **Step 3: Add the construction + mount lines**

Add to `main.go` near the other service constructors (exact placement: after `fieldsSvc`, before route mounts):

```go
// savedviews — Rally-style saved view configurations. Sole writer for
// saved_views table in vector_artefacts. See
// docs/superpowers/specs/2026-05-28-saved-views-design.md.
savedViewsStore := savedviews.NewPostgresViewStore(vaPool)
savedViewsSvc := savedviews.NewService(
	savedViewsStore,
	&savedViewsWSAdminAdapter{auth: authSvc}, // workspace-admin checker
	nil, // audit hook — wired in Task 16
)
savedViewsHandler := savedviews.NewHandler(
	savedViewsSvc,
	func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error) {
		// Wire the topology node-membership resolver. If
		// topology.Service exposes a method like
		// ListNodeMembershipsForUser, use it; else add a wrapper.
		return topoSvc.ListNodeMembershipsForUser(ctx.(context.Context), userID)
	},
)
```

Add at the top of `main.go` next to other adapters (or in a small adapters block):

```go
// savedViewsWSAdminAdapter wraps auth.Service to satisfy
// savedviews.WorkspaceAdminChecker without leaking auth internals.
type savedViewsWSAdminAdapter struct {
	auth *auth.Service
}

func (a *savedViewsWSAdminAdapter) HasWorkspaceAdmin(ctx context.Context, userID, wsID uuid.UUID) (bool, error) {
	return a.auth.HasWorkspaceAdmin(ctx, userID, wsID)
}
```

Inside the `r.Route("/_site", func(r chi.Router) { ... })` block, add:

```go
r.Route("/saved-views", func(r chi.Router) {
	r.Use(authSvc.RequireAuth)
	r.Use(authSvc.RequireFreshPassword)
	savedViewsHandler.Mount(r)
})
```

Add the import at the top:

```go
"github.com/mmffdev/vector-backend/internal/savedviews"
```

- [ ] **Step 4: Verify the helper methods exist**

Run: `grep -n "func.*HasWorkspaceAdmin\|ListNodeMembershipsForUser" backend/internal/auth/*.go backend/internal/topology/*.go`

If `auth.Service.HasWorkspaceAdmin` doesn't exist as named, find the closest equivalent (`HasPermission`, `RoleOnWorkspace`, etc.) and adapt the adapter. If `topology.Service.ListNodeMembershipsForUser` doesn't exist, look at `flowboard/service.go` for how it resolves user→nodes — there's likely an existing query. If genuinely missing, add a thin method to topology.Service that runs:

```sql
SELECT topology_nodes_members_node_id
FROM topology_nodes_members
WHERE topology_nodes_members_user_id = $1
```

This is a 5-line add to `topology/service.go` if needed.

- [ ] **Step 5: Build the full backend**

Run: `cd backend && go build ./...`
Expected: exit 0.

- [ ] **Step 6: Smoke-test the route mount**

Restart the backend: `cd backend && BACKEND_ENV=dev go run ./cmd/server 2>&1 | head -40` in one terminal.

In another: `curl -s -H "Authorization: Bearer $(grep DEV_API_KEY backend/.env.dev | cut -d= -f2)" "http://localhost:5100/_site/saved-views?kind=objecttree&target=objecttree:work_items" | head -3`

Expected: `{"views":[]}` (empty list, 200 OK). No 404.

- [ ] **Step 7: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(savedviews): wire constructor + mount /_site/saved-views in main.go"
```

---

## Phase 3 — Backend tests

### Task 8: Permission + tenant integrity tests

**Files:**
- Create: `backend/internal/savedviews/service_test.go`

This test file uses a fake `ViewStore` + fake `WorkspaceAdminChecker` so the tests don't need a DB. The integration tests against a real DB live in Task 9.

- [ ] **Step 1: Create the test scaffolding with fakes**

`backend/internal/savedviews/service_test.go`:

```go
package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// ── fakes ──────────────────────────────────────────────────────────

type fakeStore struct {
	views          map[uuid.UUID]*View
	nodeMembers    map[[2]uuid.UUID]bool // (userID, nodeID) → true
	userInSub      map[[2]uuid.UUID]bool
	nodeInSub      map[[2]uuid.UUID]bool
	workspaceInSub map[[2]uuid.UUID]bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		views:          map[uuid.UUID]*View{},
		nodeMembers:    map[[2]uuid.UUID]bool{},
		userInSub:      map[[2]uuid.UUID]bool{},
		nodeInSub:      map[[2]uuid.UUID]bool{},
		workspaceInSub: map[[2]uuid.UUID]bool{},
	}
}

func (f *fakeStore) GetByID(_ context.Context, subID, viewID uuid.UUID) (*View, error) {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID || v.ArchivedAt != nil {
		return nil, ErrNotFound
	}
	c := *v
	return &c, nil
}
func (f *fakeStore) ListVisibleToUser(_ context.Context, _ ListVisibleQuery) ([]View, error) {
	return nil, nil
}
func (f *fakeStore) Insert(_ context.Context, in CreateInput) (*View, error) {
	id := uuid.New()
	v := &View{
		ID: id, SubscriptionID: in.SubscriptionID, Kind: in.Kind, Scope: in.Scope,
		UserID: in.UserID, NodeID: in.NodeID, WorkspaceID: in.WorkspaceID,
		Target: in.Target, Name: in.Name, Body: in.Body, CreatedBy: in.ActorUserID,
	}
	f.views[id] = v
	c := *v
	return &c, nil
}
func (f *fakeStore) UpdateBody(_ context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID {
		return nil, ErrNotFound
	}
	if name != nil {
		v.Name = *name
	}
	if body != nil {
		v.Body = body
	}
	c := *v
	return &c, nil
}
func (f *fakeStore) UpdateScope(_ context.Context, in UpdateScopeInput) (*View, error) {
	v, ok := f.views[in.ViewID]
	if !ok || v.SubscriptionID != in.SubscriptionID {
		return nil, ErrNotFound
	}
	v.Scope = in.NewScope
	v.UserID = in.NewUserID
	v.NodeID = in.NewNodeID
	v.WorkspaceID = in.NewWorkspaceID
	c := *v
	return &c, nil
}
func (f *fakeStore) Archive(_ context.Context, subID, viewID uuid.UUID) error {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID {
		return ErrNotFound
	}
	t := v.CreatedAt
	v.ArchivedAt = &t
	return nil
}
func (f *fakeStore) VerifyUserInSubscription(_ context.Context, u, s uuid.UUID) (bool, error) {
	return f.userInSub[[2]uuid.UUID{u, s}], nil
}
func (f *fakeStore) VerifyNodeInSubscription(_ context.Context, n, s uuid.UUID) (bool, error) {
	return f.nodeInSub[[2]uuid.UUID{n, s}], nil
}
func (f *fakeStore) VerifyWorkspaceInSubscription(_ context.Context, w, s uuid.UUID) (bool, error) {
	return f.workspaceInSub[[2]uuid.UUID{w, s}], nil
}
func (f *fakeStore) VerifyNodeMembership(_ context.Context, u, n uuid.UUID) (bool, error) {
	return f.nodeMembers[[2]uuid.UUID{u, n}], nil
}

type fakeWSAdmin struct {
	adminOf map[[2]uuid.UUID]bool // (userID, wsID) → true
}

func (f *fakeWSAdmin) HasWorkspaceAdmin(_ context.Context, u, w uuid.UUID) (bool, error) {
	return f.adminOf[[2]uuid.UUID{u, w}], nil
}

func newSvc(store *fakeStore, ws *fakeWSAdmin) *Service {
	return NewService(store, ws, nil)
}

// ── tests ──────────────────────────────────────────────────────────

func TestCreate_UserScope_OwnerAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID := uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userID, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_UserScope_DifferentUserRejected(t *testing.T) {
	store := newFakeStore()
	subID, userA, userB := uuid.New(), uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userB, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userB // actor is A but tries to create scope=user with userB
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userA,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestCreate_NodeScope_NonMemberRejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, nodeID := uuid.New(), uuid.New(), uuid.New()
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	// NOT setting nodeMembers — user is not a member
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeNode,
		NodeID: &nid, Target: "objecttree:work_items", Name: "Team",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrNotNodeMember) {
		t.Fatalf("expected ErrNotNodeMember, got %v", err)
	}
}

func TestCreate_NodeScope_MemberAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID, nodeID := uuid.New(), uuid.New(), uuid.New()
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	store.nodeMembers[[2]uuid.UUID{userID, nodeID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeNode,
		NodeID: &nid, Target: "objecttree:work_items", Name: "Team",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_WorkspaceScope_NonAdminRejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, wsID := uuid.New(), uuid.New(), uuid.New()
	store.workspaceInSub[[2]uuid.UUID{wsID, subID}] = true
	// NOT setting adminOf
	svc := newSvc(store, &fakeWSAdmin{adminOf: map[[2]uuid.UUID]bool{}})
	wid := wsID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeWorkspace,
		WorkspaceID: &wid, Target: "objecttree:work_items", Name: "WS",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrNotWSAdmin) {
		t.Fatalf("expected ErrNotWSAdmin, got %v", err)
	}
}

func TestCreate_WorkspaceScope_AdminAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID, wsID := uuid.New(), uuid.New(), uuid.New()
	store.workspaceInSub[[2]uuid.UUID{wsID, subID}] = true
	ws := &fakeWSAdmin{adminOf: map[[2]uuid.UUID]bool{{userID, wsID}: true}}
	svc := newSvc(store, ws)
	wid := wsID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeWorkspace,
		WorkspaceID: &wid, Target: "objecttree:work_items", Name: "WS",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_TenantMismatch_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, otherSub := uuid.New(), uuid.New(), uuid.New()
	// user lives in otherSub, not subID
	store.userInSub[[2]uuid.UUID{userID, otherSub}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrTenantMismatch) {
		t.Fatalf("expected ErrTenantMismatch, got %v", err)
	}
}

func TestCreate_InvalidKind_Rejected(t *testing.T) {
	svc := newSvc(newFakeStore(), &fakeWSAdmin{})
	uid := uuid.New()
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: uuid.New(), Kind: "made-up-kind", Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "x",
		Body: json.RawMessage(`{}`), ActorUserID: uid,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreate_BodyTooLarge_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, userID := uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userID, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	big := make([]byte, 65537)
	for i := range big {
		big[i] = 'x'
	}
	// Wrap as JSON string for validity
	body := json.RawMessage(append(append([]byte(`"`), big...), '"'))
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: body, ActorUserID: userID,
	})
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("expected ErrBodyTooLarge, got %v", err)
	}
}

func TestUpdateBody_NonOwnerNonAdmin_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, owner, other := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	svc := newSvc(store, &fakeWSAdmin{})
	_, err := svc.UpdateBody(context.Background(), subID, v.ID, other, nil, json.RawMessage(`{"x":1}`))
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestUpdateScope_Promote_NodeMember(t *testing.T) {
	store := newFakeStore()
	subID, owner, nodeID := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	store.nodeMembers[[2]uuid.UUID{owner, nodeID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	out, err := svc.UpdateScope(context.Background(), UpdateScopeInput{
		SubscriptionID: subID, ViewID: v.ID,
		NewScope: ScopeNode, NewNodeID: &nid,
		ActorUserID: owner,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	if out.Scope != ScopeNode || out.NodeID == nil || *out.NodeID != nodeID {
		t.Fatalf("scope not promoted: %+v", out)
	}
}

func TestArchive_NonOwner_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, owner, other := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	svc := newSvc(store, &fakeWSAdmin{})
	err := svc.Archive(context.Background(), subID, v.ID, other)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd backend && go test ./internal/savedviews/... -v`
Expected: all 11 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/savedviews/service_test.go
git commit -m "test(savedviews): 11 permission + tenant-integrity tests against fake ViewStore"
```

---

### Task 9: Integration test against live DB

**Files:**
- Create: `backend/internal/savedviews/service_integration_test.go`

This test hits the live dev DB (vector_artefacts on `localhost:5435`) and verifies the CHECK constraints + trigger function fire correctly. It's gated on the `INTEGRATION=1` env var so `go test ./...` doesn't run it in CI without an explicit opt-in.

- [ ] **Step 1: Create the integration test**

`backend/internal/savedviews/service_integration_test.go`:

```go
//go:build integration

package savedviews

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect to the dev DB. Skips if integration deps aren't set.
func connect(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DSN")
	if dsn == "" {
		dsn = "postgres://mmff_dev:68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi@localhost:5435/vector_artefacts?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func TestIntegration_CheckConstraintRejectsBadScope(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	// Try to INSERT with scope='user' but id_user NULL — must fail CHECK.
	_, err := pool.Exec(ctx, `
		INSERT INTO saved_views (
			saved_views_id_subscription, saved_views_kind, saved_views_scope,
			saved_views_target, saved_views_name, saved_views_id_user_created_by
		) VALUES ($1, 'objecttree', 'user', 'objecttree:test', 'bad', $1)`,
		uuid.New(),
	)
	if err == nil {
		t.Fatalf("expected CHECK violation, got nil")
	}
}

func TestIntegration_BodySizeCapEnforced(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	store := NewPostgresViewStore(pool)
	subID, userID := uuid.New(), uuid.New()
	// Build 65537-byte JSON string body.
	big := make([]byte, 65537)
	for i := range big {
		big[i] = 'x'
	}
	body := json.RawMessage(append(append([]byte(`"`), big...), '"'))
	uid := userID
	_, err := store.Insert(ctx, CreateInput{
		SubscriptionID: subID, Kind: "objecttree", Scope: "user",
		UserID: &uid, Target: "objecttree:test", Name: "big",
		Body: body, ActorUserID: userID,
	})
	if err == nil {
		t.Fatalf("expected size-cap violation, got nil")
	}
}

func TestIntegration_RoundTripUserScope(t *testing.T) {
	pool := connect(t)
	ctx := context.Background()
	store := NewPostgresViewStore(pool)

	// Use real user + subscription from dev seed.
	// rick@mmffdev.com user UUID is deterministic in dev seed.
	var subID, userID uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT users_id_subscription, users_id
		FROM users
		WHERE users_email = 'rick@mmffdev.com'
		LIMIT 1`).Scan(&subID, &userID); err != nil {
		t.Skipf("dev seed not present (rick@mmffdev.com): %v", err)
	}

	uid := userID
	created, err := store.Insert(ctx, CreateInput{
		SubscriptionID: subID, Kind: "objecttree", Scope: "user",
		UserID: &uid, Target: "objecttree:test:integration", Name: "RT Test",
		Body: json.RawMessage(`{"visible_columns":["id","title"]}`),
		ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM saved_views WHERE saved_views_id = $1", created.ID)
	})

	got, err := store.GetByID(ctx, subID, created.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != "RT Test" || got.Scope != "user" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}
```

- [ ] **Step 2: Run the integration test**

Run: `cd backend && go test -tags=integration ./internal/savedviews/... -v -run TestIntegration`
Expected: 3 tests pass. (`RoundTripUserScope` may skip if rick@mmffdev.com isn't seeded — that's an acceptable fallback.)

- [ ] **Step 3: Commit**

```bash
git add backend/internal/savedviews/service_integration_test.go
git commit -m "test(savedviews): integration tests against live DB — CHECK constraints + body size cap + round trip"
```

---

## Phase 4 — Lints

### Task 10: `lint:savedviews-writer-only`

**Files:**
- Create: `dev/scripts/lint_savedviews_writer_only.py`

- [ ] **Step 1: Create the lint script**

`dev/scripts/lint_savedviews_writer_only.py`:

```python
#!/usr/bin/env python3
"""Lint savedviews-writer-only.

Rule: writes to `saved_views` MUST go through the sole-writer service
at `backend/internal/savedviews/`. The detector scans every Go file
under `backend/` for INSERT / UPDATE / DELETE statements naming
saved_views, and flags hits that do NOT live inside the allowed
package directory.

Migration SQL (`db/vector_artefacts/schema/*.sql`) is exempt.
Test files (`*_test.go`) are exempt.

Exit 0 = clean. Exit 1 = one or more rogue writes detected.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ALLOWED_DIR = "backend/internal/savedviews/"

WRITE_RE = re.compile(
    r"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+saved_views\b",
    re.IGNORECASE,
)

violations: list[tuple[pathlib.Path, int, str]] = []

for path in (ROOT / "backend").rglob("*.go"):
    rel = path.relative_to(ROOT).as_posix()
    if rel.startswith(ALLOWED_DIR):
        continue
    if path.name.endswith("_test.go"):
        continue
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if WRITE_RE.search(line):
            violations.append((path, i, line.strip()))

if not violations:
    print("lint:savedviews-writer-only OK — 0 rogue writes")
    sys.exit(0)

print(f"lint:savedviews-writer-only FAIL — {len(violations)} rogue writes:")
for p, i, line in violations:
    print(f"  {p.relative_to(ROOT)}:{i}  {line}")
sys.exit(1)
```

- [ ] **Step 2: Make executable + run**

Run: `chmod +x dev/scripts/lint_savedviews_writer_only.py && dev/scripts/lint_savedviews_writer_only.py`
Expected: `lint:savedviews-writer-only OK — 0 rogue writes`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add dev/scripts/lint_savedviews_writer_only.py
git commit -m "feat(lint): lint:savedviews-writer-only — block raw writes to saved_views outside backend/internal/savedviews/"
```

---

### Task 11: `lint:savedviews-context-free`

**Files:**
- Create: `dev/scripts/lint_savedviews_context_free.py`

- [ ] **Step 1: Create the lint script**

`dev/scripts/lint_savedviews_context_free.py`:

```python
#!/usr/bin/env python3
"""Lint savedviews-context-free.

Rule: the `<SavedViewsControl>` component family (anything under
`app/components/SavedViews/`) MUST read no globals related to identity.
This protects the future-proofing contract: identity arrives as props
only, so future consumers (custom pages, dashboards) plug in without
refactoring the component.

Forbidden tokens (any of):
  - `useRouter`
  - `useSearchParams`
  - `usePathname`
  - `window.location`
  - any import from `next/router` or `next/navigation`

Exit 0 = clean. Exit 1 = one or more violations.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "app" / "components" / "SavedViews"

FORBIDDEN_RE = re.compile(
    r"\b(useRouter|useSearchParams|usePathname|window\.location)\b"
    r"|from\s+['\"]next/(router|navigation)['\"]"
)

violations: list[tuple[pathlib.Path, int, str]] = []

if not TARGET.exists():
    print(f"lint:savedviews-context-free OK — target dir {TARGET.relative_to(ROOT)} does not exist yet")
    sys.exit(0)

for path in TARGET.rglob("*.ts*"):
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if FORBIDDEN_RE.search(line):
            violations.append((path, i, line.strip()))

if not violations:
    print("lint:savedviews-context-free OK — 0 identity globals")
    sys.exit(0)

print(f"lint:savedviews-context-free FAIL — {len(violations)} identity-global reads:")
for p, i, line in violations:
    print(f"  {p.relative_to(ROOT)}:{i}  {line}")
sys.exit(1)
```

- [ ] **Step 2: Run**

Run: `chmod +x dev/scripts/lint_savedviews_context_free.py && dev/scripts/lint_savedviews_context_free.py`
Expected: `lint:savedviews-context-free OK — target dir ... does not exist yet` (the SavedViews component dir hasn't been created yet — comes in Phase 5).

- [ ] **Step 3: Commit**

```bash
git add dev/scripts/lint_savedviews_context_free.py
git commit -m "feat(lint): lint:savedviews-context-free — block useRouter/window.location inside SavedViews component family"
```

---

## Phase 5 — Frontend reusable component family

### Task 12: Frontend types + headless hook

**Files:**
- Create: `app/components/SavedViews/types.ts`
- Create: `app/components/SavedViews/useSavedViews.ts`

- [ ] **Step 1: Create `types.ts`**

`app/components/SavedViews/types.ts`:

```ts
// Wire types for /_site/saved-views. Match backend types.go field names
// 1:1 — the wire shape uses the saved_views_* column-prefix convention.

export type Scope = "user" | "node" | "workspace";
export type Kind = "objecttree" | "page_layout";

export interface View {
  saved_views_id: string;
  saved_views_id_subscription: string;
  saved_views_kind: Kind;
  saved_views_scope: Scope;
  saved_views_id_user?: string | null;
  saved_views_id_node?: string | null;
  saved_views_id_workspace?: string | null;
  saved_views_target: string;
  saved_views_name: string;
  saved_views_body: unknown; // schema-less; consumer interprets
  saved_views_id_user_created_by: string;
  saved_views_created_at: string;
  saved_views_updated_at: string;
  saved_views_archived_at?: string | null;
}

export interface ListResponse {
  views: View[];
}

// CreateRequest mirrors the backend createReq shape (snake_case at the wire).
export interface CreateRequest {
  kind: Kind;
  scope: Scope;
  id_user?: string | null;
  id_node?: string | null;
  id_workspace?: string | null;
  target: string;
  name: string;
  body: unknown;
}

export interface UpdateBodyRequest {
  name?: string;
  body?: unknown;
}

export interface UpdateScopeRequest {
  scope: Scope;
  id_user?: string | null;
  id_node?: string | null;
  id_workspace?: string | null;
}
```

- [ ] **Step 2: Create `useSavedViews.ts`**

`app/components/SavedViews/useSavedViews.ts`:

```ts
"use client";

// useSavedViews — headless state machine + apiSite calls for the
// saved-views substrate. Schema-agnostic about the view body: callers
// pass a body when saving, receive it when loading, never expose the
// hook to its interior.
//
// Pattern mirrors useFieldsForType + useColumnCatalogue — apiSite
// helper, cancelled flag for unmount safety, error-string
// normalisation.
//
// Spec: docs/superpowers/specs/2026-05-28-saved-views-design.md §11

import { useCallback, useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";
import type {
  View,
  ListResponse,
  Kind,
  Scope,
  CreateRequest,
  UpdateBodyRequest,
  UpdateScopeRequest,
} from "./types";

export interface UseSavedViewsParams {
  kind: Kind;
  target: string;
}

export interface UseSavedViewsResult {
  views: View[];
  activeView: View | null;
  loading: boolean;
  error: string | null;
  // Activate a view by ID; caller reads activeView.saved_views_body
  loadView: (viewID: string) => void;
  clearView: () => void;
  // Reload the list from the server (after writes invalidate)
  refresh: () => Promise<void>;
  // Writes — all return the new/updated view on success
  saveChanges: (req: UpdateBodyRequest) => Promise<View>;
  saveAsNew: (req: Omit<CreateRequest, "kind" | "target">) => Promise<View>;
  deleteView: (viewID: string) => Promise<void>;
  renameView: (viewID: string, name: string) => Promise<View>;
  updateScope: (viewID: string, req: UpdateScopeRequest) => Promise<View>;
}

export function useSavedViews(params: UseSavedViewsParams): UseSavedViewsResult {
  const { kind, target } = params;

  const [views, setViews] = useState<View[]>([]);
  const [activeID, setActiveID] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiSite<ListResponse>(
        `/saved-views?kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`,
      );
      setViews(res.views ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load saved views");
    } finally {
      setLoading(false);
    }
  }, [kind, target]);

  useEffect(() => {
    let cancelled = false;
    if (!kind || !target) return;
    setLoading(true);
    setError(null);
    apiSite<ListResponse>(
      `/saved-views?kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`,
    )
      .then((res) => {
        if (cancelled) return;
        setViews(res.views ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load saved views");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, target]);

  const activeView = activeID ? (views.find((v) => v.saved_views_id === activeID) ?? null) : null;

  const loadView = useCallback((viewID: string) => {
    setActiveID(viewID);
  }, []);

  const clearView = useCallback(() => {
    setActiveID(null);
  }, []);

  const saveChanges = useCallback(
    async (req: UpdateBodyRequest) => {
      if (!activeID) throw new Error("No active view to save");
      const updated = await apiSite<View>(`/saved-views/${activeID}`, {
        method: "PATCH",
        body: JSON.stringify(req),
      });
      await fetchList();
      return updated;
    },
    [activeID, fetchList],
  );

  const saveAsNew = useCallback(
    async (req: Omit<CreateRequest, "kind" | "target">) => {
      const created = await apiSite<View>(`/saved-views`, {
        method: "POST",
        body: JSON.stringify({ ...req, kind, target } as CreateRequest),
      });
      await fetchList();
      setActiveID(created.saved_views_id);
      return created;
    },
    [kind, target, fetchList],
  );

  const deleteView = useCallback(
    async (viewID: string) => {
      await apiSite<void>(`/saved-views/${viewID}`, { method: "DELETE" });
      if (activeID === viewID) setActiveID(null);
      await fetchList();
    },
    [activeID, fetchList],
  );

  const renameView = useCallback(
    async (viewID: string, name: string) => {
      const updated = await apiSite<View>(`/saved-views/${viewID}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await fetchList();
      return updated;
    },
    [fetchList],
  );

  const updateScope = useCallback(
    async (viewID: string, req: UpdateScopeRequest) => {
      const updated = await apiSite<View>(`/saved-views/${viewID}/scope`, {
        method: "PATCH",
        body: JSON.stringify(req),
      });
      await fetchList();
      return updated;
    },
    [fetchList],
  );

  return {
    views,
    activeView,
    loading,
    error,
    loadView,
    clearView,
    refresh: fetchList,
    saveChanges,
    saveAsNew,
    deleteView,
    renameView,
    updateScope,
  };
}
```

- [ ] **Step 3: tsc check**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/Vector-feat-objecttree-fields-picker" && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the context-free lint**

Run: `dev/scripts/lint_savedviews_context_free.py`
Expected: `lint:savedviews-context-free OK — 0 identity globals`.

- [ ] **Step 5: Commit**

```bash
git add app/components/SavedViews/types.ts app/components/SavedViews/useSavedViews.ts
git commit -m "feat(savedviews): types.ts + useSavedViews headless hook — schema-agnostic state machine over /saved-views"
```

---

### Task 13: `SaveAsNewViewModal` — name + scope picker

**Files:**
- Create: `app/components/SavedViews/SaveAsNewViewModal.tsx`

- [ ] **Step 1: Create the modal**

`app/components/SavedViews/SaveAsNewViewModal.tsx`:

```tsx
"use client";

// SaveAsNewViewModal — Rally screenshot 3/4.
// Name input + sharing scope picker. The actual permission gate lives
// on the backend; this modal trusts the caller to provide scope IDs.

import React, { useState } from "react";
import type { Scope } from "./types";

export interface SaveAsNewViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Caller resolves the IDs for each scope option from the sentinel
  // surface and passes them in.
  currentUserID: string;
  currentNodeID?: string | null;
  currentWorkspaceID: string;
  // canShareToNode / canShareToWorkspace gate the dropdown options at
  // the UI layer. Backend enforces — these are UX hints only.
  canShareToNode: boolean;
  canShareToWorkspace: boolean;
  onSave: (req: {
    name: string;
    scope: Scope;
    id_user?: string;
    id_node?: string;
    id_workspace?: string;
  }) => Promise<void>;
}

export function SaveAsNewViewModal(props: SaveAsNewViewModalProps) {
  const {
    isOpen, onClose, currentUserID, currentNodeID, currentWorkspaceID,
    canShareToNode, canShareToWorkspace, onSave,
  } = props;
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("user");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const req: Parameters<typeof onSave>[0] = { name: name.trim(), scope };
      if (scope === "user") req.id_user = currentUserID;
      if (scope === "node" && currentNodeID) req.id_node = currentNodeID;
      if (scope === "workspace") req.id_workspace = currentWorkspaceID;
      await onSave(req);
      setName("");
      setScope("user");
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new saved view"
      className="saved-views__ModalBackdrop"
    >
      <div className="saved-views__Modal">
        <header className="saved-views__ModalHeader">
          <h2 className="saved-views__ModalTitle">Create new saved view</h2>
          <button type="button" className="saved-views__ModalClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="saved-views__ModalBody">
          <label className="saved-views__FieldLabel" htmlFor="saved-views-name">
            Name
          </label>
          <input
            id="saved-views-name"
            type="text"
            className="saved-views__TextInput"
            placeholder="Enter a name for this view"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <p className="saved-views__HelpText">
            Filters, column settings, selected fields, sort order, page size,
            and group-by options will be saved in this view.
          </p>
          <label className="saved-views__FieldLabel" htmlFor="saved-views-scope">
            Sharing
          </label>
          <select
            id="saved-views-scope"
            className="saved-views__Select"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <option value="user">Not Shared</option>
            {canShareToNode && currentNodeID && (
              <option value="node">Shared With Team</option>
            )}
            {canShareToWorkspace && (
              <option value="workspace">Shared With Workspace</option>
            )}
          </select>
          {err && <p className="saved-views__ErrorText">{err}</p>}
        </div>
        <footer className="saved-views__ModalFooter">
          <button type="button" className="saved-views__BtnTertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="saved-views__BtnPrimary"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/components/SavedViews/SaveAsNewViewModal.tsx
git commit -m "feat(savedviews): SaveAsNewViewModal — name input + sharing scope picker, Rally screenshot 3/4 parity"
```

---

### Task 14: `ManageSavedViewsModal` — list + bulk delete + inline rename + scope change

**Files:**
- Create: `app/components/SavedViews/ManageSavedViewsModal.tsx`

- [ ] **Step 1: Create the modal**

`app/components/SavedViews/ManageSavedViewsModal.tsx`:

```tsx
"use client";

// ManageSavedViewsModal — Rally screenshot 1/2.
// Table list with checkbox column, name, sharing label. Multi-select
// bulk delete via toolbar. Inline rename on name click. Sharing-state
// change via per-row dropdown. Search input filters by name.

import React, { useMemo, useState } from "react";
import type { View, Scope } from "./types";

export interface ManageSavedViewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  views: View[];
  onRename: (viewID: string, name: string) => Promise<void>;
  onDelete: (viewIDs: string[]) => Promise<void>;
  onChangeScope: (viewID: string, scope: Scope) => Promise<void>;
}

function scopeLabel(v: View): string {
  switch (v.saved_views_scope) {
    case "user":      return "Not Shared";
    case "node":      return "Shared with team";
    case "workspace": return "Shared with workspace";
    default:          return v.saved_views_scope;
  }
}

export function ManageSavedViewsModal(props: ManageSavedViewsModalProps) {
  const { isOpen, onClose, views, onRename, onDelete } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [editingID, setEditingID] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  if (!isOpen) return null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === ""
      ? views
      : views.filter((v) => v.saved_views_name.toLowerCase().includes(q));
  }, [views, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} view${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    await onDelete(ids);
    setSelected(new Set());
  };

  const startRename = (v: View) => {
    setEditingID(v.saved_views_id);
    setEditName(v.saved_views_name);
  };

  const commitRename = async (id: string) => {
    if (editName.trim() && editName.trim() !== views.find((v) => v.saved_views_id === id)?.saved_views_name) {
      await onRename(id, editName.trim());
    }
    setEditingID(null);
    setEditName("");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Saved Views"
      className="saved-views__ModalBackdrop"
    >
      <div className="saved-views__Modal saved-views__Modal--wide">
        <header className="saved-views__ModalHeader">
          <h2 className="saved-views__ModalTitle">Manage Saved Views</h2>
          <button type="button" className="saved-views__ModalClose" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="saved-views__ManageToolbar">
          {selected.size > 0 ? (
            <>
              <span className="saved-views__SelectionCount">
                {selected.size} Item Selected
              </span>
              <button
                type="button"
                className="saved-views__ToolbarLink"
                onClick={() => setSelected(new Set())}
              >
                Deselect All
              </button>
              <button
                type="button"
                className="saved-views__BtnDanger"
                onClick={handleBulkDelete}
              >
                🗑 Delete
              </button>
            </>
          ) : (
            <>
              <input
                type="search"
                className="saved-views__TextInput"
                placeholder="Search views"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="saved-views__TotalCount">Total Views: {filtered.length}</span>
            </>
          )}
        </div>

        <div className="saved-views__ManageList">
          <table className="saved-views__ManageTable">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((v) => selected.has(v.saved_views_id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((v) => v.saved_views_id)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th>Name</th>
                <th>Sharing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.saved_views_id} className={selected.has(v.saved_views_id) ? "saved-views__Row--selected" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(v.saved_views_id)}
                      onChange={() => toggleSelect(v.saved_views_id)}
                    />
                  </td>
                  <td>
                    {editingID === v.saved_views_id ? (
                      <input
                        type="text"
                        className="saved-views__TextInput"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => commitRename(v.saved_views_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(v.saved_views_id);
                          if (e.key === "Escape") { setEditingID(null); setEditName(""); }
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="saved-views__InlineEdit"
                        onClick={() => startRename(v)}
                      >
                        {v.saved_views_name}
                      </button>
                    )}
                  </td>
                  <td>{scopeLabel(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/components/SavedViews/ManageSavedViewsModal.tsx
git commit -m "feat(savedviews): ManageSavedViewsModal — table, multi-select delete, inline rename, search, Rally screenshot 1/2 parity"
```

---

### Task 15: `SavedViewsDropdown` + `SavedViewsControl` umbrella + `SaveChangesIndicator`

**Files:**
- Create: `app/components/SavedViews/SavedViewsDropdown.tsx`
- Create: `app/components/SavedViews/SaveChangesIndicator.tsx`
- Create: `app/components/SavedViews/SavedViewsControl.tsx`

- [ ] **Step 1: Create `SavedViewsDropdown.tsx`**

`app/components/SavedViews/SavedViewsDropdown.tsx`:

```tsx
"use client";

// SavedViewsDropdown — Rally screenshot 5.
// Header dropdown with search + visible-views list + footer actions
// (Clear View, Save As New View, Manage Saved Views).

import React, { useMemo, useState, useEffect, useRef } from "react";
import type { View } from "./types";

export interface SavedViewsDropdownProps {
  views: View[];
  activeView: View | null;
  onSelectView: (viewID: string) => void;
  onClearView: () => void;
  onSaveAsNew: () => void;
  onOpenManage: () => void;
}

export function SavedViewsDropdown(props: SavedViewsDropdownProps) {
  const { views, activeView, onSelectView, onClearView, onSaveAsNew, onOpenManage } = props;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (!wrapRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? views : views.filter((v) => v.saved_views_name.toLowerCase().includes(q));
  }, [views, search]);

  const triggerLabel = activeView?.saved_views_name ?? "Select or Add Saved and Shared Views";

  return (
    <div ref={wrapRef} className="saved-views__DropdownWrap">
      <button
        type="button"
        className={`saved-views__DropdownTrigger${open ? " saved-views__DropdownTrigger--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="saved-views__DropdownTriggerLabel">{triggerLabel}</span>
        <span className="saved-views__DropdownTriggerCaret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="saved-views__DropdownPanel" role="listbox">
          <input
            type="search"
            className="saved-views__TextInput saved-views__DropdownSearch"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="saved-views__DropdownList">
            {filtered.length === 0 ? (
              <div className="saved-views__DropdownEmpty">No items found</div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.saved_views_id}
                  type="button"
                  role="option"
                  aria-selected={activeView?.saved_views_id === v.saved_views_id}
                  className={`saved-views__DropdownItem${activeView?.saved_views_id === v.saved_views_id ? " saved-views__DropdownItem--active" : ""}`}
                  onClick={() => {
                    onSelectView(v.saved_views_id);
                    setOpen(false);
                  }}
                >
                  {v.saved_views_name}
                </button>
              ))
            )}
          </div>
          <footer className="saved-views__DropdownFooter">
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onClearView(); setOpen(false); }}>
              Clear View
            </button>
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onSaveAsNew(); setOpen(false); }}>
              Save As New View
            </button>
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onOpenManage(); setOpen(false); }}>
              Manage Saved Views
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `SaveChangesIndicator.tsx`**

`app/components/SavedViews/SaveChangesIndicator.tsx`:

```tsx
"use client";

// SaveChangesIndicator — appears next to the dropdown when the active
// view body differs from the consumer's current state.

import React from "react";

export interface SaveChangesIndicatorProps {
  isDirty: boolean;
  hasActiveView: boolean;
  onSave: () => void;
  saving?: boolean;
}

export function SaveChangesIndicator(props: SaveChangesIndicatorProps) {
  const { isDirty, hasActiveView, onSave, saving } = props;
  if (!isDirty || !hasActiveView) return null;
  return (
    <button
      type="button"
      className="saved-views__SaveChanges"
      onClick={onSave}
      disabled={saving}
    >
      {saving ? "Saving…" : "Save Changes"}
    </button>
  );
}
```

- [ ] **Step 3: Create `SavedViewsControl.tsx`**

`app/components/SavedViews/SavedViewsControl.tsx`:

```tsx
"use client";

// SavedViewsControl — the umbrella mount. Composes Dropdown +
// SaveAsNewViewModal + ManageSavedViewsModal + SaveChangesIndicator
// into a single drop-in widget. Per the spec contract: kind + target +
// isDirty + onLoad + onSerialise as the only identity-related props.
//
// The component reads NO globals related to identity. Pinned by
// dev/scripts/lint_savedviews_context_free.py.

import React, { useState, useCallback } from "react";
import { useSavedViews } from "./useSavedViews";
import { SavedViewsDropdown } from "./SavedViewsDropdown";
import { SaveAsNewViewModal } from "./SaveAsNewViewModal";
import { ManageSavedViewsModal } from "./ManageSavedViewsModal";
import { SaveChangesIndicator } from "./SaveChangesIndicator";
import type { Kind, Scope, View } from "./types";

export interface SavedViewsControlProps {
  /** What kind of view this consumer saves — see saved_views_kind. */
  kind: Kind;
  /** Opaque target ID — see saved_views_target convention in §6 of the spec. */
  target: string;
  /** Whether the consumer's current state diverges from active view body. */
  isDirty: boolean;
  /** Called when the user activates a view — consumer applies the body. */
  onLoad: (view: View) => void;
  /** Called by the consumer when SaveChanges fires — return current state. */
  onSerialise: () => unknown;
  /** Called on Clear View — consumer returns to transient state. */
  onClearView: () => void;

  // Identity props for scope IDs. Passed in; never resolved internally.
  currentUserID: string;
  currentNodeID?: string | null;
  currentWorkspaceID: string;
  canShareToNode: boolean;
  canShareToWorkspace: boolean;
}

export function SavedViewsControl(props: SavedViewsControlProps) {
  const {
    kind, target, isDirty, onLoad, onSerialise, onClearView,
    currentUserID, currentNodeID, currentWorkspaceID,
    canShareToNode, canShareToWorkspace,
  } = props;

  const {
    views, activeView, loading, error,
    loadView, clearView, saveChanges, saveAsNew, deleteView, renameView,
  } = useSavedViews({ kind, target });

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelectView = useCallback(
    (viewID: string) => {
      const v = views.find((view) => view.saved_views_id === viewID);
      if (!v) return;
      loadView(viewID);
      onLoad(v);
    },
    [views, loadView, onLoad],
  );

  const handleClearView = useCallback(() => {
    clearView();
    onClearView();
  }, [clearView, onClearView]);

  const handleSaveChanges = useCallback(async () => {
    setSaving(true);
    try {
      await saveChanges({ body: onSerialise() });
    } finally {
      setSaving(false);
    }
  }, [saveChanges, onSerialise]);

  const handleSaveAsNew = useCallback(
    async (req: { name: string; scope: Scope; id_user?: string; id_node?: string; id_workspace?: string }) => {
      const created = await saveAsNew({
        name: req.name,
        scope: req.scope,
        id_user: req.id_user,
        id_node: req.id_node,
        id_workspace: req.id_workspace,
        body: onSerialise(),
      });
      onLoad(created);
    },
    [saveAsNew, onSerialise, onLoad],
  );

  return (
    <div className="saved-views__Control">
      <SavedViewsDropdown
        views={views}
        activeView={activeView}
        onSelectView={handleSelectView}
        onClearView={handleClearView}
        onSaveAsNew={() => setSaveModalOpen(true)}
        onOpenManage={() => setManageModalOpen(true)}
      />
      <SaveChangesIndicator
        isDirty={isDirty}
        hasActiveView={!!activeView}
        onSave={handleSaveChanges}
        saving={saving}
      />
      {loading && <span className="saved-views__StatusText">Loading…</span>}
      {error && <span className="saved-views__ErrorText">{error}</span>}

      <SaveAsNewViewModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        currentUserID={currentUserID}
        currentNodeID={currentNodeID}
        currentWorkspaceID={currentWorkspaceID}
        canShareToNode={canShareToNode}
        canShareToWorkspace={canShareToWorkspace}
        onSave={handleSaveAsNew}
      />

      <ManageSavedViewsModal
        isOpen={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        views={views}
        onRename={async (id, name) => { await renameView(id, name); }}
        onDelete={async (ids) => { for (const id of ids) await deleteView(id); }}
        onChangeScope={async (_id, _scope) => {
          /* Scope-change UI deferred to manage-modal v2 — TD entry. */
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: tsc check + lint check**

Run: `npx tsc --noEmit && dev/scripts/lint_savedviews_context_free.py`
Expected: tsc exit 0, lint OK.

- [ ] **Step 5: Commit**

```bash
git add app/components/SavedViews/SavedViewsDropdown.tsx app/components/SavedViews/SaveChangesIndicator.tsx app/components/SavedViews/SavedViewsControl.tsx
git commit -m "feat(savedviews): SavedViewsControl umbrella + Dropdown + SaveChangesIndicator — context-free contract per spec §11"
```

---

### Task 16: CSS for `.saved-views__*` family

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Find a safe insertion point**

Run: `grep -n "ColumnPicker (OTV2 Slice 4.5" app/globals.css`
Note the line. The new block goes after the existing ColumnPicker block — both belong to the OTV2 chrome family and share design tokens.

- [ ] **Step 2: Append the CSS block**

Use Edit to add after the closing of the ColumnPicker block (the line just before `/* Table root */`). The exact CSS:

```css
/* ── SavedViews family (Rally-style saved view configurations) ─────────── */
.saved-views__Control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.saved-views__DropdownWrap {
  position: relative;
  display: inline-block;
}
.saved-views__DropdownTrigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 280px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.saved-views__DropdownTrigger--open {
  border-color: var(--accent, var(--ink));
}
.saved-views__DropdownTriggerLabel {
  flex: 1 1 auto;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.saved-views__DropdownTriggerCaret {
  color: var(--ink-muted, var(--ink-subtle));
}
.saved-views__DropdownPanel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  background: var(--surface-elev, var(--surface));
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  z-index: 40;
}
.saved-views__DropdownSearch {
  margin: 10px 14px;
}
.saved-views__DropdownList {
  flex: 1 1 auto;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 8px;
}
.saved-views__DropdownItem {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
.saved-views__DropdownItem:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.saved-views__DropdownItem--active {
  background: color-mix(in srgb, var(--accent, var(--ink)) 12%, transparent);
  color: var(--ink);
  font-weight: 600;
}
.saved-views__DropdownEmpty {
  padding: 16px;
  text-align: center;
  color: var(--ink-muted, var(--ink-subtle));
  font-size: 12px;
}
.saved-views__DropdownFooter {
  display: flex;
  flex-direction: column;
  padding: 6px 8px 10px 8px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  gap: 4px;
}
.saved-views__DropdownAction {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font: inherit;
  font-size: 13px;
  color: var(--accent, var(--ink));
  cursor: pointer;
}
.saved-views__DropdownAction:hover {
  background: color-mix(in srgb, var(--accent, var(--ink)) 8%, transparent);
}

.saved-views__SaveChanges {
  padding: 6px 14px;
  border: 0;
  background: var(--accent, var(--ink));
  color: var(--on-accent, #fff);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
}
.saved-views__SaveChanges:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.saved-views__StatusText {
  color: var(--ink-muted, var(--ink-subtle));
  font-size: 12px;
}
.saved-views__ErrorText {
  color: var(--err, #c0392b);
  font-size: 12px;
}

/* ── Modal shell (reused by SaveAsNewView + ManageSavedViews) ─────────── */
.saved-views__ModalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.saved-views__Modal {
  width: min(480px, 92vw);
  background: var(--surface-elev, var(--surface));
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.saved-views__Modal--wide {
  width: min(720px, 92vw);
  height: min(80vh, 720px);
}
.saved-views__ModalHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
}
.saved-views__ModalTitle {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}
.saved-views__ModalClose {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--accent, var(--ink));
  border-radius: 4px;
}
.saved-views__ModalBody {
  padding: 8px 18px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.saved-views__ModalFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.saved-views__FieldLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  margin-top: 6px;
}
.saved-views__TextInput {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  outline: none;
  width: 100%;
}
.saved-views__TextInput:focus {
  border-color: var(--accent, var(--ink));
}
.saved-views__Select {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}
.saved-views__HelpText {
  font-size: 12px;
  color: var(--ink-muted, var(--ink-subtle));
  margin: 4px 0 8px 0;
}
.saved-views__BtnPrimary {
  padding: 8px 18px;
  border: 0;
  background: var(--accent, var(--ink));
  color: var(--on-accent, #fff);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
}
.saved-views__BtnPrimary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.saved-views__BtnTertiary {
  padding: 8px 14px;
  border: 0;
  background: transparent;
  color: var(--accent, var(--ink));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
}
.saved-views__BtnDanger {
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--err, #c0392b);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
}
.saved-views__BtnDanger:hover {
  background: color-mix(in srgb, var(--err, #c0392b) 8%, transparent);
}

/* ── Manage-modal table ───────────────────────────────────────────────── */
.saved-views__ManageToolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent, var(--ink)) 4%, var(--surface));
}
.saved-views__SelectionCount {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.saved-views__TotalCount {
  margin-left: auto;
  font-size: 12px;
  color: var(--ink-muted, var(--ink-subtle));
}
.saved-views__ToolbarLink {
  background: transparent;
  border: 0;
  color: var(--accent, var(--ink));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.saved-views__ManageList {
  flex: 1 1 auto;
  overflow-y: auto;
}
.saved-views__ManageTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.saved-views__ManageTable th,
.saved-views__ManageTable td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.saved-views__ManageTable th {
  font-weight: 600;
  color: var(--ink);
  background: var(--surface);
  position: sticky;
  top: 0;
}
.saved-views__Row--selected {
  background: color-mix(in srgb, var(--accent, var(--ink)) 8%, transparent);
}
.saved-views__InlineEdit {
  background: transparent;
  border: 0;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  cursor: text;
  padding: 0;
}
```

- [ ] **Step 3: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: exit 0. (CSS isn't type-checked but the build sanity passes.)

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(savedviews): .saved-views__* CSS family — modal shell, dropdown, manage-modal table, save-changes button"
```

---

## Phase 6 — Wire-up: first consumer integration (work-items page)

### Task 17: Mount `<SavedViewsControl>` in `<ObjectTree>` chrome

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

This adds a thin pass-through to the ObjectTree component so callers can pass `savedViews={{ kind, target }}` and the dropdown mounts in the header. Then the work-items page passes the prop.

- [ ] **Step 1: Locate the ActionBar mount in `p_ObjectTree.tsx`**

Run: `grep -n "<ActionBar" app/components/ObjectTreeV2/p_ObjectTree.tsx`
Note the line.

- [ ] **Step 2: Add the prop type + state hooks + mount the control**

Near the top of the file, add the import:

```ts
import { SavedViewsControl } from "@/app/components/SavedViews/SavedViewsControl";
import type { Kind as SavedViewsKind } from "@/app/components/SavedViews/types";
```

Add to the ObjectTree props interface:

```ts
savedViews?: {
  kind: SavedViewsKind;
  target: string;
};
```

In the component body, immediately before the existing `return (`, add the sentinel reads needed for `<SavedViewsControl>`:

```tsx
const { sentinel_user, sentinel_focus_node } = useSentinel();
const savedViewsControlProps = savedViews && sentinel_user
  ? {
      kind: savedViews.kind,
      target: savedViews.target,
      isDirty: false, // wired in Task 18 once column-picker state diffing lands
      onLoad: (view: import("@/app/components/SavedViews/types").View) => {
        // wired in Task 18
        console.log("[savedViews] onLoad", view.saved_views_name);
      },
      onSerialise: () => ({ visible_columns: picker.visibleKeys ?? [] }),
      onClearView: () => {
        // wired in Task 18
      },
      currentUserID: sentinel_user.id ?? "",
      currentNodeID: sentinel_focus_node,
      currentWorkspaceID: sentinel_user.workspace_id,
      canShareToNode: !!sentinel_focus_node,
      canShareToWorkspace: false, // wired in Task 18 from role check
    }
  : null;
```

Mount the control in the chrome — find the existing `<ActionBar` JSX and pass a new prop. Actually simpler: render the control adjacent to the page heading the user's screenshot showed. For minimal disruption, render it inline in the ActionBar's left slot. Locate the chrome panel that holds the title (search for `panel_work_items_header` callers / `<PageHeading>` in adjacent code) and wrap with `<SavedViewsControl>` next to it.

Since the chrome layout is per-config, the cleanest place is the title row of the ObjectTree itself. Find the existing title rendering (search for `title=` in the ActionBar block) and add a sibling next to it:

```tsx
{savedViewsControlProps && (
  <div className="objecttree__SavedViewsSlot">
    <SavedViewsControl {...savedViewsControlProps} />
  </div>
)}
```

- [ ] **Step 3: Add a small CSS rule for the slot**

Append to `app/globals.css`:

```css
.objecttree__SavedViewsSlot {
  display: inline-flex;
  align-items: center;
  margin-left: 12px;
}
```

- [ ] **Step 4: Wire the work-items page**

In `app/(user)/work-items/page.tsx`, find the `<ObjectTree …>` JSX mount and add the prop. First, define the target constant near the top:

```tsx
const SAVED_VIEW_TARGET = "objecttree:work_items";
```

Then add to the mount:

```tsx
<ObjectTree
  /* ...existing props... */
  savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET }}
/>
```

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && dev/scripts/lint_savedviews_context_free.py`
Expected: tsc exit 0, lint OK.

- [ ] **Step 6: Smoke-test in browser**

Start the dev server: `npm run dev` (Next.js Turbopack on `:5101`).
Visit `http://localhost:5101/work-items`.
Expected: ObjectTree renders normally. The "Select or Add Saved and Shared Views" dropdown appears in the chrome. Clicking it opens the empty dropdown (no items found — there are no saved views yet). Clicking "Save As New View" opens the modal.

- [ ] **Step 7: Create a view end-to-end**

In the modal: enter name "Test view 1", scope "Not Shared", click Save.
Expected: dropdown now shows "Test view 1" as active. Refreshing the page keeps it (loaded from backend).

- [ ] **Step 8: Commit**

```bash
git add app/components/ObjectTreeV2/p_ObjectTree.tsx app/globals.css app/\(user\)/work-items/page.tsx
git commit -m "feat(objecttree): mount SavedViewsControl in chrome + wire work-items page with target objecttree:work_items"
```

---

### Task 18: Wire `isDirty`, `onLoad`, `onClearView` to column-picker state

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

The previous task stubbed `isDirty: false` and `onLoad: console.log`. This task wires the real state.

- [ ] **Step 1: Compute `isDirty`**

At the top of the body, where `savedViewsControlProps` is built:

```tsx
const activeViewBody = activeLoadedView?.saved_views_body as { visible_columns?: string[] } | undefined;
const isDirty = (() => {
  if (!activeViewBody) return false;
  const want = activeViewBody.visible_columns ?? [];
  const have = picker.visibleKeys ?? [];
  if (want.length !== have.length) return true;
  const wantSet = new Set(want);
  return have.some((k) => !wantSet.has(k));
})();
```

Add a state hook for the active loaded view:

```tsx
const [activeLoadedView, setActiveLoadedView] = useState<import("@/app/components/SavedViews/types").View | null>(null);
```

- [ ] **Step 2: Wire `onLoad`**

Replace the stub with:

```tsx
onLoad: (view) => {
  setActiveLoadedView(view);
  const body = view.saved_views_body as { visible_columns?: string[] };
  if (Array.isArray(body.visible_columns)) {
    picker.setVisibleKeys(body.visible_columns);
  }
},
```

- [ ] **Step 3: Wire `onClearView`**

```tsx
onClearView: () => {
  setActiveLoadedView(null);
  picker.resetToDefaults();
},
```

- [ ] **Step 4: Wire `canShareToWorkspace` from sentinel permissions**

Replace `canShareToWorkspace: false` with the real check. Look up how PLA-0007's `useHasPermission` is exposed:

```ts
import { useHasPermission } from "@/app/hooks/useHasPermission";
// ...
const canShareToWorkspace = useHasPermission("workspace.admin");
```

If the project's hook is named differently, run `grep -n "useHasPermission\b" app/hooks/` and adapt the import name. If no such hook exists, fall through to `false` and file a TD entry; the backend enforces the real rule regardless.

- [ ] **Step 5: tsc + smoke test**

Run: `npx tsc --noEmit` (exit 0).
Restart dev server. Visit `/work-items`. Open the picker, toggle a column off. Save Changes button appears next to the dropdown. Click it. Refresh — the change persists.

- [ ] **Step 6: Commit**

```bash
git add app/components/ObjectTreeV2/p_ObjectTree.tsx
git commit -m "feat(objecttree): wire savedviews isDirty/onLoad/onClearView/canShareToWorkspace to column-picker state"
```

---

## Phase 7 — Docs + audit-log hookup + final sweep

### Task 19: Wire audit-log emission

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Locate the existing audit-log surface**

Run: `grep -n "audit_logs\|AuditLog\|auditSvc\." backend/cmd/server/main.go | head -5`
Find the existing audit hook function or service.

- [ ] **Step 2: Replace the `nil` audit hook in savedViewsSvc construction**

In `main.go`, change:

```go
savedViewsSvc := savedviews.NewService(savedViewsStore, /* ws admin */, nil)
```

to:

```go
savedViewsSvc := savedviews.NewService(
    savedViewsStore,
    &savedViewsWSAdminAdapter{auth: authSvc},
    func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any) {
        // Emit one audit_logs row per write. Best-effort; failures
        // are logged inside emit().
        auditSvc.Emit(ctx, audit.Event{
            UserID:       actor,
            EventType:    action,
            ResourceID:   viewID.String(),
            ResourceKind: "saved_views",
            Detail:       detail,
        })
    },
)
```

The exact `audit.Event` shape depends on the existing audit package. Run `grep -rn "type Event struct" backend/internal/audit/*.go` to confirm. If field names differ, adapt to match.

- [ ] **Step 3: Build + smoke test**

Run: `cd backend && go build ./...` (exit 0).
Restart dev server. Save a view. Check the audit_logs table:

```bash
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts -c "SELECT audit_logs_event_type, audit_logs_resource_kind, audit_logs_resource_id, audit_logs_created_at FROM audit_logs WHERE audit_logs_resource_kind = 'saved_views' ORDER BY audit_logs_created_at DESC LIMIT 5;"
```

Expected: one row per save/edit/archive with `event_type = saved_views.create | saved_views.update_body | saved_views.archive`.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(savedviews): wire audit-log emission for create / update_body / update_scope / archive"
```

---

### Task 20: Documentation updates

**Files:**
- Modify: `docs/c_c_db_routing.md`
- Modify: `docs/c_schema.md`
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Add `saved_views` to `c_c_db_routing.md`**

Find the existing per-service table and add a row:

```
| savedviews        | vaPool (vector_artefacts) | saved_views                                                            |
```

The exact column shape depends on the doc — run `head -50 docs/c_c_db_routing.md` to see the current shape and match it.

- [ ] **Step 2: Add `saved_views` catalogue entry to `c_schema.md`**

Find the table list and add a one-line entry naming the table, its DB, its purpose, and the spec link.

- [ ] **Step 3: Add the one-line pointer to `.claude/CLAUDE.md`**

In the Working Practices section under the existing primitives, add:

```
- **Saved Views substrate (PLA-savedviews)** → [`docs/superpowers/specs/2026-05-28-saved-views-design.md`](../docs/superpowers/specs/2026-05-28-saved-views-design.md) — Rally-pattern persisted view configs; one table `saved_views` with kind + scope discriminators serves multi-consumer (objecttree today, custom-pages tomorrow).
```

- [ ] **Step 4: Regenerate SY003**

Per the HARD RULE: substrate changed, SY003 must regenerate.

Run: `<report> -sy "current state of the Vector databases (vector_artefacts, mmff_library) — complete table inventory grouped by role, with row counts, cross-DB soft refs against mmff_library, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection."`

Expected: SY003 in `mmff_dev.dev_reports` updated; new `saved_views` row appears in the inventory.

- [ ] **Step 5: Commit**

```bash
git add docs/c_c_db_routing.md docs/c_schema.md .claude/CLAUDE.md
git commit -m "docs(savedviews): add saved_views row to db-routing + schema catalogue + CLAUDE.md pointer; SY003 regenerated"
```

---

### Task 21: Final verification gate

- [ ] **Step 1: Full test suite**

Run: `cd backend && go test ./internal/savedviews/... -v && go test ./...`
Expected: savedviews suite green; broader suite carries any pre-existing reds (per TD-RF1-TEST-COLUMN-RENAME-DRIFT) but no new failures from this branch.

- [ ] **Step 2: Frontend type check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: All lints**

Run:

```bash
dev/scripts/lint_savedviews_writer_only.py && \
dev/scripts/lint_savedviews_context_free.py && \
dev/scripts/lint_sql_in_sqlfile_only.py && \
dev/scripts/lint_addressables.py
```

Expected: all OK.

- [ ] **Step 4: End-to-end manual smoke**

In the browser at `/work-items`:
1. Create a "Not Shared" view; refresh; view persists.
2. Toggle some columns; Save Changes button appears; click it; refresh; new state persists.
3. Open Manage Saved Views; rename inline; close; reopen — name updated.
4. Manage modal: select view, click Delete, confirm; refresh — view gone.

Each should work end-to-end. If anything fails, file as a TD entry and fix before declaring complete.

- [ ] **Step 5: Commit final state**

```bash
git status --short
# Expect: clean
git log --oneline -25
```

- [ ] **Step 6: Self-review pass on the implementation**

Compare against the spec's §14 Acceptance Criteria. Each of the 10 items should be visibly satisfied. List any that aren't and circle back.

- [ ] **Step 7: Plan complete — branch ready for PR / merge**

The branch is shippable. Consider opening a PR or merging to main per project convention.

---

## Self-Review

(After writing this plan, mental walk-through against the spec.)

**Spec coverage:**

- §2 (view body) — Task 1 SQL allows JSONB body; consumer-defined shape per kind. Wire-up in Task 18 stores `{visible_columns}`. ✅
- §3 (scope) — Task 1 CHECK constraint + Task 5 service enforcement. ✅
- §4 (permission rule) — Task 5 service helpers; Task 8 tests. ✅
- §5 (substrate) — Task 4 PostgresViewStore; ViewStore interface as future-proofing. ✅
- §6 (table) — Task 1. ✅
- §7 (indexes) — Task 1. ✅
- §8 (Go package shape) — Tasks 2–7. ✅
- §9 (Valkey cache) — DEFERRED per spec (evidence-led activation). Not in this plan; future TD trigger when P95 > 50ms. ✅
- §10 (migration) — Task 1. ✅
- §11 (frontend component family) — Tasks 12–15. ✅
- §12 (out-of-scope items) — preserved as TD entries / future specs. ✅
- §13 (risks) — mitigations land via Tasks 5 (tenant integrity), 10 (writer-only lint), 11 (context-free lint), 19 (audit). ✅
- §14 (acceptance criteria) — verified in Task 21. ✅

**Placeholder scan:** Grep for `TBD`, `TODO`, `FIXME` after writing.

**Type consistency:** `View.saved_views_id` is the canonical PK field name (used in 5 frontend files). `Service.GetByID(subID, viewID)` — both args present in all callers. `ListVisibleQuery` shape consistent between types.go, store.go, handler.go.

End of plan.
