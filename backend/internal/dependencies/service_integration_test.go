package dependencies

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Tier-B integration tests against the live dev vector_artefacts.
//
// These t.Skip when the tunnel/env is unavailable so go test ./... in
// fresh checkouts (without backend/.env.dev) passes silently. When
// the tunnel is up they exercise the SQL the unit tests stub out:
//   - sqlCycleWouldFormFromTo against a real 3-node chain.
//   - sqlInsertEdge / sqlInsertEdgeEvent against the live schema (so
//     a column rename in migs 173–175 surfaces as a test failure
//     instead of a wire-time 500).
//
// Every test wraps its writes in a tx that ROLLBACKs at the end, so
// dev DB state is unchanged between runs and parallel runs cannot
// fight over fixture rows.

// openTestPool opens a pgxpool against backend/.env.dev's
// VECTOR_ARTEFACTS_DB_URL. Skips when env or tunnel is absent.
// Mirrors the featuretests Tier-B helper to stay consistent.
func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		// Try to locate backend/.env.dev relative to common cwds. The
		// canonical run path is `go test ./internal/dependencies/...`
		// from backend/, so ../../.env.dev resolves to backend/.env.dev.
		for _, rel := range []string{"backend/.env.dev", "../../.env.dev", "../../../.env.dev"} {
			abs, _ := filepath.Abs(rel)
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				dsn = os.Getenv("VECTOR_ARTEFACTS_DB_URL")
				if dsn != "" {
					break
				}
			}
		}
	}
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set (no backend/.env.dev found) — Tier-B test skipped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("pgxpool.New: %v (tunnel down?) — Tier-B test skipped", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("pool.Ping: %v (tunnel down?) — Tier-B test skipped", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// findThreeArtefactsInNode returns a topology_node + 3 artefact ids
// under that node, plus the node's owning workspace + subscription.
// Skips the test when no such triple exists in the dev DB. Used by
// the cycle-rejection test as fixture input.
type fixture struct {
	subID, wsID, nodeID, a, b, c uuid.UUID
}

func findThreeArtefactsInNode(t *testing.T, ctx context.Context, pool *pgxpool.Pool) fixture {
	t.Helper()
	var f fixture
	err := pool.QueryRow(ctx, `
		SELECT n.topology_nodes_id,
		       n.topology_nodes_id_subscription
		  FROM topology_nodes n
		 WHERE n.topology_nodes_archived_at IS NULL
		   AND (
		       SELECT COUNT(*) FROM artefacts a
		        WHERE a.artefacts_id_topology_node = n.topology_nodes_id
		          AND a.artefacts_archived_at IS NULL
		   ) >= 3
		 LIMIT 1
	`).Scan(&f.nodeID, &f.subID)
	if err != nil {
		t.Skipf("no topology node with >=3 live artefacts in dev DB: %v", err)
	}
	// Resolve the owning workspace via topology root. master_record_workspaces
	// link is via topology_nodes.topology_nodes_id_workspace.
	err = pool.QueryRow(ctx, `
		SELECT topology_nodes_id_workspace
		  FROM topology_nodes
		 WHERE topology_nodes_id = $1
	`, f.nodeID).Scan(&f.wsID)
	if err != nil {
		t.Skipf("resolve workspace for node %s: %v", f.nodeID, err)
	}
	rows, err := pool.Query(ctx, `
		SELECT artefacts_id
		  FROM artefacts
		 WHERE artefacts_id_topology_node = $1
		   AND artefacts_archived_at IS NULL
		 ORDER BY artefacts_id
		 LIMIT 3
	`, f.nodeID)
	if err != nil {
		t.Skipf("select 3 artefacts: %v", err)
	}
	defer rows.Close()
	ids := []*uuid.UUID{&f.a, &f.b, &f.c}
	i := 0
	for rows.Next() {
		if err := rows.Scan(ids[i]); err != nil {
			t.Skipf("scan artefact: %v", err)
		}
		i++
	}
	if i != 3 {
		t.Skipf("expected 3 artefacts, got %d", i)
	}
	return f
}

// TestEdgeInsert_CycleRejected — AC-named regression for the
// directed cycle check (B23.1.6). Seeds a 3-node chain A→B→C inside
// a rollback'd tx, asks sqlCycleWouldFormFromTo whether C→A would
// close a cycle, asserts TRUE. Also asserts that adding a NEW edge
// that doesn't close a cycle reports FALSE — the negative case is
// what catches a CTE that mis-counts in the false-positive direction.
func TestEdgeInsert_CycleRejected(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	f := findThreeArtefactsInNode(t, ctx, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Insert a test map. Tx rolls back at end so dev DB state stays clean.
	var mapID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO artefact_dependency_maps (
		    artefact_dependency_maps_id_subscription,
		    artefact_dependency_maps_id_workspace,
		    artefact_dependency_maps_id_topology_node,
		    artefact_dependency_maps_name
		) VALUES ($1, $2, $3, $4)
		RETURNING artefact_dependency_maps_id
	`, f.subID, f.wsID, f.nodeID, "TestEdgeInsert_CycleRejected").Scan(&mapID)
	if err != nil {
		t.Fatalf("insert test map: %v", err)
	}

	// A → B
	if _, err := tx.Exec(ctx, sqlInsertEdge, mapID, f.a, f.b, "finish_to_start", nil); err != nil {
		t.Fatalf("insert A→B: %v", err)
	}
	// B → C
	if _, err := tx.Exec(ctx, sqlInsertEdge, mapID, f.b, f.c, "finish_to_start", nil); err != nil {
		t.Fatalf("insert B→C: %v", err)
	}

	// Cycle case: C → A would close A→B→C→A. Expect TRUE.
	var wouldCycleC2A bool
	if err := tx.QueryRow(ctx, sqlCycleWouldFormFromTo,
		mapID, f.c, f.a,
	).Scan(&wouldCycleC2A); err != nil {
		t.Fatalf("cycle check C→A: %v", err)
	}
	if !wouldCycleC2A {
		t.Errorf("expected cycle for C→A on chain A→B→C, got false (CTE may be walking the wrong direction)")
	}

	// 2-cycle case: B → A would close A→B↔B→A. Expect TRUE.
	var wouldCycleB2A bool
	if err := tx.QueryRow(ctx, sqlCycleWouldFormFromTo,
		mapID, f.b, f.a,
	).Scan(&wouldCycleB2A); err != nil {
		t.Fatalf("cycle check B→A: %v", err)
	}
	if !wouldCycleB2A {
		t.Errorf("expected cycle for B→A (reverse of A→B), got false (CTE misses 2-cycles)")
	}

	// Negative case: A → C does NOT close a cycle (it's a shortcut,
	// not a cycle). Walking forward from C reaches nothing in our
	// fixture; A is not reachable. Expect FALSE.
	var wouldCycleA2C bool
	if err := tx.QueryRow(ctx, sqlCycleWouldFormFromTo,
		mapID, f.a, f.c,
	).Scan(&wouldCycleA2C); err != nil {
		t.Fatalf("cycle check A→C: %v", err)
	}
	if wouldCycleA2C {
		t.Errorf("expected no cycle for A→C (forward shortcut), got true (CTE false-positives)")
	}
}

// TestEdgeInsert_UniquenessAndAudit exercises the three partial unique
// indexes + the same-tx audit-event write. Same fixture pattern: build
// a map, insert one edge per kind, verify constraints fire, ROLLBACK.
func TestEdgeInsert_UniquenessAndAudit(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	f := findThreeArtefactsInNode(t, ctx, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var mapID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO artefact_dependency_maps (
		    artefact_dependency_maps_id_subscription,
		    artefact_dependency_maps_id_workspace,
		    artefact_dependency_maps_id_topology_node,
		    artefact_dependency_maps_name
		) VALUES ($1, $2, $3, $4)
		RETURNING artefact_dependency_maps_id
	`, f.subID, f.wsID, f.nodeID, "TestEdgeInsert_UniquenessAndAudit").Scan(&mapID)
	if err != nil {
		t.Fatalf("insert test map: %v", err)
	}

	// Insert A → B (directed). Should succeed.
	var edgeID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO artefact_dependency_edges (
		    artefact_dependency_edges_id_map,
		    artefact_dependency_edges_id_from_artefact,
		    artefact_dependency_edges_id_to_artefact,
		    artefact_dependency_edges_kind
		) VALUES ($1, $2, $3, 'finish_to_start')
		RETURNING artefact_dependency_edges_id
	`, mapID, f.a, f.b).Scan(&edgeID)
	if err != nil {
		t.Fatalf("insert A→B: %v", err)
	}

	// Re-insert A → B inside a SAVEPOINT — 23505 directed-pair partial
	// unique index. Savepoint lets the outer tx survive the violation
	// so the rest of the assertions can run.
	mustSavepoint(t, ctx, tx, "dup_directed", func() error {
		_, e := tx.Exec(ctx, `
			INSERT INTO artefact_dependency_edges (
			    artefact_dependency_edges_id_map,
			    artefact_dependency_edges_id_from_artefact,
			    artefact_dependency_edges_id_to_artefact,
			    artefact_dependency_edges_kind
			) VALUES ($1, $2, $3, 'finish_to_start')
		`, mapID, f.a, f.b)
		if !isUniqueViolation(e) {
			t.Errorf("expected 23505 on duplicate A→B finish_to_start, got %v", e)
		}
		return e
	})

	// Attempt (A, B, parallel) inside a SAVEPOINT — same canonical
	// pair as A→B above; cross-kind canonical unique index rejects.
	mustSavepoint(t, ctx, tx, "cross_kind", func() error {
		_, e := tx.Exec(ctx, `
			INSERT INTO artefact_dependency_edges (
			    artefact_dependency_edges_id_map,
			    artefact_dependency_edges_id_from_artefact,
			    artefact_dependency_edges_id_to_artefact,
			    artefact_dependency_edges_kind
			) VALUES ($1, $2, $3, 'parallel')
		`, mapID, f.a, f.b)
		if !isUniqueViolation(e) {
			t.Errorf("expected 23505 on cross-kind canonical pair (A,B), got %v", e)
		}
		return e
	})

	// Same-tx audit event write — verifies the audit table accepts
	// the canonical column shape (column-name regression catcher).
	_, err = tx.Exec(ctx, sqlInsertEdgeEvent,
		edgeID,
		"created",
		nil,
		`{"subscription_id":"00000000-0000-0000-0000-000000000000"}`,
		`{"kind":"finish_to_start"}`,
	)
	if err != nil {
		t.Errorf("insert audit event: %v", err)
	}
}

// mustSavepoint runs fn inside a SAVEPOINT and rolls back to it
// regardless of fn's outcome, so a SQLSTATE 25P02 abort on one
// assertion doesn't poison the rest of the outer tx.
func mustSavepoint(t *testing.T, ctx context.Context, tx pgx.Tx, name string, fn func() error) {
	t.Helper()
	if _, err := tx.Exec(ctx, "SAVEPOINT "+name); err != nil {
		t.Fatalf("savepoint %s: %v", name, err)
	}
	_ = fn()
	if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT "+name); err != nil {
		t.Fatalf("rollback to savepoint %s: %v", name, err)
	}
}
