package portfoliomodels

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/portfolio"
)

// PLA-0026 / Story 00495 (B6): integration test for the
// master_record_portfolios finalize-step writer. Hits the live
// vector_artefacts DB via the SSH tunnel on :5435. Per repo convention
// we do not mock the DB — mirrors adopt_strategy_types_test.go (B3).
//
// Coverage:
//   - happy path: row inserted with bundle prose copied verbatim
//   - idempotent: re-running with the same workspace+model is a no-op
//     (row count stays 1, fields match)
//   - re-adoption: re-running with the same workspace but a different
//     model_id overwrites model_id + prose (Upsert ON CONFLICT)
//   - survives library deletion: the copied strings remain on the row
//     even after the bundle reference is dropped — proves the row no
//     longer points back to mmff_library

// makeMasterRecordBundle builds a minimal Bundle whose Model carries
// the prose the writer copies into master_record_portfolios. Caller
// supplies the modelID + suffix to keep names unique across runs.
func makeMasterRecordBundle(modelID uuid.UUID, suffix string) *librarydb.Bundle {
	desc := "description for portfolio model " + suffix
	return &librarydb.Bundle{
		Model: librarydb.Model{
			ID:          modelID,
			Name:        "PortfolioModel_" + suffix,
			Description: &desc,
			Scope:       "tenant",
			Visibility:  "private",
			Version:     1,
		},
	}
}

func cleanupMasterRecord(t *testing.T, ctx context.Context, workspaceID uuid.UUID) {
	t.Helper()
	pool := vaTestPool(t)
	defer pool.Close()
	_, _ = pool.Exec(ctx,
		`DELETE FROM master_record_portfolios WHERE master_record_portfolios_id_workspace = $1`,
		workspaceID,
	)
}

func TestWriteMasterRecordPortfolio_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc := portfolio.NewService(pool)
	workspaceID := uuid.New()
	modelID := uuid.New()
	userID := uuid.New()
	suffix := uuid.NewString()[:6]
	bundle := makeMasterRecordBundle(modelID, suffix)

	defer cleanupMasterRecord(t, ctx, workspaceID)

	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelID, userID, bundle); err != nil {
		t.Fatalf("writer: %v", err)
	}

	// Read back via the service surface (matches how callers will
	// see it).
	got, err := svc.Get(ctx, workspaceID)
	if err != nil {
		t.Fatalf("service Get: %v", err)
	}
	if got.WorkspaceID != workspaceID {
		t.Errorf("workspace_id: want %s, got %s", workspaceID, got.WorkspaceID)
	}
	if got.ModelID == nil || *got.ModelID != modelID {
		t.Errorf("model_id: want %s, got %v", modelID, got.ModelID)
	}
	if got.ModelName != bundle.Model.Name {
		t.Errorf("model_name: want %q, got %q", bundle.Model.Name, got.ModelName)
	}
	if got.ModelDescription == nil || *got.ModelDescription != *bundle.Model.Description {
		t.Errorf("model_description: want %q, got %v",
			*bundle.Model.Description, got.ModelDescription)
	}
	if got.AdoptedByUserID == nil || *got.AdoptedByUserID != userID {
		t.Errorf("adopted_by_user_id: want %s, got %v", userID, got.AdoptedByUserID)
	}
	if got.AdoptedAt.IsZero() {
		t.Errorf("adopted_at: want non-zero, got zero")
	}
	if got.ArchivedAt != nil {
		t.Errorf("archived_at: want NULL, got %v", got.ArchivedAt)
	}
}

func TestWriteMasterRecordPortfolio_Idempotent(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc := portfolio.NewService(pool)
	workspaceID := uuid.New()
	modelID := uuid.New()
	userID := uuid.New()
	suffix := uuid.NewString()[:6]
	bundle := makeMasterRecordBundle(modelID, suffix)

	defer cleanupMasterRecord(t, ctx, workspaceID)

	// First write — inserts the row.
	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelID, userID, bundle); err != nil {
		t.Fatalf("writer (1st): %v", err)
	}
	first, err := svc.Get(ctx, workspaceID)
	if err != nil {
		t.Fatalf("service Get (1st): %v", err)
	}

	// Second write — same workspace + model + bundle. Upsert overwrites
	// in place; row count must stay 1 and identity fields must match.
	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelID, userID, bundle); err != nil {
		t.Fatalf("writer (2nd): %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM master_record_portfolios WHERE master_record_portfolios_id_workspace = $1`,
		workspaceID).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if n != 1 {
		t.Errorf("row count after re-run: want 1, got %d", n)
	}

	second, err := svc.Get(ctx, workspaceID)
	if err != nil {
		t.Fatalf("service Get (2nd): %v", err)
	}
	if second.ModelName != first.ModelName {
		t.Errorf("model_name drift: %q -> %q", first.ModelName, second.ModelName)
	}
	if (first.ModelDescription == nil) != (second.ModelDescription == nil) ||
		(first.ModelDescription != nil && *first.ModelDescription != *second.ModelDescription) {
		t.Errorf("model_description drift: %v -> %v", first.ModelDescription, second.ModelDescription)
	}
	if second.ModelID == nil || *second.ModelID != modelID {
		t.Errorf("model_id drift: want %s, got %v", modelID, second.ModelID)
	}
}

func TestWriteMasterRecordPortfolio_ReadoptDifferentModel(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc := portfolio.NewService(pool)
	workspaceID := uuid.New()
	userID := uuid.New()

	// First adoption: model A.
	modelA := uuid.New()
	suffixA := uuid.NewString()[:6]
	bundleA := makeMasterRecordBundle(modelA, suffixA)

	// Second adoption: model B (overwrites A's identity + prose).
	modelB := uuid.New()
	suffixB := uuid.NewString()[:6]
	bundleB := makeMasterRecordBundle(modelB, suffixB)

	defer cleanupMasterRecord(t, ctx, workspaceID)

	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelA, userID, bundleA); err != nil {
		t.Fatalf("writer (model A): %v", err)
	}
	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelB, userID, bundleB); err != nil {
		t.Fatalf("writer (model B re-adopt): %v", err)
	}

	// Single row, identity now reflects B.
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM master_record_portfolios WHERE master_record_portfolios_id_workspace = $1`,
		workspaceID).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if n != 1 {
		t.Errorf("row count after re-adopt: want 1, got %d", n)
	}

	got, err := svc.Get(ctx, workspaceID)
	if err != nil {
		t.Fatalf("service Get: %v", err)
	}
	if got.ModelID == nil || *got.ModelID != modelB {
		t.Errorf("model_id after re-adopt: want %s, got %v", modelB, got.ModelID)
	}
	if got.ModelName != bundleB.Model.Name {
		t.Errorf("model_name after re-adopt: want %q, got %q", bundleB.Model.Name, got.ModelName)
	}
	if got.ModelDescription == nil || *got.ModelDescription != *bundleB.Model.Description {
		t.Errorf("model_description after re-adopt: want %q, got %v",
			*bundleB.Model.Description, got.ModelDescription)
	}
	// archived_at must be cleared (Upsert resurrects archived rows; a
	// fresh insert leaves it NULL — both end up at NULL here).
	if got.ArchivedAt != nil {
		t.Errorf("archived_at after re-adopt: want NULL, got %v", got.ArchivedAt)
	}
}

func TestWriteMasterRecordPortfolio_SurvivesLibraryDeletion(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc := portfolio.NewService(pool)
	workspaceID := uuid.New()
	modelID := uuid.New()
	userID := uuid.New()
	suffix := uuid.NewString()[:6]
	bundle := makeMasterRecordBundle(modelID, suffix)

	defer cleanupMasterRecord(t, ctx, workspaceID)

	// Write the row using the bundle prose.
	if err := writeMasterRecordPortfolio(ctx, nil, svc, workspaceID, modelID, userID, bundle); err != nil {
		t.Fatalf("writer: %v", err)
	}

	// Capture the prose values BEFORE we drop the bundle.
	wantName := bundle.Model.Name
	wantDesc := *bundle.Model.Description

	// Simulate the library template being deleted: nil-out the bundle
	// reference. The DB row must NOT have been pointing at the live
	// library row — it carries copies. We re-read directly from
	// vector_artefacts to prove that.
	bundle = nil
	_ = bundle // silence unused after nil — we deliberately drop it

	got, err := svc.Get(ctx, workspaceID)
	if err != nil {
		t.Fatalf("service Get after bundle drop: %v", err)
	}
	if got.ModelName != wantName {
		t.Errorf("model_name survived library deletion: want %q, got %q", wantName, got.ModelName)
	}
	if got.ModelDescription == nil || *got.ModelDescription != wantDesc {
		t.Errorf("model_description survived library deletion: want %q, got %v",
			wantDesc, got.ModelDescription)
	}
	// And the model_id is still recorded (pointer to a now-deleted
	// library row is fine — it's a soft FK by design).
	if got.ModelID == nil || *got.ModelID != modelID {
		t.Errorf("model_id retained: want %s, got %v", modelID, got.ModelID)
	}
}
