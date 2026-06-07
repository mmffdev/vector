package flows

// DB-backed tests for Service.SeedDefaultFlowForType — the default-flow clone
// primitive used by artefacttypes.CreateWorkType. Requires a live
// vector_artefacts pool (VA_DB_* env vars or .env.local). Skips cleanly when
// the pool is unavailable, mirroring artefacttypes/seed_test.go.

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// testPool acquires a vector_artefacts pool via an env-var DSN, skipping the
// test when the pool is unavailable. Registers pool.Close on cleanup.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := "host=" + os.Getenv("VA_DB_HOST") +
		" port=" + os.Getenv("VA_DB_PORT") +
		" user=" + os.Getenv("VA_DB_USER") +
		" password=" + os.Getenv("VA_DB_PASSWORD") +
		" dbname=" + os.Getenv("VA_DB_NAME") +
		" sslmode=disable application_name=flows_seed_test"
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedSubWs returns a fresh (subscription, workspace) id pair. No FK to
// enforce; isolation by fresh UUID.
func seedSubWs(t *testing.T, _ *pgxpool.Pool) (uuid.UUID, uuid.UUID) {
	t.Helper()
	return uuid.New(), uuid.New()
}

// seedWorkType inserts a system work type and registers cleanup that removes
// every artefacts_types row (and cascaded flows) for the (sub, ws) pair.
func seedWorkType(t *testing.T, pool *pgxpool.Pool, subID, wsID uuid.UUID, name, prefix string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix,
			artefacts_types_allows_children, artefacts_types_sort_order
		) VALUES ($1,$2,'work','system',$3,$4,FALSE,0)
		RETURNING artefacts_types_id`,
		subID, wsID, name, prefix,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedWorkType %q: %v", name, err)
	}
	t.Cleanup(func() {
		// flows.flows_id_artefact_type is ON DELETE RESTRICT, so the type
		// delete fails while a flow references it. Delete flows first (their
		// states + transitions cascade), then flows_defaults, then the types.
		_, _ = pool.Exec(ctx, `DELETE FROM flows WHERE flows_id_artefact_type IN (
			SELECT artefacts_types_id FROM artefacts_types
			WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2)`, subID, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM flows_defaults WHERE flows_defaults_id_artefact_type IN (
			SELECT artefacts_types_id FROM artefacts_types
			WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2)`, subID, wsID)
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts_types WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2`,
			subID, wsID,
		)
	})
	return id
}

// seedFlow inserts a default flow for the given type and returns its id.
func seedFlow(t *testing.T, pool *pgxpool.Pool, typeID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO flows (flows_id_artefact_type, flows_name, flows_is_default)
		VALUES ($1, 'src flow', TRUE) RETURNING flows_id`,
		typeID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedFlow: %v", err)
	}
	return id
}

// seedState inserts one state into a flow and returns its id.
func seedState(t *testing.T, pool *pgxpool.Pool, flowID uuid.UUID, name, kind string, isInitial, isPullable bool, sortOrder int) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO flows_states (flows_states_id_flow, flows_states_name, flows_states_kind,
			flows_states_sort_order, flows_states_is_initial, flows_states_is_pullable)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING flows_states_id`,
		flowID, name, kind, sortOrder, isInitial, isPullable,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedState %q: %v", name, err)
	}
	return id
}

// seedTransition inserts one directed edge into a flow.
func seedTransition(t *testing.T, pool *pgxpool.Pool, flowID, from, to uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO flows_transitions (flows_transitions_id_flow, flows_transitions_id_state_from, flows_transitions_id_state_to)
		VALUES ($1,$2,$3)`,
		flowID, from, to,
	)
	if err != nil {
		t.Fatalf("seedTransition: %v", err)
	}
}

// assertFlowStateCount asserts the type's live default flow has exactly want
// live states.
func assertFlowStateCount(t *testing.T, pool *pgxpool.Pool, typeID uuid.UUID, want int) {
	t.Helper()
	var got int
	err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM flows_states st
		JOIN flows f ON f.flows_id = st.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1 AND f.flows_is_default AND f.flows_archived_at IS NULL
		  AND st.flows_states_archived_at IS NULL`,
		typeID,
	).Scan(&got)
	if err != nil {
		t.Fatalf("assertFlowStateCount query: %v", err)
	}
	if got != want {
		t.Fatalf("flow state count = %d, want %d", got, want)
	}
}

// assertTransitionCount asserts the type's live default flow has exactly want
// transitions.
func assertTransitionCount(t *testing.T, pool *pgxpool.Pool, typeID uuid.UUID, want int) {
	t.Helper()
	var got int
	err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM flows_transitions tr
		JOIN flows f ON f.flows_id = tr.flows_transitions_id_flow
		WHERE f.flows_id_artefact_type = $1 AND f.flows_is_default AND f.flows_archived_at IS NULL`,
		typeID,
	).Scan(&got)
	if err != nil {
		t.Fatalf("assertTransitionCount query: %v", err)
	}
	if got != want {
		t.Fatalf("transition count = %d, want %d", got, want)
	}
}

// assertHasState asserts the type's live default flow contains a state with the
// given name/kind/is_initial.
func assertHasState(t *testing.T, pool *pgxpool.Pool, typeID uuid.UUID, name, kind string, isInitial bool) {
	t.Helper()
	var ok bool
	err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM flows_states st
			JOIN flows f ON f.flows_id = st.flows_states_id_flow
			WHERE f.flows_id_artefact_type = $1 AND f.flows_is_default AND f.flows_archived_at IS NULL
			  AND st.flows_states_archived_at IS NULL
			  AND st.flows_states_name = $2 AND st.flows_states_kind = $3
			  AND st.flows_states_is_initial = $4
		)`,
		typeID, name, kind, isInitial,
	).Scan(&ok)
	if err != nil {
		t.Fatalf("assertHasState query: %v", err)
	}
	if !ok {
		t.Fatalf("expected state name=%q kind=%q is_initial=%v not found", name, kind, isInitial)
	}
}

// Source type has a 2-state flow + 1 transition; cloning onto a new type
// reproduces states + transitions.
func TestSeedDefaultFlowForType_ClonesSource(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	subID, wsID := seedSubWs(t, pool)

	srcType := seedWorkType(t, pool, subID, wsID, "Story", "US")
	dstType := seedWorkType(t, pool, subID, wsID, "Spike", "SP")
	// Give the source a 2-state flow + 1 transition.
	srcFlow := seedFlow(t, pool, srcType)
	s1 := seedState(t, pool, srcFlow, "Backlog", "backlog", true, false, 10)
	s2 := seedState(t, pool, srcFlow, "Doing", "in_progress", false, true, 20)
	seedTransition(t, pool, srcFlow, s1, s2)

	tx, _ := pool.Begin(ctx)
	defer tx.Rollback(ctx)
	svc := New(pool, pool)
	if err := svc.SeedDefaultFlowForType(ctx, tx, srcType, dstType, "Spike"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// dst now has one default flow with 2 states + 1 transition.
	assertFlowStateCount(t, pool, dstType, 2)
	assertTransitionCount(t, pool, dstType, 1)
	assertHasState(t, pool, dstType, "Backlog", "backlog", true)
}

// Source type has NO flow → fallback seeds the 5-state standard spine.
func TestSeedDefaultFlowForType_FallbackSpine(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	subID, wsID := seedSubWs(t, pool)
	srcType := seedWorkType(t, pool, subID, wsID, "NoFlow", "NF") // no flow seeded
	dstType := seedWorkType(t, pool, subID, wsID, "Spike2", "S2")

	tx, _ := pool.Begin(ctx)
	defer tx.Rollback(ctx)
	svc := New(pool, pool)
	if err := svc.SeedDefaultFlowForType(ctx, tx, srcType, dstType, "Spike2"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	assertFlowStateCount(t, pool, dstType, 5) // standard spine
	assertHasState(t, pool, dstType, "Accepted", "accepted", false)
}
