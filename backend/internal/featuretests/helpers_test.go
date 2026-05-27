// helpers_test.go — shared featuretests helpers.
//
// Recovered from the deleted f1_workspace_clamp_test.go (commit 42d08d91,
// sentinel S25 cleanup). f3_dto_slot_test.go + f3_slot_substrate_test.go
// + f7_priority_substrate_test.go still call these helpers; deleting the
// f1 file took them out and broke `go vet ./...`.
//
// Naming is preserved (`vectorArtefactsPoolForF1`, `f1FindTwoDistinctWorkspaces`,
// `f1WorkspaceFixture`) so the call sites need no edits. The `F1` suffix
// is historical — the helpers are generally useful, not F1-specific.
//
// Build tag: none. These helpers run only when callers invoke them; the
// pool helper t.Skip()s if the dev tunnel is down so this file never
// blocks `go test ./...` in environments without a live DB.

package featuretests_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// f1WorkspaceFixture pairs a subscription id with a workspace id, used
// by the Tier-B substrate tests to assert workspace-clamp behaviour.
type f1WorkspaceFixture struct {
	subID uuid.UUID
	wsID  uuid.UUID
}

// errNoTwoDistinct signals fewer than 2 distinct (sub, ws) pairs exist
// in the dev DB. Callers t.Skip() rather than fail when they hit this.
var errNoTwoDistinct = errors.New("fewer than 2 distinct (subscription, workspace) pairs in artefacts_types")

// vectorArtefactsPoolForF1 opens the dev vector_artefacts pool used by
// the Tier-B integration tests. Mirrors the migration test's logic so
// every Tier-B helper shares the same tunnel-down skip behaviour.
func vectorArtefactsPoolForF1(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		for _, rel := range []string{"backend/.env.dev", "../../.env.dev", "../../../.env.dev"} {
			abs, _ := filepath.Abs(rel)
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				dsn = os.Getenv("VECTOR_ARTEFACTS_DB_URL")
				break
			}
		}
	}
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set (tunnel down or env missing)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}
	return pool
}

// f1FindTwoDistinctWorkspaces walks artefacts_types looking for two
// (subscription_id, workspace_id) pairs that differ in BOTH fields.
// Returns errNoTwoDistinct when the dev DB has fewer than 2 distinct
// pairs — the caller's test t.Skip's gracefully in that case.
//
// Prefers pairs that have at least one live work-scope artefact each
// (so the work-items Tier-B tests have something to compare against);
// falls back to any two distinct pairs when no pair has artefacts.
func f1FindTwoDistinctWorkspaces(ctx context.Context, pool *pgxpool.Pool) (f1WorkspaceFixture, f1WorkspaceFixture, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			at.artefacts_types_id_subscription,
			at.artefacts_types_id_workspace,
			COUNT(a.id) AS artefact_count
		  FROM artefacts_types at
		  LEFT JOIN artefacts a ON a.artefact_type_id = at.artefacts_types_id
		                       AND a.archived_at IS NULL
		 WHERE at.artefacts_types_archived_at IS NULL
		   AND at.artefacts_types_scope = 'work'
		 GROUP BY at.artefacts_types_id_subscription, at.artefacts_types_id_workspace
		 ORDER BY artefact_count DESC
		 LIMIT 50
	`)
	if err != nil {
		return f1WorkspaceFixture{}, f1WorkspaceFixture{}, err
	}
	defer rows.Close()
	pairs := []f1WorkspaceFixture{}
	for rows.Next() {
		var p f1WorkspaceFixture
		var count int
		if err := rows.Scan(&p.subID, &p.wsID, &count); err != nil {
			return f1WorkspaceFixture{}, f1WorkspaceFixture{}, err
		}
		pairs = append(pairs, p)
	}
	for i := range pairs {
		for j := i + 1; j < len(pairs); j++ {
			if pairs[i].subID != pairs[j].subID && pairs[i].wsID != pairs[j].wsID {
				return pairs[i], pairs[j], nil
			}
		}
	}
	return f1WorkspaceFixture{}, f1WorkspaceFixture{}, errNoTwoDistinct
}
