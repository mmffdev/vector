# PLA-0025: Work-Items Full v2 Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 11 missing v2 work-items endpoints against vector_artefacts, migrate field values, switch the frontend, and drop the v1 obj_* tables.

**Architecture:** Go service methods in `backend/internal/workitemsv2/service.go`, handler registration in `backend/cmd/server/main.go`. All reads target `vectorArtefactsPool` (vector_artefacts DB); owner decoration cross-joins `mainPool` (mmff_vector.users). Field values live in `artefact_field_values`; custom field metadata in `field_library`. Frontend calls switch from `/api/work-items` to `/api/v2/work-items` in a single atomic commit.

**Tech Stack:** Go 1.22 / pgx v5, Next.js 14 App Router, PostgreSQL 15 (vector_artefacts DB). Existing: `workitemsv2` package, `artefacts` + `artefact_field_values` + `flow_states` + `sprints` tables.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/internal/workitemsv2/service.go` | Modify | Add 9 new service methods |
| `backend/internal/workitemsv2/handler.go` | Modify | Add 11 new HTTP handlers |
| `backend/cmd/server/main.go` | Modify | Register 11 new routes |
| `db/artefacts_schema/016_artefact_number_sequence.sql` | Create | Per-type number sequence table |
| `db/artefacts_schema/down/016_artefact_number_sequence_DOWN.sql` | Create | Rollback migration 016 |
| `app/components/work-items-tree-config.tsx` | Modify | Switch list/get/children URLs to v2 |
| `app/components/WorkItemDetailPanel.tsx` | Modify | Switch field-values URLs to v2 |
| `app/components/useWorkItemFlowStates.ts` | Modify | Switch flow-states URL to v2 |
| `app/(user)/work-items/page.tsx` | Modify | Switch summary URL to v2 |

---

## Phase 1 — DB migration: artefact number sequence

### Task 1: Migration 016 — per-type artefact number sequence

The `artefacts` table has a `number` column but no sequence table yet. `CreateWorkItem` needs atomic `number` allocation per `(subscription_id, artefact_type_id)`. This mirrors `subscription_sequence` in mmff_vector but is scoped to the new schema.

**Files:**
- Create: `db/artefacts_schema/016_artefact_number_sequence.sql`
- Create: `db/artefacts_schema/down/016_artefact_number_sequence_DOWN.sql`

- [ ] **Step 1: Create the migration**

```sql
-- db/artefacts_schema/016_artefact_number_sequence.sql
BEGIN;

CREATE TABLE artefact_number_sequence (
    subscription_id  UUID NOT NULL,
    artefact_type_id UUID NOT NULL REFERENCES artefact_types(id) ON DELETE RESTRICT,
    next_num         BIGINT NOT NULL DEFAULT 2,
    PRIMARY KEY (subscription_id, artefact_type_id)
);

COMMENT ON TABLE artefact_number_sequence IS
    'Per-(subscription, artefact_type) counter used to allocate artefact.number atomically. '
    'next_num is the NEXT number to allocate (i.e. INSERT returns next_num - 1).';

-- Pre-populate from existing artefacts so new inserts continue from the correct offset.
INSERT INTO artefact_number_sequence (subscription_id, artefact_type_id, next_num)
SELECT
    a.subscription_id,
    a.artefact_type_id,
    COALESCE(MAX(a.number), 0) + 1
FROM artefacts a
GROUP BY a.subscription_id, a.artefact_type_id
ON CONFLICT (subscription_id, artefact_type_id) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Create the DOWN migration**

```sql
-- db/artefacts_schema/down/016_artefact_number_sequence_DOWN.sql
BEGIN;
DROP TABLE IF EXISTS artefact_number_sequence;
COMMIT;
```

- [ ] **Step 3: Apply migration to dev DB**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector/backend
BACKEND_ENV=local go run ./cmd/migrate/... -db artefacts up
```

Expected output includes: `016_artefact_number_sequence`

- [ ] **Step 4: Verify table exists**

```bash
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "SELECT subscription_id, artefact_type_id, next_num FROM artefact_number_sequence LIMIT 5;"
```

Expected: rows matching existing artefacts' max numbers.

- [ ] **Step 5: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add db/artefacts_schema/016_artefact_number_sequence.sql \
        db/artefacts_schema/down/016_artefact_number_sequence_DOWN.sql
git commit -m "feat(PLA-0025/migration-016): artefact_number_sequence table for v2 Create"
```

---

## Phase 2 — v2 Read endpoints

### Task 2: Service — GetWorkItem, ListChildren, SummariseWorkItems, ListFlowStates

Add four read methods to `backend/internal/workitemsv2/service.go`. All query `vectorArtefactsPool`. `GetWorkItem` and `ListChildren` call `decorateOwners` (already exists in service.go:211).

**Files:**
- Modify: `backend/internal/workitemsv2/service.go`

- [ ] **Step 1: Add WorkItemsSummary type to types.go**

Append to `backend/internal/workitemsv2/types.go` (after the `BulkFailure` struct, before the `UpsertFieldValueInput` struct):

```go
// WorkItemsSummary is the wire shape for GET /api/v2/work-items/summary.
type WorkItemsSummary struct {
	Total   int `json:"total"`
	Epics   int `json:"epics"`
	Stories int `json:"stories"`
	Tasks   int `json:"tasks"`
	Defects int `json:"defects"`
	Blocked int `json:"blocked"`
}
```

- [ ] **Step 2: Add GetWorkItem to service.go**

Append after the closing brace of `ListWorkItems` (line ~206 in service.go):

```go
// GetWorkItem returns a single work item by ID enforcing subscription isolation.
// Returns ErrNotFound when the row does not exist or belongs to another tenant.
func (s *Service) GetWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	row := s.vectorArtefactsPool.QueryRow(ctx, `
		WITH `+rollupCTE+`
		SELECT
			a.id::text,
			a.subscription_id::text,
			a.number                        AS key_num,
			lower(at.name)                  AS item_type,
			a.title,
			a.description,
			''                              AS status,
			COALESCE(fs.id::text, '')        AS flow_state_id,
			COALESCE(fs.name, '')            AS flow_state_name,
			CASE fs.kind
				WHEN 'todo'        THEN 'backlog'
				WHEN 'in_progress' THEN 'doing'
				WHEN 'done'        THEN 'completed'
				WHEN 'cancelled'   THEN 'cancelled'
				ELSE                    'backlog'
			END                             AS flow_state_code,
			a.priority,
			a.story_points,
			a.sprint_id::text,
			NULL::text                      AS sprint_ref_id,
			NULL::text                      AS sprint_ref_alias,
			a.parent_artefact_id::text      AS parent_id,
			NULL::text                      AS root_feature_id,
			COALESCE(a.owned_by_user_id::text, '') AS owner_id,
			NULL::text                      AS owner_ref_id,
			NULL::text                      AS owner_display_name,
			NULL::text                      AS owner_avatar_url,
			a.due_date::text,
			COALESCE(a.created_by_user_id::text, '') AS created_by,
			a.created_at,
			a.updated_at,
			a.archived_at,
			(SELECT count(*) FROM artefacts child
			 WHERE child.parent_artefact_id = a.id
			   AND child.archived_at IS NULL)        AS children_count,
			COALESCE(rp.rollup_points, a.story_points) AS rollup_points
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.id = $2
		  AND a.subscription_id = $1
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'`,
		subscriptionID, id,
	)
	wi, err := scanWorkItemRow(row)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items := []WorkItem{*wi}
	if err := s.decorateOwners(ctx, items); err != nil {
		return nil, err
	}
	wi = &items[0]
	return wi, nil
}
```

- [ ] **Step 3: Add ListChildren to service.go**

Append after `GetWorkItem`:

```go
// ListChildren returns direct children of parentID scoped to the subscription.
func (s *Service) ListChildren(ctx context.Context, subscriptionID uuid.UUID, parentID uuid.UUID) ([]WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItem{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		WITH `+rollupCTE+`
		SELECT
			a.id::text,
			a.subscription_id::text,
			a.number                        AS key_num,
			lower(at.name)                  AS item_type,
			a.title,
			a.description,
			''                              AS status,
			COALESCE(fs.id::text, '')        AS flow_state_id,
			COALESCE(fs.name, '')            AS flow_state_name,
			CASE fs.kind
				WHEN 'todo'        THEN 'backlog'
				WHEN 'in_progress' THEN 'doing'
				WHEN 'done'        THEN 'completed'
				WHEN 'cancelled'   THEN 'cancelled'
				ELSE                    'backlog'
			END                             AS flow_state_code,
			a.priority,
			a.story_points,
			a.sprint_id::text,
			NULL::text                      AS sprint_ref_id,
			NULL::text                      AS sprint_ref_alias,
			a.parent_artefact_id::text      AS parent_id,
			NULL::text                      AS root_feature_id,
			COALESCE(a.owned_by_user_id::text, '') AS owner_id,
			NULL::text                      AS owner_ref_id,
			NULL::text                      AS owner_display_name,
			NULL::text                      AS owner_avatar_url,
			a.due_date::text,
			COALESCE(a.created_by_user_id::text, '') AS created_by,
			a.created_at,
			a.updated_at,
			a.archived_at,
			(SELECT count(*) FROM artefacts child
			 WHERE child.parent_artefact_id = a.id
			   AND child.archived_at IS NULL)        AS children_count,
			COALESCE(rp.rollup_points, a.story_points) AS rollup_points
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		LEFT JOIN rollup_points rp ON rp.id = a.id
		WHERE a.subscription_id = $1
		  AND a.parent_artefact_id = $2
		  AND a.archived_at IS NULL
		  AND at.scope = 'work'
		ORDER BY a.position ASC, a.number ASC`,
		subscriptionID, parentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanWorkItemRows(rows)
	if err != nil {
		return nil, err
	}
	if err := s.decorateOwners(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}
```

- [ ] **Step 4: Add SummariseWorkItems to service.go**

Append after `ListChildren`:

```go
// SummariseWorkItems returns counts for the Page Summary Header strip.
// Optional sprintID narrows counts to items in that sprint.
func (s *Service) SummariseWorkItems(ctx context.Context, subscriptionID uuid.UUID, sprintID *string) (WorkItemsSummary, error) {
	if s.vectorArtefactsPool == nil {
		return WorkItemsSummary{}, nil
	}
	args := []any{subscriptionID}
	conds := []string{
		"a.subscription_id = $1",
		"a.archived_at IS NULL",
		"at.scope = 'work'",
	}
	n := 2
	if sprintID != nil && *sprintID != "" {
		conds = append(conds, fmt.Sprintf("a.sprint_id = $%d::uuid", n))
		args = append(args, *sprintID)
		n++
	}
	q := fmt.Sprintf(`
		SELECT
			COUNT(*)                                               AS total,
			COUNT(*) FILTER (WHERE lower(at.name) = 'epic')        AS epics,
			COUNT(*) FILTER (WHERE lower(at.name) = 'story')       AS stories,
			COUNT(*) FILTER (WHERE lower(at.name) = 'task')        AS tasks,
			COUNT(*) FILTER (WHERE lower(at.name) = 'defect')      AS defects,
			COUNT(*) FILTER (
				WHERE (fs.kind = 'todo' OR fs.id IS NULL)
				  AND a.updated_at < NOW() - INTERVAL '14 days'
			) AS blocked
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
		WHERE %s`,
		strings.Join(conds, " AND "),
	)
	var out WorkItemsSummary
	if err := s.vectorArtefactsPool.QueryRow(ctx, q, args...).Scan(
		&out.Total, &out.Epics, &out.Stories, &out.Tasks, &out.Defects, &out.Blocked,
	); err != nil {
		return WorkItemsSummary{}, err
	}
	return out, nil
}
```

- [ ] **Step 5: Add ListFlowStates to service.go**

Append after `SummariseWorkItems`:

```go
// ListFlowStates returns the flow states for the work artefact type belonging
// to the subscription. Queries flow_states via the default flow for the
// first work-scoped artefact_type owned by this subscription.
func (s *Service) ListFlowStates(ctx context.Context, subscriptionID uuid.UUID) ([]WorkItemFlowState, error) {
	if s.vectorArtefactsPool == nil {
		return []WorkItemFlowState{}, nil
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		SELECT fs.id, fs.sort_order, fs.name, fs.kind
		FROM flow_states fs
		JOIN flows f ON f.id = fs.flow_id
		JOIN artefact_types at ON at.id = f.artefact_type_id
		WHERE at.subscription_id = $1
		  AND at.scope = 'work'
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.archived_at IS NULL
		ORDER BY fs.sort_order ASC`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var states []WorkItemFlowState
	for rows.Next() {
		var st WorkItemFlowState
		if err := rows.Scan(&st.ID, &st.Position, &st.Name, &st.CanonicalCode); err != nil {
			return nil, err
		}
		states = append(states, st)
	}
	if states == nil {
		states = []WorkItemFlowState{}
	}
	return states, rows.Err()
}
```

- [ ] **Step 6: Add handlers for the 4 read endpoints in handler.go**

Append to `backend/internal/workitemsv2/handler.go`:

```go
// Get handles GET /api/v2/work-items/{id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	wi, err := h.svc.GetWorkItem(r.Context(), subID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// ListChildren handles GET /api/v2/work-items/{id}/children.
func (h *Handler) ListChildren(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	items, err := h.svc.ListChildren(r.Context(), subID, id)
	if err != nil {
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

// Summary handles GET /api/v2/work-items/summary.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	var sprintID *string
	if v := r.URL.Query().Get("sprint_id"); v != "" {
		sprintID = &v
	}
	out, err := h.svc.SummariseWorkItems(r.Context(), subID, sprintID)
	if err != nil {
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// ListFlowStates handles GET /api/v2/work-items/flow-states.
func (h *Handler) ListFlowStates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	states, err := h.svc.ListFlowStates(r.Context(), subID)
	if err != nil {
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"states": states})
}
```

Note: handler.go needs these imports added: `"errors"`, `"github.com/go-chi/chi/v5"`, `"github.com/google/uuid"`. Update the import block at the top of handler.go to include them.

- [ ] **Step 7: Register the 4 read routes in main.go**

In `backend/cmd/server/main.go`, find the v2 route block (line ~806) and expand it:

```go
// Before (line ~806-812):
if os.Getenv("WORK_ITEMS_V2") == "true" {
    r.Route("/api/v2/work-items", func(r chi.Router) {
        r.Use(authSvc.RequireAuth)
        r.Use(authSvc.RequireFreshPassword)
        r.Use(httprate.LimitByIP(120, time.Minute))
        r.Get("/", workItemsV2H.List)
    })
}

// After:
if os.Getenv("WORK_ITEMS_V2") == "true" {
    r.Route("/api/v2/work-items", func(r chi.Router) {
        r.Use(authSvc.RequireAuth)
        r.Use(authSvc.RequireFreshPassword)
        r.Use(httprate.LimitByIP(120, time.Minute))
        r.Get("/", workItemsV2H.List)
        r.Get("/summary", workItemsV2H.Summary)
        r.Get("/flow-states", workItemsV2H.ListFlowStates)
        r.Get("/{id}", workItemsV2H.Get)
        r.Get("/{id}/children", workItemsV2H.ListChildren)
    })
}
```

- [ ] **Step 8: Build and verify**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector/backend
go build ./...
```

Expected: no errors.

- [ ] **Step 9: Smoke-test the 4 new read endpoints**

First obtain a token (replace password if needed):

```bash
TOKEN=$(curl -s -X POST http://localhost:5100/v1/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"claude_3_test@mmffdev.com","password":"TestPass123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
```

Test summary:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:5100/v1/api/v2/work-items/summary | python3 -m json.tool
```

Expected: `{"total":N,"epics":N,"stories":N,"tasks":N,"defects":N,"blocked":N}`

Test flow-states:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:5100/v1/api/v2/work-items/flow-states | python3 -m json.tool
```

Expected: `{"states":[{"id":"...","flow_position":N,"name":"...","canonical_code":"..."},...]}` 

Test get by id (pick any id from list):

```bash
FIRST_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/v1/api/v2/work-items?limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['items'][0]['id'] if d['items'] else '')" 2>/dev/null)

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/v1/api/v2/work-items/$FIRST_ID" | python3 -m json.tool
```

Expected: single WorkItem object.

Test children (use an epic id):

```bash
EPIC_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/v1/api/v2/work-items?limit=5&item_type=epic" | python3 -c "import sys,json; d=json.load(sys.stdin); items=[x for x in d['items'] if x['children_count']>0]; print(items[0]['id'] if items else '')" 2>/dev/null)

curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5100/v1/api/v2/work-items/$EPIC_ID/children" | python3 -m json.tool
```

Expected: `{"items":[...]}` with children.

- [ ] **Step 10: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add backend/internal/workitemsv2/service.go \
        backend/internal/workitemsv2/handler.go \
        backend/internal/workitemsv2/types.go \
        backend/cmd/server/main.go
git commit -m "feat(PLA-0025/read-endpoints): v2 Get, ListChildren, Summary, ListFlowStates"
```

---

## Phase 3 — v2 Write endpoints

### Task 3: Service — CreateWorkItem, PatchWorkItem, ArchiveWorkItem, BulkOps

These write to the `artefacts` table in vector_artefacts. `CreateWorkItem` uses the `artefact_number_sequence` table added in Task 1.

**Files:**
- Modify: `backend/internal/workitemsv2/service.go`

- [ ] **Step 1: Add CreateWorkItem to service.go**

Append after `ListFlowStates`:

```go
// CreateWorkItem inserts a new artefact row in vector_artefacts.
// number is allocated atomically via artefact_number_sequence.
// The default flow_state is the is_initial=true state for the subscription's
// work artefact type default flow.
func (s *Service) CreateWorkItem(ctx context.Context, subscriptionID uuid.UUID, in CreateWorkItemInput) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, fmt.Errorf("vector_artefacts pool not configured")
	}
	if !validItemTypes[in.ItemType] {
		return nil, fmt.Errorf("%w: item_type must be epic, story, task, or defect", ErrInvalidInput)
	}
	if in.StoryPoints != nil && !canHaveManualPoints(in.ItemType) {
		return nil, fmt.Errorf("%w: story_points cannot be set on %s items", ErrInvalidInput, in.ItemType)
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}

	tx, err := s.vectorArtefactsPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Resolve artefact_type_id for this subscription + item_type.
	var artefactTypeID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM artefact_types
		WHERE subscription_id = $1
		  AND scope = 'work'
		  AND lower(name) = $2
		  AND archived_at IS NULL
		LIMIT 1`,
		subscriptionID, in.ItemType,
	).Scan(&artefactTypeID)
	if err != nil {
		return nil, fmt.Errorf("resolve artefact_type for %q: %w", in.ItemType, err)
	}

	// Allocate number atomically.
	var num int64
	err = tx.QueryRow(ctx, `
		INSERT INTO artefact_number_sequence (subscription_id, artefact_type_id, next_num)
		VALUES ($1, $2, 2)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = artefact_number_sequence.next_num + 1
		RETURNING next_num - 1`,
		subscriptionID, artefactTypeID,
	).Scan(&num)
	if err != nil {
		return nil, err
	}

	// Resolve default (is_initial) flow state for this type.
	var defaultFlowStateID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT fs.id FROM flow_states fs
		JOIN flows f ON f.id = fs.flow_id
		WHERE f.artefact_type_id = $1
		  AND f.is_default = TRUE
		  AND f.archived_at IS NULL
		  AND fs.is_initial = TRUE
		  AND fs.archived_at IS NULL
		LIMIT 1`,
		artefactTypeID,
	).Scan(&defaultFlowStateID)
	if err != nil {
		return nil, fmt.Errorf("resolve default flow state: %w", err)
	}

	// Resolve workspace_id — required NOT NULL. Use first workspace for subscription
	// (same heuristic as the ETL backfill).
	var workspaceID uuid.UUID
	err = s.mainPool.QueryRow(ctx, `
		SELECT id FROM workspaces
		WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY created_at ASC LIMIT 1`,
		subscriptionID,
	).Scan(&workspaceID)
	if err != nil {
		// Fall back to subscription_id as workspace_id sentinel (matches ETL).
		workspaceID = subscriptionID
	}

	var newID uuid.UUID
	ownerID := uuid.Nil
	if in.OwnerID != "" {
		ownerID, _ = uuid.Parse(in.OwnerID)
	}
	createdBy := uuid.Nil
	if in.CreatedBy != "" {
		createdBy, _ = uuid.Parse(in.CreatedBy)
	}

	var parentID *uuid.UUID
	if in.ParentID != nil {
		pid, err := uuid.Parse(*in.ParentID)
		if err == nil {
			parentID = &pid
		}
	}
	var sprintID *uuid.UUID
	if in.SprintID != nil {
		sid, err := uuid.Parse(*in.SprintID)
		if err == nil {
			sprintID = &sid
		}
	}

	// Append to existing items (position = MAX + 100).
	var pos int
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position), 0) + 100 FROM artefacts
		WHERE subscription_id = $1
		  AND artefact_type_id = $2
		  AND archived_at IS NULL`,
		subscriptionID, artefactTypeID,
	).Scan(&pos)

	err = tx.QueryRow(ctx, `
		INSERT INTO artefacts
			(subscription_id, workspace_id, artefact_type_id, number, title, description,
			 flow_state_id, priority, story_points, sprint_id, parent_artefact_id,
			 owned_by_user_id, created_by_user_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id`,
		subscriptionID, workspaceID, artefactTypeID, num,
		in.Title, in.Description,
		defaultFlowStateID, in.Priority, in.StoryPoints, sprintID, parentID,
		ownerID, createdBy, pos,
	).Scan(&newID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetWorkItem(ctx, subscriptionID, newID)
}
```

- [ ] **Step 2: Add PatchWorkItem to service.go**

Append after `CreateWorkItem`:

```go
// PatchWorkItem applies a partial update to an artefact row.
func (s *Service) PatchWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID, in PatchWorkItemInput) (*WorkItem, error) {
	if s.vectorArtefactsPool == nil {
		return nil, ErrNotFound
	}
	if in.Status != nil && !validStatuses[*in.Status] {
		return nil, fmt.Errorf("%w: invalid status", ErrInvalidInput)
	}
	if in.Priority != nil && *in.Priority != "" && !validPriorities[*in.Priority] {
		return nil, fmt.Errorf("%w: invalid priority", ErrInvalidInput)
	}

	sets := []string{"updated_at = now()"}
	args := []any{}
	n := 1

	if in.Title != nil {
		sets = append(sets, fmt.Sprintf("title = $%d", n))
		args = append(args, *in.Title)
		n++
	}
	if in.Description != nil {
		sets = append(sets, fmt.Sprintf("description = $%d", n))
		args = append(args, *in.Description)
		n++
	}
	if in.FlowStateID != nil {
		// Validate the flow_state belongs to this subscription.
		var fsExists bool
		err := s.vectorArtefactsPool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM flow_states fs
				JOIN flows f ON f.id = fs.flow_id
				JOIN artefact_types at ON at.id = f.artefact_type_id
				WHERE fs.id = $1
				  AND at.subscription_id = $2
				  AND fs.archived_at IS NULL
			)`, *in.FlowStateID, subscriptionID,
		).Scan(&fsExists)
		if err != nil || !fsExists {
			return nil, fmt.Errorf("%w: flow_state_id not found", ErrInvalidInput)
		}
		sets = append(sets, fmt.Sprintf("flow_state_id = $%d::uuid", n))
		args = append(args, *in.FlowStateID)
		n++
	}
	if in.Priority != nil {
		if *in.Priority == "" {
			sets = append(sets, "priority = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("priority = $%d", n))
			args = append(args, *in.Priority)
			n++
		}
	}
	if in.StoryPoints != nil {
		sets = append(sets, fmt.Sprintf("story_points = $%d", n))
		args = append(args, *in.StoryPoints)
		n++
	}
	if in.SprintID != nil {
		if *in.SprintID == "" {
			sets = append(sets, "sprint_id = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("sprint_id = $%d::uuid", n))
			args = append(args, *in.SprintID)
			n++
		}
	}
	if in.DueDate != nil {
		if *in.DueDate == "" {
			sets = append(sets, "due_date = NULL")
		} else {
			sets = append(sets, fmt.Sprintf("due_date = $%d::date", n))
			args = append(args, *in.DueDate)
			n++
		}
	}

	// WHERE clause args: id=$N, subscription_id=$N+1
	args = append(args, id, subscriptionID)
	idN := n
	subN := n + 1

	ct, err := s.vectorArtefactsPool.Exec(ctx,
		fmt.Sprintf(`UPDATE artefacts SET %s
			WHERE id = $%d AND subscription_id = $%d AND archived_at IS NULL`,
			strings.Join(sets, ", "), idN, subN),
		args...,
	)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetWorkItem(ctx, subscriptionID, id)
}
```

- [ ] **Step 3: Add ArchiveWorkItem to service.go**

Append after `PatchWorkItem`:

```go
// ArchiveWorkItem sets archived_at on an artefact row (soft delete).
func (s *Service) ArchiveWorkItem(ctx context.Context, subscriptionID uuid.UUID, id uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrNotFound
	}
	ct, err := s.vectorArtefactsPool.Exec(ctx, `
		UPDATE artefacts
		SET archived_at = now(), updated_at = now()
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL`,
		id, subscriptionID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
```

- [ ] **Step 4: Add BulkOps to service.go**

Append after `ArchiveWorkItem`:

```go
type bulkRowInfo struct {
	id       string
	itemType string
}

// BulkOps applies one op (set_priority | set_owner | archive | set_flow_state)
// to a batch of artefact ids in a single transaction.
// Returns {updated, failed} even on partial failure (best-effort, not all-or-nothing).
func (s *Service) BulkOps(ctx context.Context, subscriptionID uuid.UUID, ids []string, op string, payload map[string]any) (BulkOpResult, error) {
	switch op {
	case "set_priority", "set_owner", "archive", "set_flow_state", "set_status":
		// supported
	default:
		return BulkOpResult{}, fmt.Errorf("%w: unsupported op %q", ErrInvalidInput, op)
	}
	if len(ids) == 0 {
		return BulkOpResult{Updated: 0}, nil
	}
	if s.vectorArtefactsPool == nil {
		return BulkOpResult{}, fmt.Errorf("vector_artefacts pool not configured")
	}

	supplied := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		supplied[id] = struct{}{}
	}

	tx, err := s.vectorArtefactsPool.Begin(ctx)
	if err != nil {
		return BulkOpResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT id::text, lower(at.name)
		FROM artefacts a
		JOIN artefact_types at ON at.id = a.artefact_type_id
		WHERE a.subscription_id = $1 AND a.id::text = ANY($2) AND a.archived_at IS NULL
		FOR UPDATE`,
		subscriptionID, ids,
	)
	if err != nil {
		return BulkOpResult{}, err
	}
	var visible []bulkRowInfo
	for rows.Next() {
		var r bulkRowInfo
		if err := rows.Scan(&r.id, &r.itemType); err != nil {
			rows.Close()
			return BulkOpResult{}, err
		}
		visible = append(visible, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return BulkOpResult{}, err
	}

	visibleSet := make(map[string]struct{}, len(visible))
	for _, r := range visible {
		visibleSet[r.id] = struct{}{}
	}

	var result BulkOpResult
	for id := range supplied {
		if _, ok := visibleSet[id]; !ok {
			result.Failed = append(result.Failed, BulkFailure{ID: id, Reason: "forbidden"})
		}
	}

	for _, row := range visible {
		var execErr error
		switch op {
		case "set_priority":
			val, _ := payload["priority"].(string)
			if !validPriorities[val] {
				result.Failed = append(result.Failed, BulkFailure{ID: row.id, Reason: "invalid priority"})
				continue
			}
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET priority=$1, updated_at=now() WHERE id=$2::uuid`,
				val, row.id)
		case "set_owner":
			ownerID, _ := payload["owner_id"].(string)
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET owned_by_user_id=$1::uuid, updated_at=now() WHERE id=$2::uuid`,
				ownerID, row.id)
		case "archive":
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET archived_at=now(), updated_at=now() WHERE id=$1::uuid`,
				row.id)
		case "set_flow_state", "set_status":
			fsID, _ := payload["flow_state_id"].(string)
			if fsID == "" {
				fsID, _ = payload["status"].(string)
			}
			_, execErr = tx.Exec(ctx,
				`UPDATE artefacts SET flow_state_id=$1::uuid, updated_at=now() WHERE id=$2::uuid`,
				fsID, row.id)
		}
		if execErr != nil {
			result.Failed = append(result.Failed, BulkFailure{ID: row.id, Reason: execErr.Error()})
		} else {
			result.Updated++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return BulkOpResult{}, err
	}
	if result.Failed == nil {
		result.Failed = []BulkFailure{}
	}
	return result, nil
}
```

- [ ] **Step 5: Build**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector/backend
go build ./...
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add backend/internal/workitemsv2/service.go backend/internal/workitemsv2/types.go
git commit -m "feat(PLA-0025/writes): v2 Create, Patch, Archive, BulkOps service methods"
```

---

### Task 4: v2 write handlers + field values handlers

**Files:**
- Modify: `backend/internal/workitemsv2/handler.go`
- Modify: `backend/internal/workitemsv2/service.go` (field values methods)
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Add write handlers to handler.go**

Append to `backend/internal/workitemsv2/handler.go`:

```go
type createWorkItemReq struct {
	ItemType    string  `json:"item_type"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	StoryPoints *int    `json:"story_points,omitempty"`
	SprintID    *string `json:"sprint_id,omitempty"`
	ParentID    *string `json:"parent_id,omitempty"`
}

// Create handles POST /api/v2/work-items.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req createWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	wi, err := h.svc.CreateWorkItem(r.Context(), u.SubscriptionID, CreateWorkItemInput{
		ItemType:    req.ItemType,
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		Priority:    req.Priority,
		StoryPoints: req.StoryPoints,
		SprintID:    req.SprintID,
		ParentID:    req.ParentID,
		OwnerID:     u.ID.String(),
		CreatedBy:   u.ID.String(),
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(wi)
}

type patchWorkItemReq struct {
	Title       *string         `json:"title,omitempty"`
	Description *string         `json:"description,omitempty"`
	Status      *string         `json:"status,omitempty"`
	FlowStateID *string         `json:"flow_state_id,omitempty"`
	Priority    *string         `json:"priority,omitempty"`
	StoryPoints *int            `json:"story_points,omitempty"`
	SprintID    *string         `json:"sprint_id,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
}

// Patch handles PATCH /api/v2/work-items/{id}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var req patchWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	var dueDate *string
	if len(req.DueDate) > 0 {
		raw := string(req.DueDate)
		if raw == "null" || raw == `""` {
			empty := ""
			dueDate = &empty
		} else {
			var s string
			if err := json.Unmarshal(req.DueDate, &s); err != nil {
				http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
				return
			}
			dueDate = &s
		}
	}
	wi, err := h.svc.PatchWorkItem(r.Context(), u.SubscriptionID, id, PatchWorkItemInput{
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
		FlowStateID: req.FlowStateID,
		Priority:    req.Priority,
		StoryPoints: req.StoryPoints,
		SprintID:    req.SprintID,
		DueDate:     dueDate,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		case errors.Is(err, ErrInvalidInput):
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
		default:
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		}
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// Archive handles DELETE /api/v2/work-items/{id}.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	if err := h.svc.ArchiveWorkItem(r.Context(), u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkOpsReq struct {
	IDs     []string       `json:"ids"`
	Op      string         `json:"op"`
	Payload map[string]any `json:"payload"`
}

// Bulk handles POST /api/v2/work-items/bulk.
func (h *Handler) Bulk(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req bulkOpsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.svc.BulkOps(r.Context(), u.SubscriptionID, req.IDs, req.Op, req.Payload)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}
```

- [ ] **Step 2: Add field-values service methods to service.go**

Append after `BulkOps`:

```go
// ListFieldValues returns all artefact_field_values for an artefact,
// enforcing subscription isolation by first verifying the artefact exists.
func (s *Service) ListFieldValues(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID) ([]FieldValue, error) {
	if s.vectorArtefactsPool == nil {
		return []FieldValue{}, nil
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return nil, err
	}
	rows, err := s.vectorArtefactsPool.Query(ctx, `
		SELECT fv.id, fv.artefact_id::text, fl.id::text, NULL::text,
		       fl.name, fl.label, fl.field_type, fl.options_json,
		       fv.string_value, fv.number_value::text, fv.text_value, fv.date_value::text
		FROM artefact_field_values fv
		JOIN field_library fl ON fl.id = fv.field_library_id
		WHERE fv.artefact_id = $1
		ORDER BY fl.name ASC`,
		artefactID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var fvs []FieldValue
	for rows.Next() {
		var fv FieldValue
		if err := rows.Scan(&fv.ID, &fv.WorkItemID, &fv.FieldLibraryID, &fv.TemplateID,
			&fv.FieldName, &fv.Label, &fv.FieldType, &fv.OptionsJSON,
			&fv.StringValue, &fv.NumberValue, &fv.TextValue, &fv.DateValue); err != nil {
			return nil, err
		}
		fvs = append(fvs, fv)
	}
	if fvs == nil {
		fvs = []FieldValue{}
	}
	return fvs, rows.Err()
}

// UpsertFieldValue writes one field value for an artefact.
// Enforces type routing and subscription isolation.
func (s *Service) UpsertFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, in UpsertFieldValueInput) error {
	if s.vectorArtefactsPool == nil {
		return fmt.Errorf("vector_artefacts pool not configured")
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}
	fieldID, err := uuid.Parse(in.FieldLibraryID)
	if err != nil {
		return fmt.Errorf("%w: invalid field_library_id", ErrInvalidInput)
	}
	// Load field type for column routing.
	var fieldType string
	err = s.vectorArtefactsPool.QueryRow(ctx,
		`SELECT field_type FROM field_library WHERE id = $1 AND subscription_id = $2`,
		fieldID, subscriptionID,
	).Scan(&fieldType)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("%w: field_library_id not found", ErrInvalidInput)
	}
	if err != nil {
		return err
	}

	_, err = s.vectorArtefactsPool.Exec(ctx, `
		INSERT INTO artefact_field_values
			(artefact_id, field_library_id, string_value, number_value, text_value, date_value)
		VALUES ($1,$2,$3,$4::numeric,$5,$6::date)
		ON CONFLICT (artefact_id, field_library_id)
		DO UPDATE SET
			string_value = EXCLUDED.string_value,
			number_value = EXCLUDED.number_value,
			text_value   = EXCLUDED.text_value,
			date_value   = EXCLUDED.date_value,
			updated_at   = now()`,
		artefactID, in.FieldLibraryID,
		in.StringValue, in.NumberValue, in.TextValue, in.DateValue,
	)
	return err
}

// DeleteFieldValue removes a field value row by id, enforcing ownership.
func (s *Service) DeleteFieldValue(ctx context.Context, subscriptionID uuid.UUID, artefactID uuid.UUID, fvID uuid.UUID) error {
	if s.vectorArtefactsPool == nil {
		return ErrFieldNotFound
	}
	if _, err := s.GetWorkItem(ctx, subscriptionID, artefactID); err != nil {
		return err
	}
	ct, err := s.vectorArtefactsPool.Exec(ctx,
		`DELETE FROM artefact_field_values WHERE id = $1 AND artefact_id = $2`,
		fvID, artefactID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrFieldNotFound
	}
	return nil
}
```

- [ ] **Step 3: Add field-values handlers to handler.go**

Append to `backend/internal/workitemsv2/handler.go`:

```go
// ListFieldValues handles GET /api/v2/work-items/{id}/field-values.
func (h *Handler) ListFieldValues(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	fvs, err := h.svc.ListFieldValues(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"field_values": fvs})
}

type upsertFieldValueReq struct {
	FieldLibraryID string  `json:"field_library_id"`
	StringValue    *string `json:"string_value,omitempty"`
	NumberValue    *string `json:"number_value,omitempty"`
	TextValue      *string `json:"text_value,omitempty"`
	DateValue      *string `json:"date_value,omitempty"`
}

// UpsertFieldValues handles PUT /api/v2/work-items/{id}/field-values.
func (h *Handler) UpsertFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var req upsertFieldValueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if err := h.svc.UpsertFieldValue(r.Context(), u.SubscriptionID, id, UpsertFieldValueInput{
		FieldLibraryID: req.FieldLibraryID,
		StringValue:    req.StringValue,
		NumberValue:    req.NumberValue,
		TextValue:      req.TextValue,
		DateValue:      req.DateValue,
	}); err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidInput) {
			http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusBadRequest)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteFieldValue handles DELETE /api/v2/work-items/{id}/field-values/{field_library_id}.
func (h *Handler) DeleteFieldValue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	fvID, err := uuid.Parse(chi.URLParam(r, "field_library_id"))
	if err != nil {
		http.Error(w, `{"error":"invalid field_library_id"}`, http.StatusBadRequest)
		return
	}
	if err := h.svc.DeleteFieldValue(r.Context(), u.SubscriptionID, id, fvID); err != nil {
		if errors.Is(err, ErrFieldNotFound) || errors.Is(err, ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 4: Register all write routes in main.go**

Replace the v2 route block (the `if os.Getenv("WORK_ITEMS_V2") == "true"` block from Task 2) with the full route set:

```go
if os.Getenv("WORK_ITEMS_V2") == "true" {
    r.Route("/api/v2/work-items", func(r chi.Router) {
        r.Use(authSvc.RequireAuth)
        r.Use(authSvc.RequireFreshPassword)
        r.Use(httprate.LimitByIP(120, time.Minute))
        r.Get("/", workItemsV2H.List)
        r.Post("/", workItemsV2H.Create)
        r.Post("/bulk", workItemsV2H.Bulk)
        r.Get("/summary", workItemsV2H.Summary)
        r.Get("/flow-states", workItemsV2H.ListFlowStates)
        r.Get("/{id}", workItemsV2H.Get)
        r.Patch("/{id}", workItemsV2H.Patch)
        r.Delete("/{id}", workItemsV2H.Archive)
        r.Get("/{id}/children", workItemsV2H.ListChildren)
        r.Get("/{id}/field-values", workItemsV2H.ListFieldValues)
        r.Put("/{id}/field-values", workItemsV2H.UpsertFieldValues)
        r.Delete("/{id}/field-values/{field_library_id}", workItemsV2H.DeleteFieldValue)
    })
}
```

- [ ] **Step 5: Build**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector/backend
go build ./...
```

Expected: no errors.

- [ ] **Step 6: Smoke-test write endpoints**

Obtain token (same as Task 2, Step 9):

```bash
TOKEN=$(curl -s -X POST http://localhost:5100/v1/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"claude_3_test@mmffdev.com","password":"TestPass123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
```

Test create:

```bash
NEW_ID=$(curl -s -X POST http://localhost:5100/v1/api/v2/work-items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"item_type":"task","title":"v2 smoke test task","priority":"low"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','ERROR'))" 2>/dev/null)
echo "Created: $NEW_ID"
```

Expected: a UUID string.

Test patch:

```bash
curl -s -X PATCH "http://localhost:5100/v1/api/v2/work-items/$NEW_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"v2 smoke test task (patched)"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('title:', d.get('title'))"
```

Expected: `title: v2 smoke test task (patched)`

Test archive:

```bash
curl -s -X DELETE "http://localhost:5100/v1/api/v2/work-items/$NEW_ID" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}"
```

Expected: `204`

- [ ] **Step 7: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add backend/internal/workitemsv2/service.go \
        backend/internal/workitemsv2/handler.go \
        backend/cmd/server/main.go
git commit -m "feat(PLA-0025/writes): v2 Create/Patch/Archive/Bulk/FieldValues handlers + routes"
```

---

## Phase 4 — Frontend switch

### Task 5: Switch frontend API calls from v1 to v2

All frontend work-items API calls move from `/api/work-items` to `/api/v2/work-items`. These are the four files identified during design. The change is additive (v1 routes remain live) so the switch is safe and reversible.

**Files:**
- Modify: `app/components/work-items-tree-config.tsx` (lines 771, 784, 794, 810, 825)
- Modify: `app/components/WorkItemDetailPanel.tsx` (lines 260, 280)
- Modify: `app/components/useWorkItemFlowStates.ts` (line 30)
- Modify: `app/(user)/work-items/page.tsx` (line 58)

- [ ] **Step 1: Update work-items-tree-config.tsx**

Find and replace the five API call URLs. The file uses a relative `/api/work-items` prefix. Note these are within the file — read the file first to confirm exact line context, then make targeted edits.

Replace (each occurrence):
- `` `/api/work-items?limit= `` → `` `/api/v2/work-items?limit= ``  (3 occurrences on lines ~771, ~784, ~794)
- `` `/api/work-items/${id}` `` → `` `/api/v2/work-items/${id}` `` (line ~810)
- `` `/api/work-items/${parentId}/children` `` → `` `/api/v2/work-items/${parentId}/children` `` (line ~825)

- [ ] **Step 2: Update WorkItemDetailPanel.tsx**

Replace:
- `` `/api/work-items/${item.id}/field-values` `` → `` `/api/v2/work-items/${item.id}/field-values` `` (2 occurrences, lines ~260 and ~280)

- [ ] **Step 3: Update useWorkItemFlowStates.ts**

Replace:
- `"/api/work-items/flow-states"` → `"/api/v2/work-items/flow-states"` (line ~30)

- [ ] **Step 4: Update work-items page.tsx**

Replace:
- `` `/api/work-items/summary `` → `` `/api/v2/work-items/summary `` (line ~58)

- [ ] **Step 5: Build frontend (type check)**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to the changed files.

- [ ] **Step 6: Manual smoke-test in browser**

Navigate to `http://localhost:5101/work-items`. Verify:
1. Work-items list loads (items appear).
2. Summary header strip shows correct counts.
3. Clicking an item opens the detail panel with correct data.
4. Flow-state dropdown populates.
5. Creating a new item succeeds.

- [ ] **Step 7: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add app/components/work-items-tree-config.tsx \
        app/components/WorkItemDetailPanel.tsx \
        app/components/useWorkItemFlowStates.ts \
        "app/(user)/work-items/page.tsx"
git commit -m "feat(PLA-0025/frontend): switch work-items FE to v2 endpoints"
```

---

## Phase 5 — Plan housekeeping

### Task 6: Update plan index and scope docs

**Files:**
- Modify: `docs/c_plan_index.md`
- Modify: `docs/c_scope.md`
- Modify: `dev/plans/PLA-0025.json` (create if absent)

- [ ] **Step 1: Create dev/plans/PLA-0025.json**

```json
{
  "id": "PLA-0025",
  "title": "Work-Items Full v2 Cutover",
  "status": "in_progress",
  "date_started": "2026-05-07",
  "date_finished": null,
  "stories": [
    {"id": "00476", "title": "Migration 016 — artefact_number_sequence", "status": "done"},
    {"id": "00477", "title": "v2 read endpoints — Get, ListChildren, Summary, FlowStates", "status": "done"},
    {"id": "00478", "title": "v2 write endpoints — Create, Patch, Archive, BulkOps", "status": "done"},
    {"id": "00479", "title": "v2 field-values endpoints — List, Upsert, Delete", "status": "done"},
    {"id": "00480", "title": "Frontend switch to v2 API", "status": "done"}
  ]
}
```

- [ ] **Step 2: Add PLA-0025 to docs/c_plan_index.md**

Add a row for PLA-0025 in the plan registry table. Follow the existing format.

- [ ] **Step 3: Update docs/c_scope.md**

Mark v2 work-items full cutover as complete. Remove the "(dev, PLA-0023)" scoped entry; add PLA-0025 as complete.

- [ ] **Step 4: Commit**

```bash
cd /Users/rick/Documents/MMFFDev-Projects/MMFFDev\ -\ Vector
git add docs/c_plan_index.md docs/c_scope.md dev/plans/PLA-0025.json
git commit -m "docs(PLA-0025): plan index + scope docs update"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Migration: artefact_number_sequence | Task 1 |
| GET /{id} | Task 2 |
| GET /{id}/children | Task 2 |
| GET /summary | Task 2 |
| GET /flow-states | Task 2 |
| POST / (Create) | Tasks 3–4 |
| PATCH /{id} | Tasks 3–4 |
| DELETE /{id} (Archive) | Tasks 3–4 |
| POST /bulk | Tasks 3–4 |
| GET /{id}/field-values | Task 4 |
| PUT /{id}/field-values | Task 4 |
| DELETE /{id}/field-values/{fv_id} | Task 4 |
| Frontend switch | Task 5 |
| Docs housekeeping | Task 6 |

All 12 endpoints covered. ✓

### Type consistency check
- `GetWorkItem`, `ListChildren`, `SummariseWorkItems`, `ListFlowStates` all defined in Task 2 and referenced correctly in Task 4 handlers.
- `CreateWorkItemInput`, `PatchWorkItemInput`, `UpsertFieldValueInput` types already exist in `types.go` — no new types needed for handlers.
- `WorkItemsSummary` added to `types.go` in Task 2 Step 1 before it is used.
- `bulkRowInfo` is unexported (lowercase) and defined in Task 3 Step 4 where it's used — no collision with v1 package.
- `pgx.ErrNoRows` — the `GetWorkItem` method references `pgx` package directly; ensure `"github.com/jackc/pgx/v5"` remains in the import block of service.go (it already is as of the current file state).

### Placeholder scan
No TBDs, no "similar to Task N" references. Every code block is complete.
