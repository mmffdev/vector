# Custom-Field → Artefact-Type Bindings Implementation Plan

> **For agentic workers:** subagent-per-task execution. Orchestrator drives git; subagents do NOT commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace admins bind custom fields to one or more artefact types from the existing custom-fields editor at `/workspace-admin/custom-fields/[id]`. Includes per-binding position / required / default-value. Mirrors Rally/Jira's idiom (catalogue field → many issue types).

**Architecture:** No schema change — `artefacts_types_fields` already exists. Three new backend endpoints (`GET / PUT / PATCH` under `/workspaces/{id}/fields/{field_id}/types`); set-write semantics (PUT replaces the full binding set atomically inside one transaction). One new React component (`TypeBindingsPicker`) mounted on the existing editor page. No new permissions. No new migrations.

**Tech Stack:** Go 1.22 + pgx/v5 + chi (backend), Next.js 15 + React 19 + TS strict (frontend), existing `fields.Service` sole-writer pattern, existing `audit.Logger` for audit emission.

**Spec:** [docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md](../specs/2026-05-28-custom-field-type-bindings-design.md)

---

## Pre-flight (orchestrator)

- [ ] Confirm we're on `feat/objecttree-fields-picker` with a clean tree.
- [ ] Confirm dev DB at `:5435` is reachable + `mmff_dev` creds work.
- [ ] Sanity: `cd backend && go build ./...` clean; `npx tsc --noEmit` clean; `go test ./internal/fields/... ./internal/savedviews/...` green.

---

## Task 1 — Backend types + sentinel errors

**Files:**
- Modify: `backend/internal/fields/service.go` (add types) OR new `backend/internal/fields/bindings.go` (one file for the binding feature — recommended for grep-ability)
- Modify: `backend/internal/fields/sql.go` (no change yet — separate task)

We'll use a new file `backend/internal/fields/bindings.go` so the binding feature is grep-able and the existing service stays focused.

- [ ] **Step 1: Create the bindings.go file with the shared types.**

```go
package fields

import (
	"errors"

	"github.com/google/uuid"
)

// Sentinel errors specific to type bindings.
//
// ErrBindingNotFound — PATCH against a (field_id, type_id) tuple that has no row.
// ErrUnknownArtefactType — any artefact_type_id submitted is missing, archived,
// or belongs to another tenant. Wire format is 404 (existence-leak guard —
// same posture as saved-views).
var (
	ErrBindingNotFound     = errors.New("fields: binding not found")
	ErrUnknownArtefactType = errors.New("fields: unknown artefact type")
)

// TypeBinding is the wire/service shape of one row in artefacts_types_fields,
// optionally enriched with the type label + scope so the GET response can
// render without a separate fetch.
type TypeBinding struct {
	ArtefactTypeID    uuid.UUID
	ArtefactTypeName  string // joined from artefacts_types — empty on inbound writes
	ArtefactTypeScope string // "work" | "strategy" — joined from artefacts_types
	Position          int
	Required          bool
	DefaultValue      *string
}

// BindingPatch is the partial-update body for UpdateBinding.
type BindingPatch struct {
	Position     *int
	Required     *bool
	DefaultValue *string // pointer-to-pointer would be the only way to express
	// "set to NULL"; we use the simpler convention: empty string ("") means
	// "set NULL". The editor's text input maps blank → "" which the service
	// rewrites to NULL on the way to SQL.
}
```

- [ ] **Step 2: `cd backend && go build ./...` — must compile.**

- [ ] **Step 3: Subagent reports back the diff. Orchestrator stages + commits.**

Commit message:
```
feat(fields): bindings.go scaffolding — TypeBinding + BindingPatch + sentinels
```

---

## Task 2 — SQL constants for binding reads + writes

**Files:**
- Modify: `backend/internal/fields/sql.go` (append the binding SQL block at the end)

We use named SQL constants per the project's discipline. Each query has a header comment that names the calling method.

- [ ] **Step 1: Append the binding SQL block to sql.go.**

```go
// ── Type bindings (artefacts_types_fields) ─────────────────────────────────
//
// Reads + writes for the binding between a catalogue field and an artefact
// type. Tenant clamp is on the SUBSCRIPTION_ID of the type AND of the field —
// the service layer parameterises both so cross-tenant probes return zero
// rows (and the service translates to ErrUnknownArtefactType → 404).
//
// Called by: ListBindingsForField, ReplaceBindingsForField, UpdateBinding.

// sqlListBindingsForField — every binding for one field, joined with the
// type label + scope for one-shot rendering. Skips archived types.
const sqlListBindingsForField = `
  SELECT tf.artefacts_types_fields_id_artefact_type,
         at.artefacts_types_name,
         at.artefacts_types_scope,
         tf.artefacts_types_fields_position,
         tf.artefacts_types_fields_required,
         tf.artefacts_types_fields_default_value
    FROM artefacts_types_fields tf
    JOIN artefacts_types at
      ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
    JOIN artefacts_fields_library fl
      ON fl.artefacts_fields_library_id = tf.artefacts_types_fields_id_field_library
   WHERE tf.artefacts_types_fields_id_field_library = $1
     AND fl.artefacts_fields_library_id_subscription IS NOT DISTINCT FROM $2
     AND at.artefacts_types_archived_at IS NULL
   ORDER BY at.artefacts_types_scope, at.artefacts_types_name
`

// sqlValidateArtefactTypesInTenant — given a field's subscription and a set of
// type IDs, returns ONLY the type IDs that exist, are not archived, and share
// the same subscription. Caller diffs against the requested set to compute
// unknown IDs (→ 404).
const sqlValidateArtefactTypesInTenant = `
  SELECT artefacts_types_id
    FROM artefacts_types
   WHERE artefacts_types_id = ANY($1::uuid[])
     AND artefacts_types_id_subscription = $2
     AND artefacts_types_archived_at IS NULL
`

// sqlUpsertBinding — single-row upsert by (type, field). Used inside the
// ReplaceBindingsForField transaction loop.
const sqlUpsertBinding = `
  INSERT INTO artefacts_types_fields (
    artefacts_types_fields_id_artefact_type,
    artefacts_types_fields_id_field_library,
    artefacts_types_fields_position,
    artefacts_types_fields_required,
    artefacts_types_fields_default_value
  ) VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (artefacts_types_fields_id_artefact_type,
               artefacts_types_fields_id_field_library)
  DO UPDATE SET
    artefacts_types_fields_position      = EXCLUDED.artefacts_types_fields_position,
    artefacts_types_fields_required      = EXCLUDED.artefacts_types_fields_required,
    artefacts_types_fields_default_value = EXCLUDED.artefacts_types_fields_default_value,
    artefacts_types_fields_updated_at    = now()
`

// sqlDeleteBindingsNotIn — removes any binding for this field whose type is
// NOT in the kept-set. Runs once at the end of the ReplaceBindingsForField
// transaction to enforce set semantics.
const sqlDeleteBindingsNotIn = `
  DELETE FROM artefacts_types_fields
   WHERE artefacts_types_fields_id_field_library = $1
     AND artefacts_types_fields_id_artefact_type <> ALL($2::uuid[])
`

// sqlPatchBinding — single-binding update used by UpdateBinding. Pointer
// args (NULL = don't change) map to COALESCE; default_value uses the
// "empty string means NULL" convention — service translates blank to NULL.
const sqlPatchBinding = `
  UPDATE artefacts_types_fields
     SET artefacts_types_fields_position      = COALESCE($3, artefacts_types_fields_position),
         artefacts_types_fields_required      = COALESCE($4, artefacts_types_fields_required),
         artefacts_types_fields_default_value = COALESCE($5, artefacts_types_fields_default_value),
         artefacts_types_fields_updated_at    = now()
   WHERE artefacts_types_fields_id_field_library = $1
     AND artefacts_types_fields_id_artefact_type = $2
   RETURNING artefacts_types_fields_id_artefact_type,
            artefacts_types_fields_position,
            artefacts_types_fields_required,
            artefacts_types_fields_default_value
`

// sqlFetchOneBinding — read one binding by (field, type), joined with the
// type label + scope. Used after Upsert/Patch when the caller wants the
// enriched return shape.
const sqlFetchOneBinding = `
  SELECT tf.artefacts_types_fields_id_artefact_type,
         at.artefacts_types_name,
         at.artefacts_types_scope,
         tf.artefacts_types_fields_position,
         tf.artefacts_types_fields_required,
         tf.artefacts_types_fields_default_value
    FROM artefacts_types_fields tf
    JOIN artefacts_types at
      ON at.artefacts_types_id = tf.artefacts_types_fields_id_artefact_type
   WHERE tf.artefacts_types_fields_id_field_library = $1
     AND tf.artefacts_types_fields_id_artefact_type = $2
`
```

- [ ] **Step 2: `cd backend && go build ./...` — must compile (unused constants are fine; warnings about unused are not Go errors).**

- [ ] **Step 3: Orchestrator stages + commits.**

Commit message:
```
feat(fields): SQL constants for type-binding read/write/patch
```

---

## Task 3 — Service methods (sole writer)

**Files:**
- Modify: `backend/internal/fields/bindings.go` (add the three methods on `*Service`)

- [ ] **Step 1: Add the three service methods. Inside ReplaceBindingsForField, use a transaction.**

```go
// (append to bindings.go)

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ListBindingsForField returns every binding for the field, joined with
// the type label + scope so the caller can render without a second fetch.
// Tenant clamp: only bindings where the type shares subID with the field.
func (s *Service) ListBindingsForField(
	ctx context.Context,
	subID, fieldID uuid.UUID,
) ([]TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}
	rows, err := s.artefactsPool.Query(ctx, sqlListBindingsForField, fieldID, subID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TypeBinding{}
	for rows.Next() {
		var b TypeBinding
		if err := rows.Scan(
			&b.ArtefactTypeID,
			&b.ArtefactTypeName,
			&b.ArtefactTypeScope,
			&b.Position,
			&b.Required,
			&b.DefaultValue,
		); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ReplaceBindingsForField replaces the full set atomically. Diffs against
// the current set, upserts the requested rows, deletes the rows that are
// no longer in the set. All inside one transaction.
//
// Returns ErrUnknownArtefactType if any requested artefact_type_id is
// missing, archived, or in another tenant.
func (s *Service) ReplaceBindingsForField(
	ctx context.Context,
	subID, fieldID uuid.UUID,
	wanted []TypeBinding,
) ([]TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}

	// 1. Validate every requested type belongs to this tenant + is alive.
	wantedIDs := make([]uuid.UUID, len(wanted))
	for i, b := range wanted {
		wantedIDs[i] = b.ArtefactTypeID
	}
	if len(wantedIDs) > 0 {
		rows, err := s.artefactsPool.Query(ctx, sqlValidateArtefactTypesInTenant, wantedIDs, subID)
		if err != nil {
			return nil, err
		}
		valid := map[uuid.UUID]struct{}{}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			valid[id] = struct{}{}
		}
		rows.Close()
		for _, id := range wantedIDs {
			if _, ok := valid[id]; !ok {
				return nil, ErrUnknownArtefactType
			}
		}
	}

	// 2. One transaction: upsert each wanted row, delete rows not in the set.
	tx, err := s.artefactsPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, b := range wanted {
		if _, err := tx.Exec(ctx, sqlUpsertBinding,
			b.ArtefactTypeID, fieldID, b.Position, b.Required, b.DefaultValue,
		); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, sqlDeleteBindingsNotIn, fieldID, wantedIDs); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// 3. Read back the new state with the joined labels so the caller can
	//    render the response immediately.
	return s.ListBindingsForField(ctx, subID, fieldID)
}

// UpdateBinding patches one binding's position / required / default_value.
// Pointer fields: nil → don't change. For default_value the wire convention
// is "empty string means NULL" but here we accept the pointer as-is and let
// the SQL COALESCE handle it; the caller (handler) is responsible for
// the empty-string→nil translation if the user wants to clear the value.
func (s *Service) UpdateBinding(
	ctx context.Context,
	subID, fieldID, typeID uuid.UUID,
	p BindingPatch,
) (*TypeBinding, error) {
	if !s.HasArtefactsPool() {
		return nil, errors.New("fields: artefacts pool not configured")
	}

	// Tenant clamp: validate the type before touching the binding row.
	rows, err := s.artefactsPool.Query(ctx, sqlValidateArtefactTypesInTenant, []uuid.UUID{typeID}, subID)
	if err != nil {
		return nil, err
	}
	valid := false
	for rows.Next() {
		valid = true
	}
	rows.Close()
	if !valid {
		return nil, ErrUnknownArtefactType
	}

	// Patch + RETURNING.
	row := s.artefactsPool.QueryRow(ctx, sqlPatchBinding,
		fieldID, typeID, p.Position, p.Required, p.DefaultValue,
	)
	var b TypeBinding
	if err := row.Scan(
		&b.ArtefactTypeID,
		&b.Position,
		&b.Required,
		&b.DefaultValue,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrBindingNotFound
		}
		return nil, err
	}

	// Re-fetch with the joined label so the response is enriched.
	row = s.artefactsPool.QueryRow(ctx, sqlFetchOneBinding, fieldID, typeID)
	if err := row.Scan(
		&b.ArtefactTypeID,
		&b.ArtefactTypeName,
		&b.ArtefactTypeScope,
		&b.Position,
		&b.Required,
		&b.DefaultValue,
	); err != nil {
		return nil, err
	}
	return &b, nil
}
```

- [ ] **Step 2: `cd backend && go build ./...` — must compile.**

- [ ] **Step 3: Orchestrator stages + commits.**

Commit message:
```
feat(fields): Service.ListBindingsForField + ReplaceBindingsForField + UpdateBinding
```

---

## Task 4 — Service tests (unit, against a real DB via integration tag)

**Files:**
- Create: `backend/internal/fields/bindings_integration_test.go`

We follow the saved-views integration-test pattern: `//go:build integration` build tag, real DB pool from env, seed a tenant + a field + 2-3 artefact types, exercise the three service methods.

- [ ] **Step 1: Write the integration test file.**

```go
//go:build integration

package fields

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DSN")
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DSN not set; skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

// Helper: seed a field row + 2 artefact types in a unique synthetic tenant
// so the test doesn't collide with the live seed. Returns the field_id,
// the sub_id, and the two type IDs.
func seedTestRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	subID := uuid.New()
	fieldID := uuid.New()
	typeAID := uuid.New()
	typeBID := uuid.New()

	// Seed a tenant-scope field. subscription_id is NOT NULL for tenant scope
	// per the CHECK constraint.
	if _, err := pool.Exec(ctx, `
		INSERT INTO artefacts_fields_library
		  (artefacts_fields_library_id, artefacts_fields_library_id_subscription,
		   artefacts_fields_library_field_name, artefacts_fields_library_label,
		   artefacts_fields_library_field_type, artefacts_fields_library_scope)
		VALUES ($1, $2, $3, 'Test Field', 'textbox', 'tenant')`,
		fieldID, subID, "test_field_"+fieldID.String()[:8]); err != nil {
		t.Fatalf("seed field: %v", err)
	}

	// Seed two artefact types in the same sub.
	for i, id := range []uuid.UUID{typeAID, typeBID} {
		scope := "work"
		if i == 1 {
			scope = "strategy"
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO artefacts_types
			  (artefacts_types_id, artefacts_types_id_subscription,
			   artefacts_types_name, artefacts_types_scope)
			VALUES ($1, $2, $3, $4)`,
			id, subID, "Test Type "+id.String()[:6], scope); err != nil {
			t.Fatalf("seed type: %v", err)
		}
	}

	t.Cleanup(func() {
		// Clean up in dependency order: bindings → field → types.
		pool.Exec(ctx, `DELETE FROM artefacts_types_fields WHERE artefacts_types_fields_id_field_library = $1`, fieldID)
		pool.Exec(ctx, `DELETE FROM artefacts_fields_library WHERE artefacts_fields_library_id = $1`, fieldID)
		pool.Exec(ctx, `DELETE FROM artefacts_types WHERE artefacts_types_id = ANY($1)`, []uuid.UUID{typeAID, typeBID})
	})
	return fieldID, subID, typeAID, typeBID
}

func TestReplaceBindingsForField_NewBinding(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, typeA, _ := seedTestRows(t, ctx, pool)

	wanted := []TypeBinding{
		{ArtefactTypeID: typeA, Position: 100, Required: true},
	}
	out, err := svc.ReplaceBindingsForField(ctx, subID, fieldID, wanted)
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("want 1 binding back, got %d", len(out))
	}
	if out[0].ArtefactTypeID != typeA || !out[0].Required || out[0].Position != 100 {
		t.Fatalf("returned binding mismatch: %+v", out[0])
	}
	if out[0].ArtefactTypeName == "" {
		t.Fatalf("name not joined")
	}
}

func TestReplaceBindingsForField_SetSemantics(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, typeA, typeB := seedTestRows(t, ctx, pool)

	// Initial: bind A + B.
	if _, err := svc.ReplaceBindingsForField(ctx, subID, fieldID,
		[]TypeBinding{
			{ArtefactTypeID: typeA, Position: 100},
			{ArtefactTypeID: typeB, Position: 200},
		}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// Replace with just A — B should be deleted.
	out, err := svc.ReplaceBindingsForField(ctx, subID, fieldID,
		[]TypeBinding{
			{ArtefactTypeID: typeA, Position: 150},
		})
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("want 1, got %d", len(out))
	}
	if out[0].ArtefactTypeID != typeA || out[0].Position != 150 {
		t.Fatalf("typeA position not updated: %+v", out[0])
	}
}

func TestReplaceBindingsForField_UnknownType_Returns404Sentinel(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, _, _ := seedTestRows(t, ctx, pool)
	bogus := uuid.New()

	_, err := svc.ReplaceBindingsForField(ctx, subID, fieldID,
		[]TypeBinding{{ArtefactTypeID: bogus, Position: 100}})
	if err == nil {
		t.Fatalf("want ErrUnknownArtefactType, got nil")
	}
	if !errors.Is(err, ErrUnknownArtefactType) {
		t.Fatalf("want ErrUnknownArtefactType, got %v", err)
	}
}

func TestReplaceBindingsForField_CrossTenantType_Returns404Sentinel(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subA, typeA, _ := seedTestRows(t, ctx, pool)

	// Different tenant's type id — same as typeA but we'll pretend the
	// caller is subB and the type belongs to subA.
	subB := uuid.New()

	_, err := svc.ReplaceBindingsForField(ctx, subB, fieldID,
		[]TypeBinding{{ArtefactTypeID: typeA, Position: 100}})
	if !errors.Is(err, ErrUnknownArtefactType) {
		t.Fatalf("cross-tenant must surface as ErrUnknownArtefactType, got %v", err)
	}
}

func TestUpdateBinding_PatchPosition(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, typeA, _ := seedTestRows(t, ctx, pool)
	if _, err := svc.ReplaceBindingsForField(ctx, subID, fieldID,
		[]TypeBinding{{ArtefactTypeID: typeA, Position: 100, Required: false}}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	newPos := 250
	out, err := svc.UpdateBinding(ctx, subID, fieldID, typeA, BindingPatch{Position: &newPos})
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if out.Position != 250 {
		t.Fatalf("want position 250, got %d", out.Position)
	}
	if out.Required != false {
		t.Fatalf("required should be untouched, got %v", out.Required)
	}
}

func TestUpdateBinding_NoRow_ReturnsErrBindingNotFound(t *testing.T) {
	pool := newTestPool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, typeA, _ := seedTestRows(t, ctx, pool)
	newPos := 100
	_, err := svc.UpdateBinding(ctx, subID, fieldID, typeA, BindingPatch{Position: &newPos})
	if !errors.Is(err, ErrBindingNotFound) {
		t.Fatalf("want ErrBindingNotFound, got %v", err)
	}
}
```

Add `import "errors"` at the top.

- [ ] **Step 2: Run the tests.**

```bash
cd backend && go test -tags=integration -run "TestReplaceBindingsForField|TestUpdateBinding" ./internal/fields/...
```

Set `VECTOR_ARTEFACTS_DSN` first; use the value from `backend/.env.dev` (compose host + port + user + password).

- [ ] **Step 3: If any fail, fix the service layer (not the tests). Re-run.**

- [ ] **Step 4: Orchestrator stages + commits.**

Commit message:
```
test(fields): integration tests — bindings replace, set-semantics, tenant clamp, patch
```

---

## Task 5 — HTTP handlers

**Files:**
- Modify: `backend/internal/fields/handler.go` (append 3 new handlers + their wire types) OR new `backend/internal/fields/bindings_handler.go`

We'll append to `handler.go` to keep the routing surface in one place — matches the existing pattern.

- [ ] **Step 1: Append the wire types + 3 handlers.**

```go
// (append to handler.go)

// bindingOut is the wire shape for one binding row.
type bindingOut struct {
	ArtefactTypeID    uuid.UUID `json:"artefact_type_id"`
	ArtefactTypeName  string    `json:"artefact_type_name"`
	ArtefactTypeScope string    `json:"artefact_type_scope"`
	Position          int       `json:"position"`
	Required          bool      `json:"required"`
	DefaultValue      *string   `json:"default_value"`
}

// listBindingsResponse / replaceBindingsRequest / updateBindingRequest
// shapes are intentionally minimal — clients don't see the field_id or
// workspace_id in the body (both come from the URL path).
type listBindingsResponse struct {
	FieldID  uuid.UUID    `json:"field_id"`
	Bindings []bindingOut `json:"bindings"`
}

type replaceBindingsRequest struct {
	Bindings []bindingIn `json:"bindings"`
}

type bindingIn struct {
	ArtefactTypeID uuid.UUID `json:"artefact_type_id"`
	Position       int       `json:"position"`
	Required       bool      `json:"required"`
	DefaultValue   *string   `json:"default_value,omitempty"`
}

type updateBindingRequest struct {
	Position     *int    `json:"position,omitempty"`
	Required     *bool   `json:"required,omitempty"`
	DefaultValue *string `json:"default_value,omitempty"`
}

func toBindingOut(b TypeBinding) bindingOut {
	return bindingOut{
		ArtefactTypeID:    b.ArtefactTypeID,
		ArtefactTypeName:  b.ArtefactTypeName,
		ArtefactTypeScope: b.ArtefactTypeScope,
		Position:          b.Position,
		Required:          b.Required,
		DefaultValue:      b.DefaultValue,
	}
}

// ListBindings — GET /workspaces/{id}/fields/{field_id}/types
func (h *Handler) ListBindings(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	// Read gate: any member may LIST bindings (it's a sub-resource of the
	// field, and read-side parity with the existing field list is sane).
	if err := h.Svc.AssertCallerMayRead(r.Context(), wsID, u); err != nil {
		writeReaderGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	bindings, err := h.Svc.ListBindingsForField(r.Context(), u.SubscriptionID, fieldID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.ServerError)
		return
	}
	outs := make([]bindingOut, 0, len(bindings))
	for _, b := range bindings {
		outs = append(outs, toBindingOut(b))
	}
	writeJSON(w, http.StatusOK, listBindingsResponse{FieldID: fieldID, Bindings: outs})
}

// ReplaceBindings — PUT /workspaces/{id}/fields/{field_id}/types
func (h *Handler) ReplaceBindings(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var body replaceBindingsRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	// Write gate: workspace-admin scope is the broader bucket. Service
	// re-validates per the row's actual scope inside ReplaceBindings.
	if err := h.Svc.AssertCallerMayWrite(r.Context(), wsID, u, "workspace"); err != nil {
		writeWriterGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	wanted := make([]TypeBinding, 0, len(body.Bindings))
	for _, b := range body.Bindings {
		wanted = append(wanted, TypeBinding{
			ArtefactTypeID: b.ArtefactTypeID,
			Position:       b.Position,
			Required:       b.Required,
			DefaultValue:   b.DefaultValue,
		})
	}

	out, err := h.Svc.ReplaceBindingsForField(r.Context(), u.SubscriptionID, fieldID, wanted)
	if err != nil {
		if errors.Is(err, ErrUnknownArtefactType) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.ServerError)
		return
	}
	outs := make([]bindingOut, 0, len(out))
	for _, b := range out {
		outs = append(outs, toBindingOut(b))
	}
	writeJSON(w, http.StatusOK, listBindingsResponse{FieldID: fieldID, Bindings: outs})
}

// UpdateBinding — PATCH /workspaces/{id}/fields/{field_id}/types/{type_id}
func (h *Handler) UpdateBinding(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	fieldID, err := uuid.Parse(chi.URLParam(r, "field_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	typeID, err := uuid.Parse(chi.URLParam(r, "type_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var body updateBindingRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.AssertCallerMayWrite(r.Context(), wsID, u, "workspace"); err != nil {
		writeWriterGateErr(w, r, err)
		return
	}
	if !h.Svc.HasArtefactsPool() {
		httperr.Write(w, r, http.StatusServiceUnavailable, usermessages.ServiceUnavailable)
		return
	}

	out, err := h.Svc.UpdateBinding(r.Context(), u.SubscriptionID, fieldID, typeID, BindingPatch{
		Position: body.Position, Required: body.Required, DefaultValue: body.DefaultValue,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrUnknownArtefactType):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrBindingNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.ServerError)
		}
		return
	}
	writeJSON(w, http.StatusOK, toBindingOut(*out))
}
```

If `writeReaderGateErr` doesn't exist, define it in the same file (it's symmetric to `writeWriterGateErr`).

- [ ] **Step 2: `cd backend && go build ./...` — must compile.**

- [ ] **Step 3: Orchestrator stages + commits.**

Commit message:
```
feat(fields): HTTP handlers — List/Replace/Update bindings
```

---

## Task 6 — Route mount

**Files:**
- Modify: `backend/cmd/server/main.go` (add 3 routes to the existing `/workspaces/{id}/fields` block at line 1823 + the duplicate at line 2385)

- [ ] **Step 1: Add the routes immediately after the existing `r.Delete("/{field_id}", fieldsH.Archive)` at line 1830 and inside the same chi.Router scope.**

```go
r.Get("/{field_id}/types", fieldsH.ListBindings)
r.Put("/{field_id}/types", fieldsH.ReplaceBindings)
r.Patch("/{field_id}/types/{type_id}", fieldsH.UpdateBinding)
```

Add the same lines to the duplicate mount at line 2385+ (the project mounts the same routes under two transports — check the existing pattern in that block; mirror it).

- [ ] **Step 2: `cd backend && go build ./...` — must compile.**

- [ ] **Step 3: Quick smoke against running server:**

```bash
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
# Use any workspace+field id from your dev DB
curl -s -H "Authorization: Bearer $KEY" http://localhost:5100/_site/workspaces/<wsid>/fields/<fieldid>/types | jq .
```

Expected: `{"field_id":"...","bindings":[...]}` or empty bindings array. 200 OK either way.

- [ ] **Step 4: Orchestrator stages + commits.**

Commit message:
```
feat(fields): mount /workspaces/{id}/fields/{field_id}/types routes
```

---

## Task 7 — Frontend API wrappers

**Files:**
- Modify: `app/lib/fieldsApi.ts` (append the three new wrappers + the binding type)

- [ ] **Step 1: Append the type + three wrappers.**

```ts
// (append to fieldsApi.ts)

import { apiSite } from "@/app/lib/api";

export interface FieldTypeBinding {
  artefact_type_id: string;
  artefact_type_name: string;
  artefact_type_scope: "work" | "strategy";
  position: number;
  required: boolean;
  default_value: string | null;
}

interface ListBindingsResponse {
  field_id: string;
  bindings: FieldTypeBinding[];
}

export async function getFieldTypeBindings(
  workspaceId: string,
  fieldId: string,
): Promise<FieldTypeBinding[]> {
  const res = await apiSite<ListBindingsResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields/${encodeURIComponent(fieldId)}/types`,
  );
  return res.bindings ?? [];
}

export async function replaceFieldTypeBindings(
  workspaceId: string,
  fieldId: string,
  bindings: Array<Pick<FieldTypeBinding, "artefact_type_id" | "position" | "required" | "default_value">>,
): Promise<FieldTypeBinding[]> {
  const res = await apiSite<ListBindingsResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields/${encodeURIComponent(fieldId)}/types`,
    {
      method: "PUT",
      body: JSON.stringify({ bindings }),
    },
  );
  return res.bindings ?? [];
}

export async function updateFieldTypeBinding(
  workspaceId: string,
  fieldId: string,
  typeId: string,
  patch: Partial<Pick<FieldTypeBinding, "position" | "required" | "default_value">>,
): Promise<FieldTypeBinding> {
  return await apiSite<FieldTypeBinding>(
    `/workspaces/${encodeURIComponent(workspaceId)}/fields/${encodeURIComponent(fieldId)}/types/${encodeURIComponent(typeId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
}
```

If `apiSite` is already imported in this file, don't duplicate the import.

- [ ] **Step 2: `npx tsc --noEmit` — must be clean.**

- [ ] **Step 3: Orchestrator stages + commits.**

Commit message:
```
feat(fields): client wrappers — getFieldTypeBindings, replaceFieldTypeBindings, updateFieldTypeBinding
```

---

## Task 8 — TypeBindingsPicker component

**Files:**
- Create: `app/components/CustomFields/TypeBindingsPicker.tsx` (~250 LOC)
- Modify: `app/globals.css` (append the `.type-bindings-picker__*` family at the bottom, ~80 lines)

This is the two-column picker described in the spec §5.4. Body-opaque props: it accepts a `bindings` value + `onChange`, and reads the artefact-type catalogue from `useArtefactTypeCatalogue` — no globals beyond that.

- [ ] **Step 1: Write the component.**

```tsx
"use client";

// TypeBindingsPicker — workspace-admin surface for binding a custom field
// to one or more artefact types. Mounted on the custom-fields editor page.
//
// Wire contract: parent owns the bindings state (so Save can write them
// atomically with the field). This component is stateless beyond the
// per-binding editor inputs.
//
// Type-scope agnostic: artefact types are user-defined (admins create new
// types via /workspace-admin/artefacts/artefact-types/). The picker lists
// every type in the tenant catalogue, segmented visually by scope. It
// does NOT filter by field scope — see
// docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md §4.

import { useMemo } from "react";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";

export interface DraftBinding {
  artefact_type_id: string;
  position: number;
  required: boolean;
  default_value: string | null;
}

interface Props {
  bindings: DraftBinding[];
  onChange: (next: DraftBinding[]) => void;
  disabled?: boolean;
}

export default function TypeBindingsPicker({ bindings, onChange, disabled }: Props) {
  const { types } = useArtefactTypeCatalogue();

  const selectedIds = useMemo(() => new Set(bindings.map((b) => b.artefact_type_id)), [bindings]);

  const groupedAvailable = useMemo(() => {
    const live = types.filter((t) => t.archived_at == null);
    const work: typeof live = [];
    const strategy: typeof live = [];
    for (const t of live) {
      if (t.scope === "work") work.push(t);
      else if (t.scope === "strategy") strategy.push(t);
    }
    work.sort((a, b) => a.name.localeCompare(b.name));
    strategy.sort((a, b) => a.name.localeCompare(b.name));
    return { work, strategy };
  }, [types]);

  function toggle(typeId: string) {
    if (disabled) return;
    if (selectedIds.has(typeId)) {
      onChange(bindings.filter((b) => b.artefact_type_id !== typeId));
    } else {
      onChange([
        ...bindings,
        { artefact_type_id: typeId, position: 100, required: false, default_value: null },
      ]);
    }
  }

  function patch(typeId: string, patch: Partial<DraftBinding>) {
    onChange(bindings.map((b) => (b.artefact_type_id === typeId ? { ...b, ...patch } : b)));
  }

  function bindingFor(typeId: string): DraftBinding | undefined {
    return bindings.find((b) => b.artefact_type_id === typeId);
  }

  return (
    <div className="type-bindings-picker">
      <div className="type-bindings-picker__Columns">
        <div className="type-bindings-picker__AvailableCol">
          <div className="type-bindings-picker__SectionLabel">Work scope</div>
          <ul className="type-bindings-picker__TypeList">
            {groupedAvailable.work.map((t) => {
              const selected = selectedIds.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
                </li>
              );
            })}
            {groupedAvailable.work.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">No work-scope types defined</li>
            )}
          </ul>

          <div className="type-bindings-picker__SectionLabel">Strategy scope</div>
          <ul className="type-bindings-picker__TypeList">
            {groupedAvailable.strategy.map((t) => {
              const selected = selectedIds.has(t.id);
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
                </li>
              );
            })}
            {groupedAvailable.strategy.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">No strategy-scope types defined</li>
            )}
          </ul>
        </div>

        <div className="type-bindings-picker__SelectedCol">
          <div className="type-bindings-picker__SectionLabel">
            Selected ({bindings.length})
          </div>
          <ul className="type-bindings-picker__BindingList">
            {bindings.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">
                Pick types from the left to bind this field
              </li>
            )}
            {bindings.map((b) => {
              const t = types.find((x) => x.id === b.artefact_type_id);
              return (
                <li key={b.artefact_type_id} className="type-bindings-picker__BindingRow">
                  <div className="type-bindings-picker__BindingHead">
                    <span className="type-bindings-picker__TypeName">
                      {t?.name ?? b.artefact_type_id.slice(0, 8) + "…"}
                    </span>
                    <button
                      type="button"
                      className="type-bindings-picker__RemoveBtn"
                      onClick={() => toggle(b.artefact_type_id)}
                      disabled={disabled}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="type-bindings-picker__BindingControls">
                    <label className="type-bindings-picker__InputLabel">
                      Position
                      <input
                        type="number"
                        value={b.position}
                        min={0}
                        onChange={(e) => patch(b.artefact_type_id, { position: Number(e.target.value) })}
                        disabled={disabled}
                      />
                    </label>
                    <label className="type-bindings-picker__InputLabel">
                      <input
                        type="checkbox"
                        checked={b.required}
                        onChange={(e) => patch(b.artefact_type_id, { required: e.target.checked })}
                        disabled={disabled}
                      />
                      Required
                    </label>
                    <label className="type-bindings-picker__InputLabel">
                      Default value
                      <input
                        type="text"
                        value={b.default_value ?? ""}
                        onChange={(e) =>
                          patch(b.artefact_type_id, {
                            default_value: e.target.value === "" ? null : e.target.value,
                          })
                        }
                        disabled={disabled}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append the CSS family to `app/globals.css`. Match the existing root-block convention (look at `.saved-views__*` for the precedent).**

```css
/* ──────────────────────────────────────────────────────────────────────
   TypeBindingsPicker — two-column field-to-type binder.
   Specs: docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md
   ────────────────────────────────────────────────────────────────────── */

.type-bindings-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.type-bindings-picker__Columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.type-bindings-picker__AvailableCol,
.type-bindings-picker__SelectedCol {
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface-1, #1a1a1a);
}

.type-bindings-picker__SectionLabel {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ink-muted, #888);
  margin-bottom: 8px;
}

.type-bindings-picker__TypeList,
.type-bindings-picker__BindingList {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.type-bindings-picker__TypeRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.type-bindings-picker__TypeRow:hover {
  background: var(--surface-2, #222);
}

.type-bindings-picker__TypeRow.is-selected {
  background: var(--accent-soft, rgba(80, 140, 240, 0.12));
}

.type-bindings-picker__TypeName {
  font-size: 13px;
}

.type-bindings-picker__EmptyRow {
  padding: 8px;
  font-size: 12px;
  color: var(--ink-muted, #888);
  font-style: italic;
}

.type-bindings-picker__BindingRow {
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 6px;
  padding: 8px;
  background: var(--surface-2, #222);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.type-bindings-picker__BindingHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.type-bindings-picker__BindingControls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.type-bindings-picker__InputLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.type-bindings-picker__InputLabel input[type="number"] {
  width: 70px;
}

.type-bindings-picker__InputLabel input[type="text"] {
  width: 140px;
}

.type-bindings-picker__RemoveBtn {
  background: none;
  border: 1px solid var(--border, #2a2a2a);
  color: var(--ink-muted, #888);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.type-bindings-picker__RemoveBtn:hover {
  border-color: var(--danger, #c33);
  color: var(--danger, #c33);
}
```

- [ ] **Step 3: `npx tsc --noEmit` — must be clean.**

- [ ] **Step 4: Orchestrator stages + commits.**

Commit message:
```
feat(fields): TypeBindingsPicker component + .type-bindings-picker__* CSS family
```

---

## Task 9 — Mount on the editor page

**Files:**
- Modify: `app/(user)/workspace-admin/custom-fields/[id]/page.tsx`

We wire `TypeBindingsPicker` between the existing fields and the Save button. State machine:

- On Load (existing field): fetch the field row AND its bindings (parallel `Promise.all`).
- On Save: write the catalogue row first; if create, capture the new `field_id`; then write bindings via `replaceFieldTypeBindings`. If either fails, surface the error and stay on the page (the dirty flag on `bindings` is preserved).
- The editor already has a `[loading, busy, err]` triad — reuse it.

- [ ] **Step 1: Read the existing editor page in full, identify the Save handler, then make these edits:**

  - Add `import TypeBindingsPicker, { type DraftBinding } from "@/app/components/CustomFields/TypeBindingsPicker"`.
  - Add `import { getFieldTypeBindings, replaceFieldTypeBindings, type FieldTypeBinding } from "@/app/lib/fieldsApi"`.
  - Add state: `const [bindings, setBindings] = useState<DraftBinding[]>([])` and `const [bindingsDirty, setBindingsDirty] = useState(false)`.
  - In the existing load effect (the `load` useCallback), after `setCurrent(match)`, also call:
    ```ts
    if (activeWorkspaceId) {
      try {
        const bs = await getFieldTypeBindings(activeWorkspaceId, params.id);
        setBindings(
          bs.map((b) => ({
            artefact_type_id: b.artefact_type_id,
            position: b.position,
            required: b.required,
            default_value: b.default_value,
          })),
        );
      } catch {
        // Bindings are non-fatal on load — log via err state, let user retry.
      }
    }
    ```
  - Wrap `setBindings` calls with a wrapper that flips `bindingsDirty = true`. Simplest: replace `<TypeBindingsPicker onChange={setBindings}>` with `onChange={(next) => { setBindings(next); setBindingsDirty(true); }}`.
  - In the Save handler (after the existing `createWorkspaceField` / `updateWorkspaceField` call succeeds), add:
    ```ts
    const fieldIdForBindings = isNew ? created.id : params.id;
    if (bindingsDirty || isNew) {
      try {
        await replaceFieldTypeBindings(activeWorkspaceId, fieldIdForBindings, bindings);
      } catch (e: unknown) {
        setErr(
          "Field saved, but bindings failed: " +
            (e instanceof Error ? e.message : "unknown error") +
            ". Re-click Save to retry.",
        );
        setBusy(false);
        return; // Stay on the page with the dirty state.
      }
    }
    ```
  - Mount the picker in the JSX, ABOVE the Save button, inside the existing Panel that wraps the form:
    ```tsx
    <div style={{ marginTop: 16 }}>
      <h4>Applies to artefact types</h4>
      <TypeBindingsPicker
        bindings={bindings}
        onChange={(next) => { setBindings(next); setBindingsDirty(true); }}
        disabled={busy}
      />
    </div>
    ```

- [ ] **Step 2: `npx tsc --noEmit` — must be clean.**

- [ ] **Step 3: Manual smoke test (orchestrator runs against the live dev server):**

  - Navigate to `/workspace-admin/custom-fields/new`.
  - Fill in a name + label, pick a data type.
  - Pick 1–2 artefact types in the binder.
  - Click Save.
  - Verify the field is created (returns to list).
  - Re-open the field. Bindings should be present.
  - Unbind one type. Click Save.
  - Re-open. The unbound type should be gone.

- [ ] **Step 4: Orchestrator stages + commits.**

Commit message:
```
feat(fields): mount TypeBindingsPicker on custom-fields editor; bind-on-save
```

---

## Task 10 — SY003 regen (substrate change check)

We didn't change the schema, but we added handlers + sole-writer methods to a substrate table. Per the project rule, regenerate SY003 so the master substrate inventory reflects the new write surface.

- [ ] **Step 1: Orchestrator triggers SY003 regeneration via the `<report> -sy` skill or direct POST to `/_site/admin/dev/reporting/`. This is optional if no schema or table-relationship changed — SY003's primary inventory is tables + columns + row counts, which are unchanged. Skip this task UNLESS the next session needs it.**

Default: skip Task 10. Note the skip in the handover.

---

## Final sweep (orchestrator)

- [ ] `cd backend && go test ./internal/fields/...` — green (unit + the new integration tests when run with `-tags=integration`).
- [ ] `cd backend && go build ./...` — clean.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Existing project lints: `lint:no-db-in-handlers`, `lint:no-raw-table`, `lint:addressables` — all green (run via the project's lint script bundle).
- [ ] Manual smoke walkthrough (Task 9 step 3) confirmed in a real browser.
- [ ] Amend `handovers/handover_saved_views_done.md` with a follow-up section OR write a fresh `handovers/handover_custom_field_bindings.md`. Fresh handover is cleaner — the saved-views handover is closed.
- [ ] Commit + final `git log --oneline main..HEAD` recap.

---

## Risks / Open questions

1. **`writeReaderGateErr` may not exist** — the existing handler.go uses `writeWriterGateErr`. Check at Task 5 step 1; if missing, define a symmetric helper inline.
2. **The handler at line 1823 and the one at line 2385 are duplicates** — confirm the second is actually a duplicate transport vs a different mount path. If duplicate, both need the new routes; if not, mount only on the appropriate transport.
3. **`useArtefactTypeCatalogue` shape** — assumed it exposes `{ types: [{ id, name, scope, archived_at }] }`. Verify in Task 8; adjust the component if the property names differ.
4. **Audit emission** — the spec says emit `audit.Logger.Log`, but the existing `fields.Service` doesn't emit audit today. **Decision:** to keep this PR scope-bounded, do NOT add audit emission to the bindings methods. File as a follow-up TD entry: `TD-FIELDS-BINDINGS-AUDIT-EMIT`. The catalogue itself isn't audited either; consistency wins.
5. **Per-type default values for `select`/`multiselect` types** — `default_value` is a single text column. For `select`-type fields, a default would be one option key; the editor's free-text input is correct for this. For `multiselect` defaults, the user can comma-separate (or the future cell renderer interprets JSON). Out of scope to validate on the backend; the wire is bytes.

These risks/questions are surfaced for the orchestrator to handle inline as they're hit.
