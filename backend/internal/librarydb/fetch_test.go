package librarydb

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

// TestFetchTemplateByID_NotFound verifies the not-found error mapping
// against a known-missing UUID. Mirrors the skip-on-unreachable
// discipline of grants_test.go.
func TestFetchTemplateByID_NotFound(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	missing := uuid.MustParse("00000000-0000-0000-0000-0000deadbeef")
	_, err := FetchTemplateByID(context.Background(), pool, missing)
	if !errors.Is(err, ErrBundleNotFound) {
		t.Errorf("want ErrBundleNotFound, got %v", err)
	}
}

// TestFetchTemplateByID_Seeded loads the Vector Standard template
// (00000000-0000-0000-0000-00000000aa01) and verifies the bundle shape.
// Post-R010 the templates table has 5 hierarchical layers; Workflows /
// Transitions / Artifacts / Terminology are intentionally empty.
func TestFetchTemplateByID_Seeded(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	templateID := uuid.MustParse("00000000-0000-0000-0000-00000000aa01")
	bundle, err := FetchTemplateByID(context.Background(), pool, templateID)
	if err != nil {
		t.Fatalf("FetchTemplateByID: %v", err)
	}
	if bundle.Model.ID != templateID {
		t.Errorf("model.id: want %s, got %s", templateID, bundle.Model.ID)
	}
	if bundle.Model.Name == "" {
		t.Error("model.name: empty")
	}
	if bundle.Model.Scope != "system" {
		t.Errorf("model.scope: want %q, got %q", "system", bundle.Model.Scope)
	}
	if len(bundle.Layers) != 5 {
		t.Errorf("layers: want 5, got %d", len(bundle.Layers))
	}
	// Templates don't carry workflows/transitions/artifacts/terminology
	// — the adoption saga steps are no-ops on this path.
	if len(bundle.Workflows) != 0 {
		t.Errorf("workflows: want 0 (template path), got %d", len(bundle.Workflows))
	}
	if len(bundle.Transitions) != 0 {
		t.Errorf("transitions: want 0 (template path), got %d", len(bundle.Transitions))
	}
}

// testLibraryRoPool opens a pool against mmff_library as the RO role.
// Same skip-on-unreachable discipline as grants_test.go.
func testLibraryRoPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	host := envOrDefault("LIBRARY_DB_HOST", "localhost")
	port := envOrDefault("LIBRARY_DB_PORT", "5434")
	dbname := envOrDefault("LIBRARY_DB_NAME", "mmff_library")
	user := envOrDefault("LIBRARY_DB_USER", "mmff_library_ro")
	pwd := envOrDefault("LIBRARY_DB_PASSWORD", "change_me_ro")

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=mmff_library_ro_test",
		host, port, user, pwd, dbname,
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open library RO pool (cluster down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_library as RO (cluster/DB not yet provisioned?): %v", err)
	}
	return pool
}
