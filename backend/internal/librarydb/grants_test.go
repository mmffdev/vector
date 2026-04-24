package librarydb

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// TestLibraryGrantMatrix asserts that the live mmff_library role grants
// exactly match the canonical map in db/library_schema/005_grants.sql
// (and plan §9). Drift in either direction — extra privileges OR missing
// privileges — fails this test.
//
// The test runs as mmff_dev (super-ish role on the dev cluster) so it
// can read information_schema.role_table_grants. CI env supplies the
// same credentials.
//
// Skips (does not fail) when the tunnel/Postgres is unreachable so
// laptop test runs without the cluster up still pass — the polymorphic
// orphan canary uses the same skip discipline.
func TestLibraryGrantMatrix(t *testing.T) {
	pool := testLibraryAdminPool(t)
	defer pool.Close()

	ctx := context.Background()

	// Canonical matrix. Update this when 005_grants.sql changes.
	// Each entry: role -> table -> sorted set of privileges.
	want := map[string]map[string][]string{
		"mmff_library_admin": tableMap(libraryTables(), []string{"DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"}),
		"mmff_library_ro":    tableMap(libraryTables(), []string{"SELECT"}),
		"mmff_library_publish": tableMap(libraryTables(), []string{"INSERT", "SELECT", "UPDATE"}),
		// ack: NO table grants in Phase 1. Phase 3 extends the matrix when
		// library_releases / library_acknowledgements ship.
		"mmff_library_ack": map[string][]string{},
	}

	got := loadLiveGrants(ctx, t, pool)

	for role, wantTables := range want {
		gotTables := got[role]
		// Compare as a single string each so the diff message is readable.
		wantStr := dumpTables(wantTables)
		gotStr := dumpTables(gotTables)
		if wantStr != gotStr {
			t.Errorf("grant matrix mismatch for role %s\nwant:\n%s\ngot:\n%s", role, wantStr, gotStr)
		}
	}

	// Catch unexpected extra roles too (e.g. someone created mmff_library_foo).
	for role := range got {
		if _, expected := want[role]; !expected && strings.HasPrefix(role, "mmff_library_") {
			t.Errorf("unexpected library role with grants: %s", role)
		}
	}
}

// libraryTables returns the canonical Phase-1 table list. Phase 3 will
// extend this when library_releases / _actions / _acknowledgements ship.
func libraryTables() []string {
	return []string{
		"portfolio_models",
		"portfolio_model_layers",
		"portfolio_model_workflows",
		"portfolio_model_workflow_transitions",
		"portfolio_model_artifacts",
		"portfolio_model_terminology",
		"portfolio_model_shares",
	}
}

func tableMap(tables, privs []string) map[string][]string {
	out := make(map[string][]string, len(tables))
	sort.Strings(privs)
	for _, t := range tables {
		// copy slice to avoid aliasing on later mutation
		ps := make([]string, len(privs))
		copy(ps, privs)
		out[t] = ps
	}
	return out
}

func loadLiveGrants(ctx context.Context, t *testing.T, pool *pgxpool.Pool) map[string]map[string][]string {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT grantee, table_name, privilege_type
		FROM information_schema.role_table_grants
		WHERE table_schema = 'public'
		  AND grantee LIKE 'mmff_library_%'
		  AND table_name IN (
		      'portfolio_models',
		      'portfolio_model_layers',
		      'portfolio_model_workflows',
		      'portfolio_model_workflow_transitions',
		      'portfolio_model_artifacts',
		      'portfolio_model_terminology',
		      'portfolio_model_shares'
		  )
	`)
	if err != nil {
		t.Fatalf("query grants: %v", err)
	}
	defer rows.Close()

	out := map[string]map[string][]string{}
	for rows.Next() {
		var role, table, priv string
		if err := rows.Scan(&role, &table, &priv); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if _, ok := out[role]; !ok {
			out[role] = map[string][]string{}
		}
		out[role][table] = append(out[role][table], priv)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows.Err: %v", err)
	}
	for _, tbl := range out {
		for k := range tbl {
			sort.Strings(tbl[k])
		}
	}
	return out
}

func dumpTables(m map[string][]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "  %s: [%s]\n", k, strings.Join(m[k], ","))
	}
	if b.Len() == 0 {
		return "  (no grants)\n"
	}
	return b.String()
}

// testLibraryAdminPool opens a pool against mmff_library as the dev
// superuser-ish role (mmff_dev) so the test can read
// information_schema.role_table_grants for every grantee.
func testLibraryAdminPool(t *testing.T) *pgxpool.Pool {
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
	user := envOrDefault("DB_USER", "mmff_dev")        // dev superuser
	pwd := os.Getenv("DB_PASSWORD")

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, pwd, dbname,
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open library pool (cluster down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping mmff_library (cluster/DB not yet provisioned?): %v", err)
	}
	return pool
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
