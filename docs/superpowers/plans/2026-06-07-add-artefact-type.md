# Add Artefact Type (+ insert strategic layer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace admin create a new artefact type — a work type (sibling at the execution level) or a strategic layer inserted between two existing portfolio layers, with a pass-through instance backfill behind a confirmation gate.

**Architecture:** `parent_type_id` chain is the hierarchy source of truth; `layer_depth` is demoted to a derived mirror. The strategy parent column is renamed to a scoped name (`artefacts_types_strategy_parent_id`, FK preserved) and a new `artefacts_types_execution_parent_slots TEXT[]` replaces the hard-coded `PARENT_PREFIX_MAP`. Three new backend endpoints (`POST /artefact-types`, `/insert-layer/preview`, `/insert-layer`) gated by `portfolio.model.edit`. A new `ArtefactTypeCreateFlyout` drives the UI.

**Tech Stack:** Go (chi, pgx) backend against `vector_artefacts`; Next.js / React / TypeScript frontend; Vitest + Go `testing`; file-based SQL migrations.

**Spec:** `docs/superpowers/specs/2026-06-07-add-artefact-type-design.md`

---

## Pre-flight facts (verified 2026-06-07)

- Next migration number: **181** (highest is 180). Migrations live in `db/vector_artefacts/schema/NNN_*.sql` + `down/NNN_*_DOWN.sql`.
- Apply: `go run ./backend/cmd/migrate -db vector_artefacts -env backend/.env.dev` (dry-run with `-dry-run`).
- `artefacts_types` parent column today: `artefacts_types_id_parent_type` (UUID self-FK, `ON DELETE RESTRICT`). Renaming to `artefacts_types_strategy_parent_id`.
- `artefacts` instance table: PK `artefacts_id`; parent `artefacts_id_parent`; type `artefacts_id_artefact_type`; clamp `artefacts_id_workspace`; soft-delete `artefacts_archived_at`; display number `artefacts_number`; title `artefacts_title`; subscription `artefacts_id_subscription`.
- `PARENT_PREFIX_MAP` defined in `app/components/ArtefactInlineForm/types.ts:119`. **Three** consumers (not two): `useParentCandidates.ts`, `ObjectTreeV2/configs/workItemsReparentRules.ts`, **and legacy `app/components/ObjectTree/p_ObjectTree.tsx`**.
- Permission middleware: `authSvc.RequirePermission`-style is via `permissions.Resolver`; pattern `res.PermissionsFor(ctx, userID)` returns a set keyed by `permissions.Code`. `permissions.PortfolioModelEdit = "portfolio.model.edit"` exists in `backend/internal/permissions/catalogue.go`.
- artefact-types handler has an explicit `Mount(r chi.Router)` (`handler.go:22`) with `r.Get("/")` + `r.Patch("/{id}")`. We add POST routes here.
- sentinel: `sentinel.WorkspaceIDFromCtx(ctx) (uuid.UUID, bool)`; `sentinel.FromCtx(ctx) Clamp` (has `.WorkspaceID`, `.UserID`, `.RoleID`).

---

## Phase 0 — Migration: rename strategy column + add execution column

### Task 0.1: Write the migration (rename + add + backfill)

**Files:**
- Create: `db/vector_artefacts/schema/181_artefact_types_parent_columns.sql`
- Create: `db/vector_artefacts/schema/down/181_artefact_types_parent_columns_DOWN.sql`

- [ ] **Step 1: Write the UP migration**

Create `db/vector_artefacts/schema/181_artefact_types_parent_columns.sql`:

```sql
-- ============================================================
-- Migration 181: scoped parent-link columns on artefacts_types
--
-- WHY: the parent-nesting rule is split across an awkwardly-named DB column
-- (artefacts_types_id_parent_type — named for mechanism, not meaning) and a
-- hard-coded frontend constant (PARENT_PREFIX_MAP). This migration makes the
-- two parallel + scope-declaring:
--   strategy ladder  -> artefacts_types_strategy_parent_id      (rename; FK kept)
--   execution rule   -> artefacts_types_execution_parent_slots  (new TEXT[])
-- Spec: docs/superpowers/specs/2026-06-07-add-artefact-type-design.md §5.
--
-- The rename is behaviour-neutral (FK + ON DELETE RESTRICT retained). The new
-- column is backfilled from PARENT_PREFIX_MAP translated prefix->slot so the
-- resolver's behaviour is byte-for-byte unchanged for system work types.
--
-- IDEMPOTENCY: guarded with IF EXISTS / IF NOT EXISTS so a re-run is safe.
-- ROLLBACK: db/vector_artefacts/schema/down/181_artefact_types_parent_columns_DOWN.sql
-- ============================================================

BEGIN;

-- 1. Rename the strategy parent self-FK column (FK + constraint carry over).
ALTER TABLE artefacts_types
    RENAME COLUMN artefacts_types_id_parent_type TO artefacts_types_strategy_parent_id;

-- 2. Rename the supporting partial index to match (created in migration 003/066).
ALTER INDEX IF EXISTS artefacts_types_parent
    RENAME TO artefacts_types_strategy_parent;

-- 3. Add the execution-scope allowed-parent slots column.
ALTER TABLE artefacts_types
    ADD COLUMN IF NOT EXISTS artefacts_types_execution_parent_slots TEXT[];

COMMENT ON COLUMN artefacts_types.artefacts_types_strategy_parent_id IS
    'Strategy ladder parent type (self-FK). One parent per strategy type. NULL for work types and the top-of-ladder strategy type.';
COMMENT ON COLUMN artefacts_types.artefacts_types_execution_parent_slots IS
    'Work-scope allowed-parent rule: list of parent type SLOTS (wrk_story, wrk_epic, ...) this work type may nest under. NULL/empty for strategy types. Soft refs, app-validated.';

-- 4. Backfill execution_parent_slots from the retired PARENT_PREFIX_MAP,
--    translated prefix->slot. Keyed by the canonical work slots so a gadmin
--    rename of a type's name/prefix cannot break the rule.
--    Feature is a strategy type; resolve its slot if present, else fall back
--    to prefix 'FE' (documented fallback — TD-RISK-WORK-PARENT-SLOTS sibling).
WITH feature_slot AS (
    SELECT COALESCE(
        (SELECT artefacts_types_slot FROM artefacts_types
          WHERE artefacts_types_scope = 'strategy'
            AND artefacts_types_prefix = 'FE'
            AND artefacts_types_archived_at IS NULL
          LIMIT 1),
        'FE'
    ) AS slot
)
UPDATE artefacts_types t SET artefacts_types_execution_parent_slots =
    CASE t.artefacts_types_slot
        WHEN 'wrk_task'   THEN ARRAY['wrk_defect','wrk_story']
        WHEN 'wrk_story'  THEN ARRAY[(SELECT slot FROM feature_slot),'wrk_epic']
        WHEN 'wrk_defect' THEN ARRAY['wrk_epic','wrk_story']
        WHEN 'wrk_epic'   THEN ARRAY[(SELECT slot FROM feature_slot)]
        ELSE t.artefacts_types_execution_parent_slots
    END
WHERE t.artefacts_types_scope = 'work'
  AND t.artefacts_types_slot IN ('wrk_task','wrk_story','wrk_defect','wrk_epic');

COMMIT;
```

- [ ] **Step 2: Write the DOWN migration**

Create `db/vector_artefacts/schema/down/181_artefact_types_parent_columns_DOWN.sql`:

```sql
-- Migration 181 DOWN: revert scoped parent-link columns on artefacts_types.
BEGIN;

ALTER TABLE artefacts_types
    DROP COLUMN IF EXISTS artefacts_types_execution_parent_slots;

ALTER INDEX IF EXISTS artefacts_types_strategy_parent
    RENAME TO artefacts_types_parent;

ALTER TABLE artefacts_types
    RENAME COLUMN artefacts_types_strategy_parent_id TO artefacts_types_id_parent_type;

COMMIT;
```

- [ ] **Step 3: Dry-run the migration**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go run ./backend/cmd/migrate -dry-run -db vector_artefacts -env backend/.env.dev`
Expected: lists `181_artefact_types_parent_columns.sql` as pending, no errors.

- [ ] **Step 4: Verify the index name before applying**

The index rename assumes the index is named `artefacts_types_parent`. Confirm:

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
-tAc "SELECT indexname FROM pg_indexes WHERE tablename='artefacts_types' AND indexname LIKE '%parent%';"
```
Expected: one row, the parent index name. If it differs from `artefacts_types_parent`, update both migration files' `ALTER INDEX` lines to the actual name (and if no such index exists, delete the two `ALTER INDEX` lines entirely).

- [ ] **Step 5: Apply the migration**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go run ./backend/cmd/migrate -db vector_artefacts -env backend/.env.dev`
Expected: `181_...` applied, recorded in `schema_migrations`.

- [ ] **Step 6: Verify column rename + backfill landed**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
-c "SELECT artefacts_types_slot, artefacts_types_execution_parent_slots FROM artefacts_types WHERE artefacts_types_scope='work' ORDER BY artefacts_types_sort_order;" \
-c "SELECT column_name FROM information_schema.columns WHERE table_name='artefacts_types' AND column_name IN ('artefacts_types_strategy_parent_id','artefacts_types_execution_parent_slots');"
```
Expected: `wrk_story` → `{<feature-slot>,wrk_epic}`, `wrk_task` → `{wrk_defect,wrk_story}`, etc.; both column names present; no `artefacts_types_id_parent_type`.

- [ ] **Step 7: Commit**

```bash
git add db/vector_artefacts/schema/181_artefact_types_parent_columns.sql db/vector_artefacts/schema/down/181_artefact_types_parent_columns_DOWN.sql
git commit -m "feat(db): scoped parent-link columns on artefacts_types (181)"
```

---

## Phase 1 — Backend: rename references, add execution slots to the wire type

### Task 1.1: Rename the SQL identifier across Go (behaviour-neutral)

**Files:**
- Modify: `backend/internal/artefacttypes/service.go` (all `artefacts_types_id_parent_type` occurrences)
- Modify: `backend/internal/portfoliomodels/adopt_strategy_types.go`, `adopt_work_types.go`, `adopt_readopt.go`, `sql.go`
- Test: existing `portfoliomodels` tests must stay green.

- [ ] **Step 1: Find every occurrence**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "artefacts_types_id_parent_type" backend/`
Expected: a list of SQL string occurrences across the files above.

- [ ] **Step 2: Replace the SQL column identifier everywhere**

For each occurrence, replace the string `artefacts_types_id_parent_type` with `artefacts_types_strategy_parent_id`. These are inside Go SQL string constants — pure find/replace, no logic change. Do NOT change the Go struct field `ParentTypeID` or its JSON tag `parent_type_id`.

Run after editing: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "artefacts_types_id_parent_type" backend/`
Expected: no matches (all renamed).

- [ ] **Step 3: Build the backend**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go build ./backend/...`
Expected: builds clean.

- [ ] **Step 4: Run the portfoliomodels tests**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/portfoliomodels/... ./backend/internal/artefacttypes/...`
Expected: PASS — the rename is behaviour-neutral.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/artefacttypes/ backend/internal/portfoliomodels/
git commit -m "refactor(backend): rename id_parent_type SQL identifier to strategy_parent_id"
```

### Task 1.2: Add `execution_parent_slots` to the ArtefactType wire shape

**Files:**
- Modify: `backend/internal/artefacttypes/types.go` (add field)
- Modify: `backend/internal/artefacttypes/service.go` (select + scan the new column in List/ListByWorkspace/Patch RETURNING)

- [ ] **Step 1: Add the struct field**

In `backend/internal/artefacttypes/types.go`, add to the `ArtefactType` struct after `LayerDepth`:

```go
	// ExecutionParentSlots — work-scope allowed-parent rule: list of parent
	// type slots (wrk_story, wrk_epic, ...) this work type may nest under.
	// Nil for strategy types. Replaces the retired frontend PARENT_PREFIX_MAP.
	ExecutionParentSlots []string `json:"execution_parent_slots"`
```

- [ ] **Step 2: Add the column to every SELECT + scan**

In `backend/internal/artefacttypes/service.go`, the `List`, `ListByWorkspace`, and `Patch` queries each select a fixed column list and scan into `ArtefactType`. Add `artefacts_types_execution_parent_slots` to each SELECT column list (both the inner `live` CTE and the outer SELECT in List/ListByWorkspace, and the `RETURNING` in Patch), and add `&t.ExecutionParentSlots` to each `rows.Scan(...)` / `QueryRow(...).Scan(...)` in the matching position (append it last, matching the column order).

The shared scan in `queryArtefactTypes` scans in this order today:
```go
&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix,
&t.Description, &t.Colour, &t.Slot,
&t.ParentTypeID, &t.AllowsChildren, &t.LayerDepth,
&t.SortOrder, &t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
```
Append `&t.ExecutionParentSlots,` as the final scan target, and add `artefacts_types_execution_parent_slots` as the final column in each SELECT/RETURNING list. pgx scans a Postgres `TEXT[]` into `[]string` natively.

- [ ] **Step 3: Build**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go build ./backend/...`
Expected: clean.

- [ ] **Step 4: Smoke-test the list endpoint returns the field**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
DEV_API_KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2-) && \
curl -s -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/artefact-types | python3 -c "import sys,json; d=json.load(sys.stdin); print([(t['prefix'], t.get('execution_parent_slots')) for t in d['types'] if t['scope']=='work'])"
```
(Requires the Go server running with the new build — restart it first if needed.)
Expected: work types show their slot arrays; strategy types would show `null`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/artefacttypes/types.go backend/internal/artefacttypes/service.go
git commit -m "feat(backend): expose execution_parent_slots on artefact types"
```

---

## Phase 2 — Backend: create work type endpoint

### Task 2.1: Service.CreateWorkType (TDD)

**Files:**
- Modify: `backend/internal/artefacttypes/types.go` (add `CreateWorkTypeInput`)
- Modify: `backend/internal/artefacttypes/service.go` (add `CreateWorkType`)
- Test: `backend/internal/artefacttypes/service_create_test.go` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/internal/artefacttypes/service_create_test.go`. (Mirror the DB-backed test harness used in `seed_test.go` — same package, same pool acquisition helper. If `seed_test.go` uses a `testPool(t)` helper, reuse it; otherwise follow its connection setup exactly.)

```go
package artefacttypes

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestCreateWorkType_HappyPath(t *testing.T) {
	pool := testPool(t) // reuse the helper from seed_test.go
	svc := NewService(pool)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool) // reuse seed_test.go helper; create if absent
	wsID := seedTestWorkspace(t, pool, subID)

	// "Behaves like" Story — copy its execution_parent_slots.
	story := seedWorkType(t, pool, subID, wsID, "Story", "US", "wrk_story", []string{"FE", "wrk_epic"})

	out, err := svc.CreateWorkType(ctx, subID, wsID, CreateWorkTypeInput{
		Tag: "spk", Name: "Spike", Description: ptr("Time-boxed research"),
		Colour: ptr("#22c55e"), BehavesLikeTypeID: story.ID,
	})
	if err != nil {
		t.Fatalf("CreateWorkType: %v", err)
	}
	if out.Prefix != "SPK" {
		t.Errorf("prefix not upper-cased: %q", out.Prefix)
	}
	if out.Scope != "work" || out.Source != "tenant" {
		t.Errorf("scope/source = %q/%q", out.Scope, out.Source)
	}
	if len(out.ExecutionParentSlots) != 2 {
		t.Errorf("slots not copied from behaves-like: %v", out.ExecutionParentSlots)
	}
	if out.ParentTypeID != nil {
		t.Errorf("work type must have nil strategy parent")
	}
}

func TestCreateWorkType_DuplicatePrefix(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)
	story := seedWorkType(t, pool, subID, wsID, "Story", "US", "wrk_story", []string{"FE"})

	_, err := svc.CreateWorkType(ctx, subID, wsID, CreateWorkTypeInput{
		Tag: "US", Name: "Dup", BehavesLikeTypeID: story.ID,
	})
	var ve *ValidationError
	if !errorAs(err, &ve) {
		t.Fatalf("expected ValidationError for duplicate prefix, got %v", err)
	}
}
```

If helper funcs (`testPool`, `seedTestSubscription`, `seedTestWorkspace`, `seedWorkType`, `ptr`, `errorAs`) don't exist in the package's test files, add them in this same file: `ptr[T any](v T) *T { return &v }`, `errorAs` wraps `errors.As`, and the seed helpers do direct INSERTs returning the row. Inspect `seed_test.go` first and reuse anything already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/artefacttypes/ -run TestCreateWorkType -v`
Expected: FAIL — `CreateWorkType` / `CreateWorkTypeInput` undefined.

- [ ] **Step 3: Add the input type**

In `backend/internal/artefacttypes/types.go`:

```go
// CreateWorkTypeInput is the body for POST /_site/artefact-types (scope=work).
type CreateWorkTypeInput struct {
	Tag               string    `json:"tag"`
	Name              string    `json:"name"`
	Description       *string   `json:"description"`
	Colour            *string   `json:"colour"`
	BehavesLikeTypeID uuid.UUID `json:"behaves_like_type_id"`
}
```

- [ ] **Step 4: Implement CreateWorkType**

In `backend/internal/artefacttypes/service.go` add:

```go
// CreateWorkType inserts a tenant work type as a sibling at the execution
// level. Its allowed-parent rule is copied from the "behaves like" rung's
// execution_parent_slots. No artefact instances are touched.
func (s *Service) CreateWorkType(ctx context.Context, subscriptionID, workspaceID uuid.UUID, in CreateWorkTypeInput) (*ArtefactType, error) {
	if s.pool == nil {
		return nil, errors.New("vector_artefacts pool not available")
	}

	var violations []Violation
	prefix := strings.ToUpper(strings.TrimSpace(in.Tag))
	if len(prefix) == 0 || len(prefix) > 4 || !regexp.MustCompile(`^[A-Z0-9]+$`).MatchString(prefix) {
		violations = append(violations, Violation{"prefix", "Prefix must be 1–4 uppercase letters/digits."})
	}
	name := strings.TrimSpace(in.Name)
	if len(name) == 0 || len(name) > 64 {
		violations = append(violations, Violation{"name", "Name must be 1–64 characters."})
	}
	if in.Colour != nil && *in.Colour != "" && !hexColourRE.MatchString(*in.Colour) {
		violations = append(violations, Violation{"colour", "Colour must be a 6-digit hex value."})
	}
	if in.BehavesLikeTypeID == uuid.Nil {
		violations = append(violations, Violation{"behaves_like_type_id", "Choose an existing work type to base nesting on."})
	}
	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}

	// Resolve the behaves-like rung's slots, scoped to caller — cross-tenant
	// ids resolve to no row and fail closed.
	var slots []string
	err := s.pool.QueryRow(ctx, `
		SELECT artefacts_types_execution_parent_slots
		FROM artefacts_types
		WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2
		  AND artefacts_types_scope = 'work' AND artefacts_types_archived_at IS NULL`,
		in.BehavesLikeTypeID, subscriptionID,
	).Scan(&slots)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ValidationError{Violations: []Violation{{"behaves_like_type_id", "Base work type not found."}}}
	}
	if err != nil {
		return nil, fmt.Errorf("artefacttypes.CreateWorkType resolve base: %w", err)
	}

	var t ArtefactType
	err = s.pool.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_execution_parent_slots,
			artefacts_types_allows_children, artefacts_types_sort_order
		)
		VALUES ($1,$2,'work','tenant',$3,$4,$5,$6,$7,FALSE,
			COALESCE((SELECT MAX(artefacts_types_sort_order) FROM artefacts_types
				WHERE artefacts_types_id_subscription=$1 AND artefacts_types_scope='work'
				  AND artefacts_types_archived_at IS NULL), 0) + 10)
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_slot, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at,
			artefacts_types_created_at, artefacts_types_updated_at,
			artefacts_types_execution_parent_slots`,
		subscriptionID, workspaceID, name, prefix, in.Description, in.Colour, slots,
	).Scan(
		&t.ID, &t.Scope, &t.Source, &t.Name, &t.Prefix, &t.Description, &t.Colour,
		&t.Slot, &t.ParentTypeID, &t.AllowsChildren, &t.LayerDepth, &t.SortOrder,
		&t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt, &t.ExecutionParentSlots,
	)
	if err != nil {
		// Unique-violation on the live prefix index → 422.
		if isUniqueViolation(err) {
			return nil, &ValidationError{Violations: []Violation{{"prefix", "A live type with that prefix already exists in this scope."}}}
		}
		return nil, fmt.Errorf("artefacttypes.CreateWorkType insert: %w", err)
	}
	return &t, nil
}
```

Add the helper if not present:
```go
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
```
(Import `github.com/jackc/pgx/v5/pgconn`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/artefacttypes/ -run TestCreateWorkType -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/artefacttypes/types.go backend/internal/artefacttypes/service.go backend/internal/artefacttypes/service_create_test.go
git commit -m "feat(backend): Service.CreateWorkType with behaves-like slot copy"
```

### Task 2.2: Handler + route for create

**Files:**
- Modify: `backend/internal/artefacttypes/handler.go` (add `Create` + mount + permission gate)

- [ ] **Step 1: Add the Create handler**

In `backend/internal/artefacttypes/handler.go`:

```go
// POST /_site/artefact-types  — create a tenant WORK type.
// Strategy types are created only via /insert-layer (see InsertLayer).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "workspace context required")
		return
	}
	var in CreateWorkTypeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	created, err := h.Svc.CreateWorkType(r.Context(), u.SubscriptionID, wsID, in)
	if err != nil {
		writeArtefactTypeErr(w, r, err) // shared error mapper, see Step 2
		return
	}
	writeJSON(w, http.StatusCreated, created)
}
```

- [ ] **Step 2: Extract the shared error mapper**

The existing `Patch` handler inlines the 422/404/500 mapping. Extract it so `Create`/`InsertLayer` reuse it. Add to `handler.go`:

```go
func writeArtefactTypeErr(w http.ResponseWriter, r *http.Request, err error) {
	var ve *ValidationError
	if errors.As(err, &ve) {
		type violation struct {
			Field   string `json:"field"`
			Message string `json:"message"`
		}
		viols := make([]violation, len(ve.Violations))
		for i, v := range ve.Violations {
			viols[i] = violation{v.Field, v.Message}
		}
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"violations": viols})
		return
	}
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
}
```
Then refactor `Patch` to call `writeArtefactTypeErr(w, r, err)` in place of its inline block.

- [ ] **Step 3: Mount the route with the permission gate**

The `Mount` method currently takes `r chi.Router`. The permission resolver must be available to the handler. Add a `Perms *permissions.Resolver` field to `Handler` and set it in `NewHandler` (update the constructor signature to `NewHandler(s *Service, perms *permissions.Resolver)` and its call site in `main.go`). Then in `Mount`:

```go
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Patch("/{id}", h.Patch)
	gate := h.Perms.RequirePermission(permissions.PortfolioModelEdit)
	r.With(gate).Post("/", h.Create)
	r.With(gate).Post("/insert-layer/preview", h.PreviewInsertLayer) // Phase 3
	r.With(gate).Post("/insert-layer", h.InsertLayer)                // Phase 3
}
```
If `RequirePermission` is a method on a different type (e.g. `authSvc`), match the real call site found in `main.go` (`mountArtefactRoutes` uses `apikeys.RequireScope`; the permission resolver pattern is `res.RequirePermission(...)`). Verify the exact symbol before wiring; the gate must enforce `portfolio.model.edit`.

> NOTE (pre-existing gap): the current `Patch` route is NOT permission-gated (only auth+sentinel). This plan gates the NEW write routes. Retrofitting `Patch` is logged as **TD-ARTEFACT-TYPES-PATCH-UNGATED** (Phase 6) rather than silently changing existing behaviour here.

- [ ] **Step 4: Update the main.go wiring**

Find the `artefacttypes.NewHandler(...)` call in `backend/cmd/server/main.go` and pass the permission resolver. Find the `.Mount(` call (or the route group where artefact-types is mounted) and ensure the resolver is in scope. Build to confirm.

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go build ./backend/...`
Expected: clean.

- [ ] **Step 5: Manual smoke test (server running)**

Restart the Go server, then:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
DEV_API_KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2-) && \
curl -s -X POST -H "Authorization: Bearer $DEV_API_KEY" -H "Content-Type: application/json" \
  -d '{"tag":"spk","name":"Spike","behaves_like_type_id":"<a-real-work-type-uuid>"}' \
  http://localhost:5100/_site/artefact-types | python3 -m json.tool
```
Expected: `201` with the new type JSON, `execution_parent_slots` copied. (API-key path may bypass the permission gate — note that; user-session testing happens in Phase 5.)

- [ ] **Step 6: Commit**

```bash
git add backend/internal/artefacttypes/handler.go backend/cmd/server/main.go
git commit -m "feat(backend): POST /artefact-types create work type (portfolio.model.edit)"
```

---

## Phase 3 — Backend: insert strategic layer (preview + commit)

### Task 3.1: Pass-through artefact insert helper + chain math (TDD)

**Files:**
- Modify: `backend/internal/artefacttypes/types.go` (add `InsertLayerInput`, `InsertLayerPreview`, `ImpactedArtefact`)
- Create: `backend/internal/artefacttypes/insert_layer.go` (the service logic)
- Create: `backend/internal/artefacttypes/insert_layer_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/artefacttypes/insert_layer_test.go`:

```go
package artefacttypes

import (
	"context"
	"testing"
)

// Theme(parent=Product) has two Feature children with two Feature INSTANCES.
// Insert "Strategic Objective" between Theme and Feature → each Feature instance
// gets one pass-through parent of the new type, mirroring its name.
func TestInsertLayer_PassThroughBackfill(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)

	product := seedStrategyType(t, pool, subID, wsID, "Product", "PR", nil)
	theme := seedStrategyType(t, pool, subID, wsID, "Theme", "TH", &product.ID)
	feature := seedStrategyType(t, pool, subID, wsID, "Feature", "FE", &theme.ID)

	// Two feature instances, each parented to a theme instance.
	themeInst := seedArtefact(t, pool, subID, wsID, theme.ID, "Theme A", nil)
	f1 := seedArtefact(t, pool, subID, wsID, feature.ID, "Login", &themeInst.ID)
	f2 := seedArtefact(t, pool, subID, wsID, feature.ID, "Signup", &themeInst.ID)

	prev, err := svc.PreviewInsertLayer(ctx, subID, wsID, InsertLayerInput{
		Tag: "so", Name: "Strategic Objective", ChildTypeID: feature.ID,
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if prev.PassthroughCount != 2 {
		t.Fatalf("expected 2 impacted, got %d", prev.PassthroughCount)
	}

	res, err := svc.InsertLayer(ctx, subID, wsID, InsertLayerInput{
		Tag: "so", Name: "Strategic Objective", ChildTypeID: feature.ID,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if res.CreatedCount != 2 {
		t.Fatalf("expected 2 created, got %d", res.CreatedCount)
	}

	// Feature type now parents under the new type.
	assertParentTypeID(t, pool, feature.ID, res.NewType.ID)
	// New type parents under Theme.
	assertParentTypeID(t, pool, res.NewType.ID, theme.ID)
	// f1's parent is now a pass-through named "Login", whose parent is themeInst.
	p1 := artefactParent(t, pool, f1.ID)
	assertArtefactTitle(t, pool, p1, "Login")
	assertArtefactParent(t, pool, p1, themeInst.ID)
	_ = f2
}

func TestInsertLayer_OrphanChild(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)
	product := seedStrategyType(t, pool, subID, wsID, "Product", "PR", nil)
	theme := seedStrategyType(t, pool, subID, wsID, "Theme", "TH", &product.ID)
	feature := seedStrategyType(t, pool, subID, wsID, "Feature", "FE", &theme.ID)
	orphan := seedArtefact(t, pool, subID, wsID, feature.ID, "Orphan", nil) // no parent

	res, err := svc.InsertLayer(ctx, subID, wsID, InsertLayerInput{Tag: "so", Name: "SO", ChildTypeID: feature.ID})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if res.CreatedCount != 1 {
		t.Fatalf("orphan should still get one wrapper, got %d", res.CreatedCount)
	}
	p := artefactParent(t, pool, orphan.ID)
	assertArtefactParentNil(t, pool, p) // wrapper is a root
}
```

Add the seed/assert helpers (`seedStrategyType`, `seedArtefact`, `assertParentTypeID`, `artefactParent`, `assertArtefactTitle`, `assertArtefactParent`, `assertArtefactParentNil`) in this file via direct SQL — small, focused, one INSERT/SELECT each.

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/artefacttypes/ -run TestInsertLayer -v`
Expected: FAIL — undefined `PreviewInsertLayer` / `InsertLayer` / input types.

- [ ] **Step 3: Add the wire/service types**

In `backend/internal/artefacttypes/types.go`:

```go
type InsertLayerInput struct {
	Tag         string    `json:"tag"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Colour      *string   `json:"colour"`
	ChildTypeID uuid.UUID `json:"child_type_id"`
}

type ImpactedArtefact struct {
	ID                uuid.UUID `json:"id"`
	Name              string    `json:"name"`
	CurrentParentName *string   `json:"current_parent_name"`
}

type LayerRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type InsertLayerPreview struct {
	ParentLayer      LayerRef           `json:"parent_layer"`
	ChildLayer       LayerRef           `json:"child_layer"`
	Impacted         []ImpactedArtefact `json:"impacted"`
	PassthroughCount int                `json:"passthrough_count"`
	Rejection        *string            `json:"rejection"`
}

type InsertLayerResult struct {
	NewType      *ArtefactType `json:"new_type"`
	CreatedCount int           `json:"created_count"`
}
```

- [ ] **Step 4: Implement the service logic**

Create `backend/internal/artefacttypes/insert_layer.go`. Two exported methods sharing a `resolveGap` helper:

```go
package artefacttypes

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// gap holds the resolved insertion context: the chosen child type, its current
// parent type, and validation of the immutable PRW..Feature bounds.
type gap struct {
	childID, childParentID uuid.UUID
	childName, parentName  string
	depthOfChild           int // distance from root; used for the 0..9 cap check
}

// resolveGap validates the child type, derives its parent, and checks bounds.
// Bounds: cannot insert below the leaf (a child with no strategy children of
// its own is the bottom bound, Feature) — actually the rule is "child must have
// a parent" (so we never insert above the root PRW) and inserting always lands
// strictly between child and its parent, which is inside the ladder by
// construction. The depth cap is the only structural rejection.
func (s *Service) resolveGap(ctx context.Context, subID, wsID uuid.UUID, childID uuid.UUID) (*gap, *string, error) {
	var g gap
	g.childID = childID
	var parentID *uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT c.artefacts_types_name, c.artefacts_types_strategy_parent_id
		FROM artefacts_types c
		WHERE c.artefacts_types_id = $1 AND c.artefacts_types_id_subscription = $2
		  AND c.artefacts_types_scope = 'strategy' AND c.artefacts_types_archived_at IS NULL`,
		childID, subID,
	).Scan(&g.childName, &parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		rej := "Chosen layer not found."
		return nil, &rej, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("resolveGap child: %w", err)
	}
	if parentID == nil {
		// Child is the root (Portfolio Runway) — inserting above it is forbidden.
		rej := "Cannot insert above the top layer."
		return nil, &rej, nil
	}
	g.childParentID = *parentID
	if err := s.pool.QueryRow(ctx, `
		SELECT artefacts_types_name FROM artefacts_types
		WHERE artefacts_types_id = $1 AND artefacts_types_id_subscription = $2`,
		g.childParentID, subID,
	).Scan(&g.parentName); err != nil {
		return nil, nil, fmt.Errorf("resolveGap parent: %w", err)
	}

	// Depth cap: count current ladder length; inserting adds one. Reject if >10.
	var ladderLen int
	if err := s.pool.QueryRow(ctx, `
		WITH RECURSIVE chain AS (
			SELECT artefacts_types_id, artefacts_types_strategy_parent_id, 1 AS n
			FROM artefacts_types
			WHERE artefacts_types_strategy_parent_id IS NULL
			  AND artefacts_types_scope='strategy' AND artefacts_types_id_subscription=$1
			  AND artefacts_types_archived_at IS NULL
			UNION ALL
			SELECT t.artefacts_types_id, t.artefacts_types_strategy_parent_id, chain.n+1
			FROM artefacts_types t JOIN chain ON t.artefacts_types_strategy_parent_id = chain.artefacts_types_id
			WHERE t.artefacts_types_scope='strategy' AND t.artefacts_types_archived_at IS NULL
		)
		SELECT COALESCE(MAX(n),0) FROM chain`, subID,
	).Scan(&ladderLen); err != nil {
		return nil, nil, fmt.Errorf("resolveGap ladder: %w", err)
	}
	if ladderLen+1 > 10 {
		rej := "Inserting here would exceed the 10-layer maximum."
		return nil, &rej, nil
	}
	return &g, nil, nil
}

func (s *Service) validateInsertInput(in InsertLayerInput) []Violation {
	var v []Violation
	p := strings.ToUpper(strings.TrimSpace(in.Tag))
	if len(p) == 0 || len(p) > 4 || !regexp.MustCompile(`^[A-Z0-9]+$`).MatchString(p) {
		v = append(v, Violation{"prefix", "Prefix must be 1–4 uppercase letters/digits."})
	}
	if n := strings.TrimSpace(in.Name); len(n) == 0 || len(n) > 64 {
		v = append(v, Violation{"name", "Name must be 1–64 characters."})
	}
	if in.Colour != nil && *in.Colour != "" && !hexColourRE.MatchString(*in.Colour) {
		v = append(v, Violation{"colour", "Colour must be a 6-digit hex value."})
	}
	return v
}

// listImpacted returns the live artefacts of the child type within the clamp.
func (s *Service) listImpacted(ctx context.Context, subID, wsID, childTypeID uuid.UUID) ([]ImpactedArtefact, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.artefacts_id, a.artefacts_title, p.artefacts_title
		FROM artefacts a
		LEFT JOIN artefacts p ON p.artefacts_id = a.artefacts_id_parent
		WHERE a.artefacts_id_artefact_type = $1
		  AND a.artefacts_id_subscription = $2
		  AND a.artefacts_id_workspace = $3
		  AND a.artefacts_archived_at IS NULL
		ORDER BY a.artefacts_number`,
		childTypeID, subID, wsID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImpactedArtefact
	for rows.Next() {
		var ia ImpactedArtefact
		if err := rows.Scan(&ia.ID, &ia.Name, &ia.CurrentParentName); err != nil {
			return nil, err
		}
		out = append(out, ia)
	}
	return out, rows.Err()
}

// PreviewInsertLayer: per spec §9, malformed INPUT (bad tag/name/colour) still
// returns 422 (it's a client error, not a hierarchy condition). BLOCKING
// hierarchy conditions (bounds, depth cap) return 200 with `rejection` set so
// the flyout can explain why Confirm is disabled. The commit path re-checks all
// of it and is the authoritative gate.
func (s *Service) PreviewInsertLayer(ctx context.Context, subID, wsID uuid.UUID, in InsertLayerInput) (*InsertLayerPreview, error) {
	if viols := s.validateInsertInput(in); len(viols) > 0 {
		return nil, &ValidationError{Violations: viols}
	}
	g, rej, err := s.resolveGap(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, err
	}
	if rej != nil {
		return &InsertLayerPreview{Rejection: rej}, nil
	}
	impacted, err := s.listImpacted(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, fmt.Errorf("PreviewInsertLayer impacted: %w", err)
	}
	return &InsertLayerPreview{
		ParentLayer:      LayerRef{ID: g.childParentID, Name: g.parentName},
		ChildLayer:       LayerRef{ID: g.childID, Name: g.childName},
		Impacted:         impacted,
		PassthroughCount: len(impacted),
	}, nil
}

func (s *Service) InsertLayer(ctx context.Context, subID, wsID uuid.UUID, in InsertLayerInput) (*InsertLayerResult, error) {
	if viols := s.validateInsertInput(in); len(viols) > 0 {
		return nil, &ValidationError{Violations: viols}
	}
	g, rej, err := s.resolveGap(ctx, subID, wsID, in.ChildTypeID)
	if err != nil {
		return nil, err
	}
	if rej != nil {
		return nil, &ValidationError{Violations: []Violation{{"child_type_id", *rej}}}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	prefix := strings.ToUpper(strings.TrimSpace(in.Tag))
	name := strings.TrimSpace(in.Name)

	// 1. Insert N under P.
	var newType ArtefactType
	err = tx.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_sort_order)
		VALUES ($1,$2,'strategy','tenant',$3,$4,$5,$6,$7,TRUE,
			COALESCE((SELECT MAX(artefacts_types_sort_order) FROM artefacts_types
				WHERE artefacts_types_id_subscription=$1 AND artefacts_types_scope='strategy'
				  AND artefacts_types_archived_at IS NULL),0)+10)
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_slot, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at,
			artefacts_types_created_at, artefacts_types_updated_at,
			artefacts_types_execution_parent_slots`,
		subID, wsID, name, prefix, in.Description, in.Colour, g.childParentID,
	).Scan(
		&newType.ID, &newType.Scope, &newType.Source, &newType.Name, &newType.Prefix,
		&newType.Description, &newType.Colour, &newType.Slot, &newType.ParentTypeID,
		&newType.AllowsChildren, &newType.LayerDepth, &newType.SortOrder,
		&newType.ArchivedAt, &newType.CreatedAt, &newType.UpdatedAt, &newType.ExecutionParentSlots,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, &ValidationError{Violations: []Violation{{"prefix", "A live type with that prefix already exists in this scope."}}}
		}
		return nil, fmt.Errorf("InsertLayer insert type: %w", err)
	}

	// 2. Re-parent the child type under N.
	if _, err := tx.Exec(ctx, `
		UPDATE artefacts_types SET artefacts_types_strategy_parent_id = $1, artefacts_types_updated_at = now()
		WHERE artefacts_types_id = $2 AND artefacts_types_id_subscription = $3`,
		newType.ID, g.childID, subID,
	); err != nil {
		return nil, fmt.Errorf("InsertLayer reparent type: %w", err)
	}

	// 3. Backfill pass-through instances: one wrapper per live child instance.
	impacted, err := s.listImpactedTx(ctx, tx, subID, wsID, g.childID)
	if err != nil {
		return nil, fmt.Errorf("InsertLayer list impacted: %w", err)
	}
	created := 0
	for _, c := range impacted {
		// Resolve the child instance's current parent (may be NULL).
		var curParent *uuid.UUID
		if err := tx.QueryRow(ctx,
			`SELECT artefacts_id_parent FROM artefacts WHERE artefacts_id = $1`, c.ID,
		).Scan(&curParent); err != nil {
			return nil, fmt.Errorf("InsertLayer read parent: %w", err)
		}
		newWrapperID, err := s.insertPassThroughArtefact(ctx, tx, subID, wsID, newType.ID, c.Name, curParent)
		if err != nil {
			return nil, fmt.Errorf("InsertLayer wrapper: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE artefacts SET artefacts_id_parent = $1 WHERE artefacts_id = $2`,
			newWrapperID, c.ID,
		); err != nil {
			return nil, fmt.Errorf("InsertLayer reparent instance: %w", err)
		}
		created++
	}

	// 4. Recompute layer_depth as derived mirror (distance from root).
	if err := s.recomputeStrategyDepthsTx(ctx, tx, subID); err != nil {
		return nil, fmt.Errorf("InsertLayer recompute depth: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("InsertLayer commit: %w", err)
	}
	return &InsertLayerResult{NewType: &newType, CreatedCount: created}, nil
}
```

Add the tx helpers in the same file:

```go
// insertPassThroughArtefact creates a minimal artefact of the given type, named
// after the child it wraps. Deliberately NOT the full CreateWorkItem path — a
// pass-through needs only identity, type, parent, clamp, and a number. The
// number is allocated as max+1 within the workspace for this type's scope.
func (s *Service) insertPassThroughArtefact(ctx context.Context, tx pgx.Tx, subID, wsID, typeID uuid.UUID, title string, parent *uuid.UUID) (uuid.UUID, error) {
	var newID uuid.UUID
	err := tx.QueryRow(ctx, `
		INSERT INTO artefacts (
			artefacts_id_subscription, artefacts_id_workspace,
			artefacts_id_artefact_type, artefacts_number, artefacts_title,
			artefacts_id_parent)
		VALUES ($1,$2,$3,
			COALESCE((SELECT MAX(artefacts_number)+1 FROM artefacts
				WHERE artefacts_id_workspace=$2),1),
			$4,$5)
		RETURNING artefacts_id`,
		subID, wsID, typeID, title, parent,
	).Scan(&newID)
	return newID, err
}

func (s *Service) listImpactedTx(ctx context.Context, tx pgx.Tx, subID, wsID, childTypeID uuid.UUID) ([]ImpactedArtefact, error) {
	rows, err := tx.Query(ctx, `
		SELECT a.artefacts_id, a.artefacts_title
		FROM artefacts a
		WHERE a.artefacts_id_artefact_type = $1 AND a.artefacts_id_subscription = $2
		  AND a.artefacts_id_workspace = $3 AND a.artefacts_archived_at IS NULL
		ORDER BY a.artefacts_number`,
		childTypeID, subID, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ImpactedArtefact
	for rows.Next() {
		var ia ImpactedArtefact
		if err := rows.Scan(&ia.ID, &ia.Name); err != nil {
			return nil, err
		}
		out = append(out, ia)
	}
	return out, rows.Err()
}

// recomputeStrategyDepthsTx sets layer_depth = distance-from-root along the
// strategy_parent_id chain for every live strategy type in the subscription.
func (s *Service) recomputeStrategyDepthsTx(ctx context.Context, tx pgx.Tx, subID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		WITH RECURSIVE chain AS (
			SELECT artefacts_types_id, 0 AS depth
			FROM artefacts_types
			WHERE artefacts_types_strategy_parent_id IS NULL
			  AND artefacts_types_scope='strategy' AND artefacts_types_id_subscription=$1
			  AND artefacts_types_archived_at IS NULL
			UNION ALL
			SELECT t.artefacts_types_id, chain.depth+1
			FROM artefacts_types t JOIN chain ON t.artefacts_types_strategy_parent_id = chain.artefacts_types_id
			WHERE t.artefacts_types_scope='strategy' AND t.artefacts_types_archived_at IS NULL
		)
		UPDATE artefacts_types u SET artefacts_types_layer_depth = chain.depth
		FROM chain WHERE u.artefacts_types_id = chain.artefacts_types_id`, subID)
	return err
}
```

> NOTE: `insertPassThroughArtefact` sets only NOT-NULL-safe columns. Before implementing, run `\d artefacts` (psql) and confirm which columns are `NOT NULL` without defaults. If `artefacts_id_flow_state`, `artefacts_id_user_owned_by`, `artefacts_id_user_created_by`, or `artefacts_id_topology_node` are NOT NULL without a default, add them to the INSERT — owner/creator from `sentinel.FromCtx(ctx).UserID` (thread the clamp into the method), flow-state via the type's default. This is the one place the plan cannot fully pre-resolve; the `\d` output decides it. Add a step in Task 3.1 to capture that schema and adjust.

- [ ] **Step 4a: Capture the artefacts NOT-NULL columns**

Run:
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
PGPASSWORD=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
-c "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='artefacts' AND is_nullable='NO' ORDER BY ordinal_position;"
```
Expected: the authoritative NOT-NULL list. Adjust `insertPassThroughArtefact`'s INSERT to satisfy every NOT-NULL-without-default column (thread `sentinel.FromCtx` UserID + resolve the type's default flow-state if required).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/artefacttypes/ -run TestInsertLayer -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/artefacttypes/types.go backend/internal/artefacttypes/insert_layer.go backend/internal/artefacttypes/insert_layer_test.go
git commit -m "feat(backend): insert-layer preview + transactional pass-through backfill"
```

### Task 3.2: Handlers for preview + insert

**Files:**
- Modify: `backend/internal/artefacttypes/handler.go`

- [ ] **Step 1: Add both handlers**

```go
func (h *Handler) PreviewInsertLayer(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "workspace context required")
		return
	}
	var in InsertLayerInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	prev, err := h.Svc.PreviewInsertLayer(r.Context(), u.SubscriptionID, wsID, in)
	if err != nil {
		writeArtefactTypeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, prev)
}

func (h *Handler) InsertLayer(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "workspace context required")
		return
	}
	var in InsertLayerInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	res, err := h.Svc.InsertLayer(r.Context(), u.SubscriptionID, wsID, in)
	if err != nil {
		writeArtefactTypeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
```
(Routes were already added to `Mount` in Task 2.2 Step 3.)

- [ ] **Step 2: Build**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go build ./backend/...`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/artefacttypes/handler.go
git commit -m "feat(backend): insert-layer preview + commit handlers"
```

---

## Phase 4 — Frontend: resolver cleanup (retire PARENT_PREFIX_MAP)

### Task 4.1: Add the wire field + API methods

**Files:**
- Modify: `app/lib/artefactTypesApi.ts`

- [ ] **Step 1: Extend the type + add methods**

In `app/lib/artefactTypesApi.ts`, add to `ArtefactType`:
```ts
  execution_parent_slots: string[] | null;
```
Add the three methods and export them:
```ts
async function create(body: {
  scope: "work";
  tag: string; name: string; description?: string | null; colour?: string | null;
  behaves_like_type_id: string;
}): Promise<ArtefactType> {
  return apiSite<ArtefactType>("/artefact-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface InsertLayerBody {
  tag: string; name: string; description?: string | null; colour?: string | null;
  child_type_id: string;
}
export interface InsertLayerPreview {
  parent_layer: { id: string; name: string };
  child_layer: { id: string; name: string };
  impacted: { id: string; name: string; current_parent_name: string | null }[];
  passthrough_count: number;
  rejection?: string | null;
}
async function previewInsertLayer(body: InsertLayerBody): Promise<InsertLayerPreview> {
  return apiSite<InsertLayerPreview>("/artefact-types/insert-layer/preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function insertLayer(body: InsertLayerBody): Promise<{ new_type: ArtefactType; created_count: number }> {
  return apiSite("/artefact-types/insert-layer", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export const artefactTypesApi = { list, patch, resync, create, previewInsertLayer, insertLayer };
```

- [ ] **Step 2: Typecheck**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit` (or the project's `npm run typecheck` if defined)
Expected: no new errors in this file.

- [ ] **Step 3: Commit**

```bash
git add app/lib/artefactTypesApi.ts
git commit -m "feat(fe): artefactTypesApi create + insert-layer methods + execution_parent_slots"
```

### Task 4.2: Migrate the resolver off PARENT_PREFIX_MAP (TDD)

**Files:**
- Modify: `app/components/ArtefactInlineForm/useParentCandidates.ts`
- Test: `app/components/ArtefactInlineForm/__tests__/resolveAllowedTypes.test.ts` (create — extract `resolveAllowedTypes` so it's unit-testable)

- [ ] **Step 1: Export resolveAllowedTypes for testing**

In `useParentCandidates.ts`, change `function resolveAllowedTypes` to `export function resolveAllowedTypes`. Add a `slotToId` resolution: it needs the full type list (already passed as `allTypes`). Build a `Map<slot, type>` once.

- [ ] **Step 2: Write the failing test**

Create `app/components/ArtefactInlineForm/__tests__/resolveAllowedTypes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAllowedTypes } from "../useParentCandidates";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

const mk = (over: Partial<ArtefactType>): ArtefactType => ({
  id: over.id!, scope: over.scope ?? "work", source: "system",
  name: over.name ?? "X", prefix: over.prefix ?? "XX", description: null,
  colour: null, slot: over.slot ?? null, parent_type_id: over.parent_type_id ?? null,
  allows_children: true, layer_depth: over.layer_depth ?? null, sort_order: 0,
  archived_at: null, created_at: "", updated_at: "",
  execution_parent_slots: over.execution_parent_slots ?? null,
});

describe("resolveAllowedTypes", () => {
  it("work type resolves execution_parent_slots → types", () => {
    const feature = mk({ id: "f", scope: "strategy", prefix: "FE", slot: "str_feature" });
    const epic = mk({ id: "e", scope: "work", prefix: "EP", slot: "wrk_epic" });
    const story = mk({ id: "s", scope: "work", prefix: "US", slot: "wrk_story",
      execution_parent_slots: ["str_feature", "wrk_epic"] });
    const allowed = resolveAllowedTypes(story, [feature, epic, story]);
    expect(allowed.map((t) => t.id).sort()).toEqual(["e", "f"]);
  });

  it("strategy type walks the parent_type_id chain upward", () => {
    const prw = mk({ id: "prw", scope: "strategy", prefix: "PRW" });
    const product = mk({ id: "pr", scope: "strategy", prefix: "PR", parent_type_id: "prw" });
    const theme = mk({ id: "th", scope: "strategy", prefix: "TH", parent_type_id: "pr" });
    const allowed = resolveAllowedTypes(theme, [prw, product, theme]);
    expect(allowed.map((t) => t.id)).toEqual(["pr", "prw"]);
  });

  it("returns empty for a root strategy type with no parent", () => {
    const prw = mk({ id: "prw", scope: "strategy", prefix: "PRW" });
    expect(resolveAllowedTypes(prw, [prw])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/components/ArtefactInlineForm/__tests__/resolveAllowedTypes.test.ts`
Expected: FAIL — old resolver uses PARENT_PREFIX_MAP + layer_depth; the work-slot test fails.

- [ ] **Step 4: Rewrite resolveAllowedTypes to two scope-driven tiers**

Replace the body with:

```ts
export function resolveAllowedTypes(
  editing: ArtefactType,
  allTypes: ArtefactType[],
): ArtefactType[] {
  // Work types → resolve execution_parent_slots (slots) to live types.
  if (editing.scope === "work") {
    const slots = editing.execution_parent_slots ?? [];
    if (slots.length === 0) return [];
    const bySlot = new Map(allTypes.filter((t) => t.slot).map((t) => [t.slot as string, t]));
    const out: ArtefactType[] = [];
    for (const slot of slots) {
      const t = bySlot.get(slot);
      if (t && t.id !== editing.id) out.push(t);
    }
    return out;
  }
  // Strategy types → walk the parent_type_id chain upward.
  if (editing.parent_type_id != null) {
    const byId = new Map(allTypes.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const out: ArtefactType[] = [];
    let cursorId: string | null = editing.parent_type_id;
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const node = byId.get(cursorId);
      if (!node) break;
      out.push(node);
      cursorId = node.parent_type_id ?? null;
    }
    return out;
  }
  return [];
}
```
Remove the `import { PARENT_PREFIX_MAP } from "./types";` (keep `type ParentOption`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/components/ArtefactInlineForm/__tests__/resolveAllowedTypes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/ArtefactInlineForm/useParentCandidates.ts app/components/ArtefactInlineForm/__tests__/resolveAllowedTypes.test.ts
git commit -m "feat(fe): resolver reads execution_parent_slots + chain walk, drops layer_depth tier"
```

### Task 4.3: Migrate workItemsReparentRules + legacy ObjectTree, delete PARENT_PREFIX_MAP

**Files:**
- Modify: `app/components/ObjectTreeV2/configs/workItemsReparentRules.ts`
- Modify: `app/components/ObjectTree/p_ObjectTree.tsx` (legacy)
- Modify: `app/components/ArtefactInlineForm/types.ts` (delete the constant)

- [ ] **Step 1: Decide the reparent inputs**

`workItemsCanReparent(mover, target)` currently keys `PARENT_PREFIX_MAP[mover.type_prefix]` and checks `target.type_prefix`. The slots are stored on the type, not the row. Two options — pick the one matching how the caller already has data:

(a) If callers have the full type list in scope, pass a resolver: change signature to `workItemsCanReparent(mover, target, allowedSlotsByMoverPrefix)` where the page computes `prefix → slots`-resolved-to-`prefixes` once from the loaded types. 

(b) Simpler, no signature change: have the page build a `Record<string, string[]>` (mover prefix → allowed target prefixes) from the loaded artefact types' `execution_parent_slots` (slot→prefix resolved) and pass it where `PARENT_PREFIX_MAP` was imported.

Use (b): export a builder from `workItemsReparentRules.ts`:
```ts
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

// Build {moverPrefix: [allowedTargetPrefix,...]} from live types' slots.
export function buildReparentMap(types: ArtefactType[]): Record<string, string[]> {
  const prefixBySlot = new Map(types.filter((t) => t.slot).map((t) => [t.slot as string, t.prefix.toUpperCase()]));
  const map: Record<string, string[]> = {};
  for (const t of types) {
    if (t.scope !== "work" || !t.execution_parent_slots) continue;
    map[t.prefix.toUpperCase()] = t.execution_parent_slots
      .map((s) => prefixBySlot.get(s))
      .filter((p): p is string => !!p);
  }
  return map;
}
```
Change `workItemsCanReparent` + `workItemsGetCandidateIds` to take the map as a parameter instead of importing `PARENT_PREFIX_MAP`:
```ts
export function workItemsCanReparent(
  mover: ReparentableRow, target: ReparentableRow,
  reparentMap: Record<string, string[]>,
): boolean {
  if (mover.id === target.id) return false;
  if (mover.parent_id === target.id) return false;
  const allowed = reparentMap[mover.type_prefix?.toUpperCase() ?? ""] ?? [];
  return allowed.includes(target.type_prefix?.toUpperCase() ?? "");
}
```

- [ ] **Step 2: Update callers of workItemsCanReparent / workItemsGetCandidateIds**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "workItemsCanReparent\|workItemsGetCandidateIds" app/`
For each caller, build the map via `buildReparentMap(types)` (types already loaded in those components — they call `artefactTypesApi.list()` or have a context) and thread it through. Where a caller lacks the type list, fetch it once and memoize.

- [ ] **Step 3: Migrate the legacy ObjectTree**

In `app/components/ObjectTree/p_ObjectTree.tsx`, replace each `PARENT_PREFIX_MAP[mover.type_prefix?.toUpperCase() ?? ""]` with a lookup into a `buildReparentMap(types)` result computed from the types it already loads. Remove the `PARENT_PREFIX_MAP` import.

- [ ] **Step 4: Delete the constant**

In `app/components/ArtefactInlineForm/types.ts`, delete the `PARENT_PREFIX_MAP` constant (lines ~109-124) and its comment block.

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && grep -rn "PARENT_PREFIX_MAP" app/`
Expected: no matches.

- [ ] **Step 5: Typecheck + run reparent tests**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit && npx vitest run app/components/ObjectTreeV2`
Expected: clean; any existing reparent-rule tests updated to pass the map argument and pass.

- [ ] **Step 6: Commit**

```bash
git add app/components/ObjectTreeV2/configs/workItemsReparentRules.ts app/components/ObjectTree/p_ObjectTree.tsx app/components/ArtefactInlineForm/types.ts
git commit -m "refactor(fe): retire PARENT_PREFIX_MAP; reparent rules read live slots"
```

---

## Phase 5 — Frontend: ArtefactTypeCreateFlyout + page wiring

### Task 5.1: The flyout component (work + strategy forks)

**Files:**
- Create: `app/components/ArtefactTypeCreateFlyout/index.tsx`
- Test: `app/components/ArtefactTypeCreateFlyout/__tests__/ArtefactTypeCreateFlyout.test.tsx`

- [ ] **Step 1: Write the failing test (scope fork + strategy gate)**

Create the test. It renders the flyout with a mocked `artefactTypesApi`, asserts the Work form shows a "Behaves like" select and the Strategy form shows an "Insert between" select, and that the strategy Confirm button is disabled until `previewInsertLayer` resolves.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArtefactTypeCreateFlyout } from "../index";
import { artefactTypesApi } from "@/app/lib/artefactTypesApi";

vi.mock("@/app/lib/artefactTypesApi", () => ({
  artefactTypesApi: {
    create: vi.fn(),
    previewInsertLayer: vi.fn(),
    insertLayer: vi.fn(),
  },
}));

const TYPES = [
  { id: "s", scope: "work", prefix: "US", name: "Story", slot: "wrk_story", parent_type_id: null, execution_parent_slots: ["str_feature"], layer_depth: null },
  { id: "th", scope: "strategy", prefix: "TH", name: "Theme", slot: null, parent_type_id: "pr", execution_parent_slots: null, layer_depth: 3 },
  { id: "fe", scope: "strategy", prefix: "FE", name: "Feature", slot: "str_feature", parent_type_id: "th", execution_parent_slots: null, layer_depth: null },
  { id: "pr", scope: "strategy", prefix: "PR", name: "Product", slot: null, parent_type_id: "prw", execution_parent_slots: null, layer_depth: 1 },
  { id: "prw", scope: "strategy", prefix: "PRW", name: "Portfolio Runway", slot: null, parent_type_id: null, execution_parent_slots: null, layer_depth: 0 },
] as any;

describe("ArtefactTypeCreateFlyout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("work scope shows Behaves-like select", () => {
    render(<ArtefactTypeCreateFlyout types={TYPES} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /work/i }));
    expect(screen.getByLabelText(/behaves like/i)).toBeInTheDocument();
  });

  it("strategy scope disables Confirm until preview returns", async () => {
    (artefactTypesApi.previewInsertLayer as any).mockResolvedValue({
      parent_layer: { id: "th", name: "Theme" }, child_layer: { id: "fe", name: "Feature" },
      impacted: [{ id: "x", name: "Login", current_parent_name: "Theme A" }],
      passthrough_count: 1, rejection: null,
    });
    render(<ArtefactTypeCreateFlyout types={TYPES} onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /strategy/i }));
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull(); // not until previewed
    fireEvent.change(screen.getByLabelText(/tag/i), { target: { value: "SO" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Strategic Objective" } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() => expect(screen.getByText(/Login/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/components/ArtefactTypeCreateFlyout`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the flyout**

Create `app/components/ArtefactTypeCreateFlyout/index.tsx`. Follow the `EditFlyout` house style (`<aside role="dialog">` + header + `<Panel>` + `form__row`/`form__label`/`form__input`). Structure:

```tsx
"use client";

import { useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import { ColourPicker } from "@/app/components/ColourPicker";
import { notify } from "@/app/lib/toast";
import { ApiError } from "@/app/lib/api";
import {
  artefactTypesApi, type ArtefactType, type InsertLayerPreview,
} from "@/app/lib/artefactTypesApi";

type Scope = "work" | "strategy";

export function ArtefactTypeCreateFlyout({
  types, onClose, onCreated,
}: {
  types: ArtefactType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colour, setColour] = useState<string | null>(null);
  const [behavesLike, setBehavesLike] = useState("");
  const [childTypeId, setChildTypeId] = useState("");
  const [preview, setPreview] = useState<InsertLayerPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const workTypes = useMemo(() => types.filter((t) => t.scope === "work"), [types]);

  // Valid gaps: every strategy type that HAS a parent (so we never insert above
  // the root) — selecting it inserts between it and its current parent.
  const gapChildren = useMemo(
    () => types.filter((t) => t.scope === "strategy" && t.parent_type_id != null)
      .sort((a, b) => (a.layer_depth ?? 99) - (b.layer_depth ?? 99)),
    [types],
  );

  const submitWork = async () => {
    setBusy(true);
    try {
      await artefactTypesApi.create({
        scope: "work", tag, name,
        description: description || null, colour,
        behaves_like_type_id: behavesLike,
      });
      notify.success(`Created work type “${name}”.`);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.violations) {
        notify.error(err.violations.map((v) => v.message).join("; "));
      } else notify.apiError(err, "Failed to create type.");
    } finally { setBusy(false); }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const p = await artefactTypesApi.previewInsertLayer({
        tag, name, description: description || null, colour, child_type_id: childTypeId,
      });
      setPreview(p);
      if (p.rejection) notify.error(p.rejection);
    } catch (err) { notify.apiError(err, "Preview failed."); }
    finally { setBusy(false); }
  };

  const confirmInsert = async () => {
    setBusy(true);
    try {
      const res = await artefactTypesApi.insertLayer({
        tag, name, description: description || null, colour, child_type_id: childTypeId,
      });
      notify.success(`Inserted “${name}” — ${res.created_count} pass-through artefacts created.`);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.violations) {
        notify.error(err.violations.map((v) => v.message).join("; "));
      } else notify.apiError(err, "Insert failed.");
    } finally { setBusy(false); }
  };

  return (
    <aside className="topo-flyout" role="dialog" aria-label="Create artefact type">
      <header className="topo-flyout__head">
        <h2 className="modal__title">New artefact type</h2>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Close panel" onClick={onClose}>×</button>
      </header>
      <Panel name="artefact_type_create_flyout" className="panel--bare topo-flyout__panel">
        <div className="topo-flyout__body">
          <fieldset className="form__row">
            <legend className="form__label">Scope</legend>
            <label><input type="radio" name="scope" checked={scope === "work"} onChange={() => setScope("work")} /> Work</label>
            <label><input type="radio" name="scope" checked={scope === "strategy"} onChange={() => setScope("strategy")} /> Strategy</label>
          </fieldset>

          {scope && (
            <>
              <label className="form__row">
                <span className="form__label">Tag</span>
                <input className="form__input" aria-label="Tag" value={tag}
                  maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase())} />
              </label>
              <label className="form__row">
                <span className="form__label">Name</span>
                <input className="form__input" aria-label="Name" value={name}
                  maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="form__row">
                <span className="form__label">Description</span>
                <textarea className="form__textarea" value={description} rows={3}
                  onChange={(e) => setDescription(e.target.value)} />
              </label>
              <div className="form__row">
                <span className="form__label">Colour</span>
                <ColourPicker value={colour} onChange={setColour} />
              </div>
            </>
          )}

          {scope === "work" && (
            <label className="form__row">
              <span className="form__label">Behaves like</span>
              <select className="form__input" aria-label="Behaves like" value={behavesLike}
                onChange={(e) => setBehavesLike(e.target.value)}>
                <option value="">— choose a rung —</option>
                {workTypes.map((t) => <option key={t.id} value={t.id}>{t.prefix} — {t.name}</option>)}
              </select>
            </label>
          )}

          {scope === "strategy" && (
            <>
              <label className="form__row">
                <span className="form__label">Insert between</span>
                <select className="form__input" aria-label="Insert between" value={childTypeId}
                  onChange={(e) => { setChildTypeId(e.target.value); setPreview(null); }}>
                  <option value="">— choose a gap —</option>
                  {gapChildren.map((t) => {
                    const parent = types.find((p) => p.id === t.parent_type_id);
                    return <option key={t.id} value={t.id}>{parent?.name} → {t.name}</option>;
                  })}
                </select>
              </label>
              {preview && !preview.rejection && (
                <div className="form__row at-impact">
                  <p className="form__hint">
                    Inserting “{name}” between {preview.parent_layer.name} and {preview.child_layer.name} will
                    create {preview.passthrough_count} pass-through artefacts.
                  </p>
                  <ul className="at-impact__list">
                    {preview.impacted.map((i) => (
                      <li key={i.id}>{i.name}{i.current_parent_name ? ` (under ${i.current_parent_name})` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="topo-flyout__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            {scope === "work" && (
              <button type="button" className="btn btn--primary" onClick={submitWork}
                disabled={busy || !tag || !name || !behavesLike}>Create</button>
            )}
            {scope === "strategy" && !preview && (
              <button type="button" className="btn btn--primary" onClick={runPreview}
                disabled={busy || !tag || !name || !childTypeId}>Preview impact</button>
            )}
            {scope === "strategy" && preview && !preview.rejection && (
              <button type="button" className="btn btn--primary" onClick={confirmInsert}
                disabled={busy}>Confirm insert</button>
            )}
          </div>
        </div>
      </Panel>
    </aside>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/components/ArtefactTypeCreateFlyout`
Expected: PASS. (Adjust label/role queries if the test can't find an element — keep `aria-label`s aligned with the test.)

- [ ] **Step 5: Add styles**

Add `.at-impact`, `.at-impact__list`, `.topo-flyout__actions` rules to `app/globals.css` if not already covered by existing flyout classes. Keep them minimal; reuse existing `.topo-flyout*` rules where possible. No inline `style={{}}` (lint).

- [ ] **Step 6: Commit**

```bash
git add app/components/ArtefactTypeCreateFlyout/ app/globals.css
git commit -m "feat(fe): ArtefactTypeCreateFlyout (work + strategy insert-layer)"
```

### Task 5.2: Wire the flyout into the page; remove the Layer editor

**Files:**
- Modify: `app/(user)/workspace-admin/artefacts/artefact-types/page.tsx`

- [ ] **Step 1: Add the Add-type button + flyout state**

In the page component, add `const [creating, setCreating] = useState(false);`. In `at-tree__toolbar`, add before the Resync button:
```tsx
<button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
  Add type
</button>
```
After the `</Panel>` for the tree, render the flyout when `creating` and `types` are loaded:
```tsx
{creating && types && (
  <ArtefactTypeCreateFlyout
    types={types}
    onClose={() => setCreating(false)}
    onCreated={() => { setCreating(false); load(); }}
  />
)}
```
Add the import: `import { ArtefactTypeCreateFlyout } from "@/app/components/ArtefactTypeCreateFlyout";`

- [ ] **Step 2: Make the Layer column read-only**

In `buildColumns`, replace the `layer` column's `render` body (the `InlineEditField`) with a plain read-only label so depth is shown but not editable:
```tsx
key: "layer",
label: "Layer",
width: 80,
align: "mono",
render: (row) => {
  if (row.kind === "scope") return null;
  const v = row.type.layer_depth == null ? "—" : String(row.type.layer_depth);
  return <span className="inline-edit-trigger" aria-label={`Layer depth for ${row.type.prefix}`}>{v}</span>;
},
```
Remove the now-unused `layer_depth` patch path if nothing else uses it (the `ArtefactTypePatch.layer_depth` field can stay on the type for back-compat; just stop sending it from this page).

- [ ] **Step 3: Typecheck + build the page**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verification (app running)**

Use the run skill or open `http://localhost:5101/workspace-admin/artefacts/artefact-types`. Verify: "Add type" opens the flyout; Work fork creates a type (appears after refetch); Strategy fork previews impact then inserts. Confirm in psql that a pass-through was created and the chain re-stitched.

- [ ] **Step 5: Commit**

```bash
git add "app/(user)/workspace-admin/artefacts/artefact-types/page.tsx"
git commit -m "feat(fe): Add-type button + flyout on artefact-types page; Layer read-only"
```

---

## Phase 6 — Docs, tech-debt, final verification

### Task 6.1: Tech-debt entries

**Files:**
- Modify: `docs/c_tech_debt.md`

- [ ] **Step 1: Add/append the entries**

Append to `docs/c_tech_debt.md`:
- **TD-PARENT-CANDIDATES-DYNAMIC** — mark paid for work scope (now `execution_parent_slots`; `PARENT_PREFIX_MAP` retired; column renamed to `strategy_parent_id`).
- **TD-LAYER-DEPTH-DERIVED** (S3) — `layer_depth` now a derived mirror; remaining numeric readers `DependencyMapOverlay` + `p_ObjectTree`/`ArtefactCreateFlyout` isTopLevel. Trigger: switch those to `parent_type_id == null`, then drop the column.
- **TD-RISK-WORK-PARENT-SLOTS** (S3) — Risk has empty `execution_parent_slots`; product decision needed on where Risk nests.
- **TD-ARTEFACT-TYPES-PATCH-UNGATED** (S2) — the existing `PATCH /artefact-types/{id}` is auth+sentinel-gated but not `portfolio.model.edit`-gated, unlike the new create/insert routes. Trigger: next touch of the Patch handler — add the permission gate for consistency.

- [ ] **Step 2: Commit**

```bash
git add docs/c_tech_debt.md
git commit -m "docs(tech-debt): artefact-type create follow-ups (4 entries)"
```

### Task 6.2: SY003 regeneration (substrate changed)

- [ ] **Step 1: Regenerate SY003**

The migration added a column + renamed one — per the CLAUDE.md HARD RULE, regenerate SY003:
Run the `<report> -sy` invocation exactly as specified in CLAUDE.md (the substrate-source-of-truth rule), describing the new `artefacts_types_strategy_parent_id` / `artefacts_types_execution_parent_slots` columns.

- [ ] **Step 2: No commit needed** — SY003 lives in `mmff_dev.dev_reports` (POSTed, not a repo file).

### Task 6.3: Full regression

- [ ] **Step 1: Backend tests**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && go test ./backend/internal/artefacttypes/... ./backend/internal/portfoliomodels/...`
Expected: PASS.

- [ ] **Step 2: Frontend tests**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx vitest run app/components/ArtefactInlineForm app/components/ArtefactTypeCreateFlyout app/components/ObjectTreeV2`
Expected: PASS.

- [ ] **Step 3: Lints**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npm run lint` (and any `lint:*` the project's pre-commit runs)
Expected: clean — especially `lint:no-direct-workspace-id`, `lint:sentinel-clamp-required` (new handlers use `sentinel.WorkspaceIDFromCtx`), no inline `style={{}}`.

- [ ] **Step 4: Typecheck + build**

Run: `cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && npx tsc --noEmit && go build ./backend/...`
Expected: clean.

- [ ] **Step 5: Final commit if any fixups**

```bash
git add -A
git commit -m "chore: regression fixups for add-artefact-type"
```

---

## Self-review notes (resolved)

- **Spec §5 rename blast radius** — covered in Task 1.1 (grep-driven). The legacy `ObjectTree/p_ObjectTree.tsx` consumer (missed by the spec) is handled in Task 4.3 Step 3.
- **Pass-through NOT-NULL columns** — the one place the plan can't fully pre-resolve; Task 3.1 Step 4a captures the live schema and adjusts the INSERT before implementing.
- **Permission gate symbol** — Task 2.2 Step 3 flags that the exact `RequirePermission` symbol must be confirmed at the real call site; the gate must enforce `portfolio.model.edit`.
- **Patch ungated** — surfaced honestly as TD-ARTEFACT-TYPES-PATCH-UNGATED rather than silently retrofitted.
- **Depth cap** — enforced by rejection in `resolveGap` (Task 3.1), not silent clamp, matching spec §6.
- **Type consistency** — `ArtefactType.execution_parent_slots` (FE) ↔ `ExecutionParentSlots json:"execution_parent_slots"` (BE); `child_type_id` used consistently in `InsertLayerInput`/`InsertLayerBody`; `parent_type_id` JSON unchanged.
