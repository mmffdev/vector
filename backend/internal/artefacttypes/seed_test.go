package artefacttypes

// Integration test for SeedDefaultWorkspaceTypes.
// Requires a live vector_artefacts pool (VA_DB_* env vars or .env.local).
// Skips cleanly when the pool is unavailable.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func vaPoolForSeedTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=artefacttypes_seed_test",
		os.Getenv("VA_DB_HOST"),
		os.Getenv("VA_DB_PORT"),
		os.Getenv("VA_DB_USER"),
		os.Getenv("VA_DB_PASSWORD"),
		os.Getenv("VA_DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts: %v", err)
	}
	return pool
}

func TestSeedDefaultWorkspaceTypes(t *testing.T) {
	pool := vaPoolForSeedTest(t)
	defer pool.Close()

	ctx := context.Background()
	svc := NewService(pool)

	subID := uuid.New()
	wsID := uuid.New()

	// Cleanup after test.
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts_types WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2`,
			subID, wsID,
		)
	})

	t.Run("seeds 5 system work types", func(t *testing.T) {
		if err := svc.SeedDefaultWorkspaceTypes(ctx, subID, wsID); err != nil {
			t.Fatalf("SeedDefaultWorkspaceTypes: %v", err)
		}

		var count int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM artefacts_types
			 WHERE artefacts_types_id_subscription = $1
			   AND artefacts_types_id_workspace = $2
			   AND artefacts_types_source = 'system'
			   AND artefacts_types_archived_at IS NULL`,
			subID, wsID,
		).Scan(&count); err != nil {
			t.Fatalf("count query: %v", err)
		}
		if count != 5 {
			t.Fatalf("want 5 system types, got %d", count)
		}
	})

	t.Run("all 5 slots are present", func(t *testing.T) {
		rows, err := pool.Query(ctx,
			`SELECT artefacts_types_slot FROM artefacts_types
			 WHERE artefacts_types_id_subscription = $1
			   AND artefacts_types_id_workspace = $2
			   AND artefacts_types_source = 'system'
			   AND artefacts_types_archived_at IS NULL`,
			subID, wsID,
		)
		if err != nil {
			t.Fatalf("query slots: %v", err)
		}
		defer rows.Close()
		slots := map[string]bool{}
		for rows.Next() {
			var slot *string
			if err := rows.Scan(&slot); err != nil {
				t.Fatalf("scan: %v", err)
			}
			if slot != nil {
				slots[*slot] = true
			}
		}
		for _, want := range []string{"wrk_story", "wrk_defect", "wrk_risk", "wrk_task", "wrk_epic"} {
			if !slots[want] {
				t.Errorf("missing slot %q", want)
			}
		}
	})

	t.Run("idempotent — second call is a no-op", func(t *testing.T) {
		if err := svc.SeedDefaultWorkspaceTypes(ctx, subID, wsID); err != nil {
			t.Fatalf("second SeedDefaultWorkspaceTypes: %v", err)
		}
		var count int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM artefacts_types
			 WHERE artefacts_types_id_subscription = $1
			   AND artefacts_types_id_workspace = $2
			   AND artefacts_types_source = 'system'
			   AND artefacts_types_archived_at IS NULL`,
			subID, wsID,
		).Scan(&count); err != nil {
			t.Fatalf("count query: %v", err)
		}
		if count != 5 {
			t.Fatalf("want 5 after idempotent call, got %d", count)
		}
	})
}
