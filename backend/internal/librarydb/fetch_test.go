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

// TestFetchLatestByFamily verifies the bundle-fetcher returns the seeded
// MMFF Standard model in full. Counts mirror seed/001_mmff_model.sql:
// 5 layers, 15 workflows (3 per layer × 5 layers), 10 transitions
// (2 per layer × 5 layers), 3 artifacts, 5 terminology rows.
func TestFetchLatestByFamily(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	familyID := uuid.MustParse("00000000-0000-0000-0000-00000000a000")
	bundle, err := FetchLatestByFamily(context.Background(), pool, familyID)
	if err != nil {
		t.Fatalf("FetchLatestByFamily: %v", err)
	}

	if bundle.Model.Key != "mmff" {
		t.Errorf("model.key: want %q, got %q", "mmff", bundle.Model.Key)
	}
	if bundle.Model.Scope != "system" {
		t.Errorf("model.scope: want %q, got %q", "system", bundle.Model.Scope)
	}
	if bundle.Model.Version != 1 {
		t.Errorf("model.version: want 1, got %d", bundle.Model.Version)
	}

	if got := len(bundle.Layers); got != 5 {
		t.Errorf("layers: want 5, got %d", got)
	}
	wantTags := map[string]bool{"PRW": false, "PR": false, "BO": false, "TH": false, "FT": false}
	for _, l := range bundle.Layers {
		if _, ok := wantTags[l.Tag]; ok {
			wantTags[l.Tag] = true
		}
	}
	for tag, seen := range wantTags {
		if !seen {
			t.Errorf("missing layer tag %q", tag)
		}
	}

	if got := len(bundle.Workflows); got != 15 {
		t.Errorf("workflows: want 15, got %d", got)
	}
	if got := len(bundle.Transitions); got != 10 {
		t.Errorf("transitions: want 10, got %d", got)
	}
	if got := len(bundle.Artifacts); got < 3 {
		t.Errorf("artifacts: want >=3, got %d", got)
	}
	if got := len(bundle.Terminology); got < 5 {
		t.Errorf("terminology: want >=5, got %d", got)
	}
}

func TestFetchByModelID_NotFound(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	missing := uuid.MustParse("00000000-0000-0000-0000-0000deadbeef")
	_, err := FetchByModelID(context.Background(), pool, missing)
	if !errors.Is(err, ErrBundleNotFound) {
		t.Errorf("want ErrBundleNotFound, got %v", err)
	}
}

func TestFetchByModelID_Seeded(t *testing.T) {
	pool := testLibraryRoPool(t)
	defer pool.Close()

	modelID := uuid.MustParse("00000000-0000-0000-0000-00000000aa01")
	bundle, err := FetchByModelID(context.Background(), pool, modelID)
	if err != nil {
		t.Fatalf("FetchByModelID: %v", err)
	}
	if bundle.Model.ID != modelID {
		t.Errorf("model.id: want %s, got %s", modelID, bundle.Model.ID)
	}
	if len(bundle.Layers) != 5 {
		t.Errorf("layers: want 5, got %d", len(bundle.Layers))
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
