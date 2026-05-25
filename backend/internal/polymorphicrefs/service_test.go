package polymorphicrefs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Integration tests against the live mmff_vector schema via the SSH
// tunnel. Each test opens its own transaction and rolls back on
// cleanup so no rows escape.
//
// CUT1.1.1 (PLA064): The bulk of the original tests in this file tested
// behaviour against company_roadmap, workspace, portfolio, and product
// tables — all dropped in migration 249. Those tests were removed. The
// remaining tests verify the service's invariant-rejection behaviour for
// unknown entity kinds, which does not require a live DB.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

func TestParentTableFor_AllKindsNowUnknown(t *testing.T) {
	// CUT1.1.1: parentTableFor returns ("", false) for every kind because
	// all parent tables were dropped in migration 249.
	kinds := []EntityKind{
		EntityKind("company_roadmap"),
		EntityKind("workspace"),
		EntityKind("portfolio"),
		EntityKind("product"),
		EntityKind("bogus"),
		EntityKind(""),
	}
	for _, k := range kinds {
		got, ok := parentTableFor(k)
		if ok || got != "" {
			t.Errorf("parentTableFor(%q) = (%q, %v); want (\"\", false)", k, got, ok)
		}
	}
}

func TestChildRelationshipsFor_AllKindsNowUnknown(t *testing.T) {
	// CUT1.1.1: childRelationshipsFor returns (nil, false) for every kind
	// because all parent tables were dropped in migration 249.
	kinds := []EntityKind{
		EntityKind("company_roadmap"),
		EntityKind("workspace"),
		EntityKind("portfolio"),
		EntityKind("product"),
		EntityKind("bogus"),
	}
	for _, k := range kinds {
		got, ok := childRelationshipsFor(k)
		if ok || got != nil {
			t.Errorf("childRelationshipsFor(%q) = (%v, %v); want (nil, false)", k, got, ok)
		}
	}
}

func TestLoadParent_UnknownKind(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	svc := New(pool)
	_, err = svc.LoadParent(context.Background(), tx, EntityKind("bogus"), uuid.New(), uuid.New())
	if !errors.Is(err, ErrUnknownEntityKind) {
		t.Fatalf("expected ErrUnknownEntityKind, got %v", err)
	}
}

func TestCleanupChildren_UnknownKind(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	svc := New(pool)
	_, err = svc.CleanupChildren(context.Background(), tx, EntityKind("bogus"), uuid.New())
	if !errors.Is(err, ErrUnknownEntityKind) {
		t.Fatalf("expected ErrUnknownEntityKind, got %v", err)
	}
}

func TestInsertPageEntityRef_AllKindsRejected(t *testing.T) {
	// CUT1.1.1: InsertPageEntityRef now rejects every kind because the
	// portfolio and product tables were dropped in migration 249.
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	svc := New(pool)
	for _, k := range []EntityKind{
		EntityKind("portfolio"),
		EntityKind("product"),
		EntityKind("workspace"),
		EntityKind("bogus"),
	} {
		err = svc.InsertPageEntityRef(ctx, tx, uuid.New(), k, uuid.New(), uuid.New())
		if !errors.Is(err, ErrUnknownEntityKind) {
			t.Errorf("InsertPageEntityRef(kind=%q): expected ErrUnknownEntityKind, got %v", k, err)
		}
	}
}
