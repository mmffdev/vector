//go:build integration

package fields

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestPool connects to the dev vector_artefacts DB (env-overrideable).
// Mirrors the saved-views integration test pattern.
//
// Pool teardown is registered via t.Cleanup (NOT defer pool.Close()) so
// that seed-row cleanups registered later by seedTestRows run BEFORE the
// pool is closed. Go runs t.Cleanup callbacks LIFO after the test body
// returns; defers in the test body unwind first. Mixing the two patterns
// would close the pool before the DELETE cleanups fire, silently leaking
// every test_field_* / test type the run created.
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
	// Registered FIRST → runs LAST in the LIFO cleanup chain, so any
	// DELETE cleanups seedTestRows queues later still see an open pool.
	t.Cleanup(func() { pool.Close() })
	return pool
}

// seedTestRows seeds a field row + 2 artefact types in a unique synthetic
// tenant + workspace so the test doesn't collide with the live seed.
// Returns (fieldID, subID, typeAID, typeBID). Schema constraints honoured:
//   - artefacts_types requires _source (system|tenant), _prefix (unique per
//     (workspace, scope) where archived_at IS NULL), _id_workspace NOT NULL.
//   - artefacts_fields_library requires _scope (global|tenant|workspace);
//     tenant scope demands non-NULL _id_subscription.
//   - Field name is unique per (subscription, name) where not archived.
func seedTestRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	subID := uuid.New()
	wsID := uuid.New()
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

	// Seed two artefact types in the same sub + workspace. Distinct scopes
	// so we exercise the work/strategy grouping in the JOIN reader, and so
	// the (workspace, scope, prefix) uniqueness has plenty of headroom.
	// _prefix derived from the UUID head — uppercased to mimic existing data
	// shape — and uniqueness guaranteed by uuid randomness inside a single
	// workspace.
	for i, id := range []uuid.UUID{typeAID, typeBID} {
		scope := "work"
		if i == 1 {
			scope = "strategy"
		}
		prefix := strings.ToUpper(id.String()[:6])
		if _, err := pool.Exec(ctx, `
			INSERT INTO artefacts_types
			  (artefacts_types_id, artefacts_types_id_subscription,
			   artefacts_types_id_workspace,
			   artefacts_types_scope, artefacts_types_source,
			   artefacts_types_name, artefacts_types_prefix)
			VALUES ($1, $2, $3, $4, 'tenant', $5, $6)`,
			id, subID, wsID, scope, "Test Type "+id.String()[:6], prefix); err != nil {
			t.Fatalf("seed type: %v", err)
		}
	}

	t.Cleanup(func() {
		// Clean up in dependency order: bindings → field → types.
		// types_fields.field FK is RESTRICT, so we must drop bindings before
		// the field. Types FK is CASCADE, so dropping types alone would purge
		// bindings, but we keep the explicit DELETE for clarity.
		//
		// Use a fresh background context — the test's ctx may have been
		// cancelled by the harness by the time cleanups fire. Surface any
		// cleanup failure via t.Logf so a future helper bug doesn't silently
		// re-introduce zombie test_field_* rows in the catalogue (the bug
		// this t.Cleanup block was originally added to prevent).
		cleanupCtx := context.Background()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM artefacts_types_fields WHERE artefacts_types_fields_id_field_library = $1`, fieldID); err != nil {
			t.Logf("cleanup: delete bindings for field %s: %v", fieldID, err)
		}
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM artefacts_fields_library WHERE artefacts_fields_library_id = $1`, fieldID); err != nil {
			t.Logf("cleanup: delete field %s: %v", fieldID, err)
		}
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM artefacts_types WHERE artefacts_types_id = ANY($1)`, []uuid.UUID{typeAID, typeBID}); err != nil {
			t.Logf("cleanup: delete types %s/%s: %v", typeAID, typeBID, err)
		}
	})
	return fieldID, subID, typeAID, typeBID
}

func TestReplaceBindingsForField_NewBinding(t *testing.T) {
	pool := newTestPool(t)
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
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, _, typeA, _ := seedTestRows(t, ctx, pool)

	// Different tenant's type id — typeA belongs to subA (seedTestRows's
	// synthetic sub) but the caller pretends to be subB.
	subB := uuid.New()

	_, err := svc.ReplaceBindingsForField(ctx, subB, fieldID,
		[]TypeBinding{{ArtefactTypeID: typeA, Position: 100}})
	if !errors.Is(err, ErrUnknownArtefactType) {
		t.Fatalf("cross-tenant must surface as ErrUnknownArtefactType, got %v", err)
	}
}

func TestUpdateBinding_PatchPosition(t *testing.T) {
	pool := newTestPool(t)
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
	ctx := context.Background()
	svc := &Service{artefactsPool: pool}

	fieldID, subID, typeA, _ := seedTestRows(t, ctx, pool)
	newPos := 100
	_, err := svc.UpdateBinding(ctx, subID, fieldID, typeA, BindingPatch{Position: &newPos})
	if !errors.Is(err, ErrBindingNotFound) {
		t.Fatalf("want ErrBindingNotFound, got %v", err)
	}
}
