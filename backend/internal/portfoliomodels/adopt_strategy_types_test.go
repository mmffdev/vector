package portfoliomodels

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// PLA-0026 / Story 00492 (B3): integration test for the strategy
// artefacts_types writer. Hits the live vector_artefacts DB via the SSH
// tunnel on :5435. Per repo convention we do not mock the DB — mirrors
// the resolver_test.go shape from B2.
//
// Coverage:
//   - happy path: 3-layer bundle (root + 2 children) writes 3 rows with
//     correct scope/source/provenance and parent_type_id resolved
//   - idempotency: re-running the writer with the same bundle is a no-op
//   - archived layers: rows marked ArchivedAt are skipped
//   - parent missing in bundle: error surfaced (defensive — should not
//     happen with a real bundle but the writer must not silently corrupt)

func vaTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=adopt_strategy_types_test",
		os.Getenv("VA_DB_HOST"),
		os.Getenv("VA_DB_PORT"),
		os.Getenv("VA_DB_USER"),
		os.Getenv("VA_DB_PASSWORD"),
		os.Getenv("VA_DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts: %v", err)
	}
	return pool
}

// runInVATx wraps fn in a fresh SERIALIZABLE tx + commits, mirroring the
// orchestrator's runVAStep. Returns commit error or fn error.
func runInVATx(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) {
	t.Helper()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin va tx: %v", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		t.Fatalf("writer: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit va tx: %v", err)
	}
}

func strPtr(s string) *string { return &s }

// mkBundle builds a 3-layer bundle: root → child1, child2. Caller passes
// suffix to keep prefixes/names unique across test runs.
func mkBundle(suffix string) (*librarydb.Bundle, uuid.UUID, uuid.UUID, uuid.UUID) {
	rootID := uuid.New()
	c1ID := uuid.New()
	c2ID := uuid.New()
	rootDesc := strPtr("root layer description")
	c1Desc := strPtr("child 1 description")
	bundle := &librarydb.Bundle{
		Layers: []librarydb.Layer{
			{
				ID:             rootID,
				Name:           "Root_" + suffix,
				Tag:            "R" + suffix[:2],
				SortOrder:      0,
				ParentLayerID:  nil,
				DescriptionMD:  rootDesc,
				AllowsChildren: true,
			},
			{
				ID:             c1ID,
				Name:           "Child1_" + suffix,
				Tag:            "C" + suffix[:2],
				SortOrder:      10,
				ParentLayerID:  &rootID,
				DescriptionMD:  c1Desc,
				AllowsChildren: false,
			},
			{
				ID:             c2ID,
				Name:           "Child2_" + suffix,
				Tag:            "D" + suffix[:2],
				SortOrder:      20,
				ParentLayerID:  &rootID,
				DescriptionMD:  nil,
				AllowsChildren: false,
			},
		},
	}
	return bundle, rootID, c1ID, c2ID
}

func cleanupStrategyTypes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) {
	t.Helper()
	_, _ = pool.Exec(ctx,
		`DELETE FROM artefacts_types WHERE artefacts_types_id_workspace = $1 AND artefacts_types_scope = 'strategy'`,
		workspaceID)
}

func TestWriteStrategyArtefactTypes_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, rootID, c1ID, c2ID := mkBundle(suffix)

	defer cleanupStrategyTypes(t, ctx, pool, workspaceID)

	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		return writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// Three rows landed.
	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_scope = 'strategy' AND artefacts_types_archived_at IS NULL`,
		workspaceID).Scan(&n); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if n != 3 {
		t.Fatalf("row count: want 3, got %d", n)
	}

	// Provenance + scope + source check on root.
	var (
		gotScope, gotSource string
		gotLibID            uuid.UUID
		gotLibTag, gotName  string
		gotParent           *uuid.UUID
	)
	if err := pool.QueryRow(ctx, `
		SELECT artefacts_types_scope, artefacts_types_source, artefacts_types_id_library_layer, artefacts_types_library_layer_tag, artefacts_types_name, artefacts_types_id_parent_type
		  FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_id_library_layer = $2`,
		workspaceID, rootID).Scan(&gotScope, &gotSource, &gotLibID, &gotLibTag, &gotName, &gotParent); err != nil {
		t.Fatalf("load root row: %v", err)
	}
	if gotScope != "strategy" {
		t.Errorf("scope: want strategy, got %q", gotScope)
	}
	if gotSource != "tenant" {
		t.Errorf("source: want tenant, got %q", gotSource)
	}
	if gotLibID != rootID {
		t.Errorf("library_layer_id: want %s, got %s", rootID, gotLibID)
	}
	if gotLibTag != bundle.Layers[0].Tag {
		t.Errorf("library_layer_tag: want %s, got %s", bundle.Layers[0].Tag, gotLibTag)
	}
	if gotParent != nil {
		t.Errorf("root.parent_type_id: want NULL, got %v", gotParent)
	}

	// Phase 2: each child's parent_type_id resolves to the root mirror.
	var rootMirID uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT artefacts_types_id FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_id_library_layer = $2`,
		workspaceID, rootID).Scan(&rootMirID); err != nil {
		t.Fatalf("load root mirror id: %v", err)
	}
	for _, libID := range []uuid.UUID{c1ID, c2ID} {
		var parentMir *uuid.UUID
		if err := pool.QueryRow(ctx, `
			SELECT artefacts_types_id_parent_type FROM artefacts_types
			 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_id_library_layer = $2`,
			workspaceID, libID).Scan(&parentMir); err != nil {
			t.Fatalf("load child %s: %v", libID, err)
		}
		if parentMir == nil {
			t.Errorf("child %s parent_type_id: want %s, got NULL", libID, rootMirID)
			continue
		}
		if *parentMir != rootMirID {
			t.Errorf("child %s parent_type_id: want %s, got %s", libID, rootMirID, *parentMir)
		}
	}
}

func TestWriteStrategyArtefactTypes_Idempotent(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, _, _ := mkBundle(suffix)

	defer cleanupStrategyTypes(t, ctx, pool, workspaceID)

	// First write: 3 rows.
	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		return writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	// Second write: ON CONFLICT DO NOTHING — still 3 rows.
	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		return writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_scope = 'strategy' AND artefacts_types_archived_at IS NULL`,
		workspaceID).Scan(&n); err != nil {
		t.Fatalf("count after 2x writes: %v", err)
	}
	if n != 3 {
		t.Errorf("idempotent re-run: want 3 rows, got %d", n)
	}
}

func TestWriteStrategyArtefactTypes_SkipsArchivedLayers(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()
	bundle, _, c1ID, _ := mkBundle(suffix)
	// Archive child1 in the bundle.
	now := time.Now().UTC()
	for i := range bundle.Layers {
		if bundle.Layers[i].ID == c1ID {
			bundle.Layers[i].ArchivedAt = &now
		}
	}

	defer cleanupStrategyTypes(t, ctx, pool, workspaceID)

	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		return writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle)
	})

	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_scope = 'strategy' AND artefacts_types_archived_at IS NULL`,
		workspaceID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	// Root + child2 = 2; child1 archived in bundle so skipped.
	if n != 2 {
		t.Errorf("archived-skip: want 2 rows, got %d", n)
	}

	// The archived child1 must have NO row.
	var nC1 int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_id_library_layer = $2`,
		workspaceID, c1ID).Scan(&nC1); err != nil {
		t.Fatalf("count c1: %v", err)
	}
	if nC1 != 0 {
		t.Errorf("archived child1: want 0 rows, got %d", nC1)
	}
}

func TestWriteStrategyArtefactTypes_OrphanParentErrors(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:6]
	subscriptionID := uuid.New()
	workspaceID := uuid.New()

	// Single-child bundle pointing at a parent_layer_id NOT present in
	// bundle.Layers — defensive corruption probe.
	missingParent := uuid.New()
	childID := uuid.New()
	desc := strPtr("orphan child")
	bundle := &librarydb.Bundle{
		Layers: []librarydb.Layer{
			{
				ID:             childID,
				Name:           "OrphanChild_" + suffix,
				Tag:            "O" + suffix[:2],
				SortOrder:      0,
				ParentLayerID:  &missingParent,
				DescriptionMD:  desc,
				AllowsChildren: false,
			},
		},
	}

	defer cleanupStrategyTypes(t, ctx, pool, workspaceID)

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)
	err = writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle)
	if err == nil {
		t.Fatalf("orphan parent: want error, got nil")
	}
}

