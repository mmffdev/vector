package artefacttypes

// DB-backed tests for Service.CreateWorkType.
// Requires a live vector_artefacts pool (VA_DB_* env vars or .env.local).
// Skips cleanly when the pool is unavailable, mirroring seed_test.go.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/flows"
)

// testPool acquires a vector_artefacts pool the same way vaPoolForSeedTest
// (seed_test.go) does — env-var DSN, skip-if-unavailable — but registers a
// pool.Close on cleanup so each test owns its connection lifetime.
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
		" sslmode=disable application_name=artefacttypes_create_test"
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

// seedTestSubscription returns a fresh subscription id. There is no FK from
// artefacts_types to a subscriptions table (verified against pg_constraint),
// so a random UUID is a valid, isolated tenant key for the test.
func seedTestSubscription(t *testing.T, _ *pgxpool.Pool) uuid.UUID {
	t.Helper()
	return uuid.New()
}

// seedTestWorkspace returns a fresh workspace id scoped to the subscription.
// Same rationale as seedTestSubscription — no FK to enforce, isolation by
// fresh UUID. The pair (sub, ws) clamps every row this test creates.
func seedTestWorkspace(t *testing.T, _ *pgxpool.Pool, _ uuid.UUID) uuid.UUID {
	t.Helper()
	return uuid.New()
}

// seedWorkType inserts a system work type with the given slot and
// execution_parent_slots, registering a cleanup that removes it.
func seedWorkType(t *testing.T, pool *pgxpool.Pool, subID, wsID uuid.UUID, name, prefix, slot string, slots []string) *ArtefactType {
	t.Helper()
	ctx := context.Background()
	var out ArtefactType
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_slot,
			artefacts_types_execution_parent_slots,
			artefacts_types_allows_children, artefacts_types_sort_order
		) VALUES ($1,$2,'work','system',$3,$4,$5,$6,FALSE,0)
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_slot, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at,
			artefacts_types_created_at, artefacts_types_updated_at,
			artefacts_types_execution_parent_slots`,
		subID, wsID, name, prefix, slot, slots,
	).Scan(
		&out.ID, &out.Scope, &out.Source, &out.Name, &out.Prefix, &out.Description,
		&out.Colour, &out.Slot, &out.ParentTypeID, &out.AllowsChildren, &out.LayerDepth,
		&out.SortOrder, &out.ArchivedAt, &out.CreatedAt, &out.UpdatedAt, &out.ExecutionParentSlots,
	)
	if err != nil {
		t.Fatalf("seedWorkType %q: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts_types WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2`,
			subID, wsID,
		)
	})
	return &out
}

func ptr[T any](v T) *T { return &v }

func errorAs[T error](err error, target *T) bool { return errors.As(err, target) }

func TestCreateWorkType_HappyPath(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool, flows.New(pool, pool))
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
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

	// The new type must have a seeded default flow with at least 3 states. The
	// behaves-like Story seeded here has no flow, so the fallback standard spine
	// gives 5 states — assert ≥3 to be robust to either path.
	var stateCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM flows_states st
		JOIN flows f ON f.flows_id = st.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1 AND f.flows_is_default AND f.flows_archived_at IS NULL
		  AND st.flows_states_archived_at IS NULL`,
		out.ID,
	).Scan(&stateCount); err != nil {
		t.Fatalf("count seeded flow states: %v", err)
	}
	if stateCount < 3 {
		t.Errorf("expected a default flow with ≥3 states, got %d", stateCount)
	}
}

func TestCreateWorkType_DuplicatePrefix(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool, flows.New(pool, pool))
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
