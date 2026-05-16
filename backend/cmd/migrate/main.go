// cmd/migrate runs ordered SQL migrations against mmff_vector, mmff_library,
// and vector_artefacts.
//
// Usage (from repo root):
//
//	go run ./backend/cmd/migrate [flags]
//
// Flags:
//
//	-dry-run   print which migrations would run; make no changes
//	-db        which database to migrate: "vector", "library", "vector_artefacts", or "both" (default "both")
//	-dir       repo root directory (default: auto-detected from executable path)
//	-env       path to .env file (default: backend/.env.local)
//
// SQL files are read from:
//
//	<dir>/db/mmff_vector/schema/      → mmff_vector
//	<dir>/db/mmff_library/schema/     → mmff_library
//	<dir>/db/vector_artefacts/schema/ → vector_artefacts
//
// Each database gets a schema_migrations table on first run that records which
// files have been applied. Files already in that table are skipped.
//
// Subdirectories (e.g. `db/mmff_vector/schema/down/`) are NOT scanned — the
// runner reads the top level of each schema dir only. Rollback / DOWN scripts
// MUST live in the per-DB `schema/down/` so they cannot be auto-applied as
// forward migrations.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/mmffdev/vector-backend/internal/secrets"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "print pending migrations without applying them")
	which := flag.String("db", "both", `which DB to migrate: "vector", "library", "vector_artefacts", or "both"`)
	repoDir := flag.String("dir", "", "repo root (default: auto-detected)")
	envFile := flag.String("env", "", "path to .env file (default: <dir>/backend/.env.local)")
	flag.Parse()

	root, err := resolveRoot(*repoDir)
	if err != nil {
		log.Fatalf("cannot locate repo root: %v", err)
	}

	env := *envFile
	if env == "" {
		env = filepath.Join(root, "backend", ".env.local")
	}
	if err := godotenv.Load(env); err != nil {
		log.Fatalf("load env %s: %v", env, err)
	}

	ctx := context.Background()

	switch *which {
	case "vector":
		must(migrateVector(ctx, root, *dryRun))
	case "library":
		must(migrateLibrary(ctx, root, *dryRun))
	case "vector_artefacts":
		must(migrateVectorArtefacts(ctx, root, *dryRun))
	case "both":
		must(migrateVector(ctx, root, *dryRun))
		must(migrateLibrary(ctx, root, *dryRun))
		must(migrateVectorArtefacts(ctx, root, *dryRun))
	default:
		log.Fatalf("-db must be vector, library, vector_artefacts, or both; got %q", *which)
	}
}

// ── vector ────────────────────────────────────────────────────────────────────

func migrateVector(ctx context.Context, root string, dryRun bool) error {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=mmff_migrate_vector",
		envOr("DB_HOST", "localhost"),
		envOr("DB_PORT", "5434"),
		secrets.Get("DB_USER"),
		secrets.Get("DB_PASSWORD"),
		envOr("DB_NAME", "mmff_vector"),
	)
	pool, err := openPool(ctx, dsn, "vector")
	if err != nil {
		return err
	}
	defer pool.Close()

	dir := filepath.Join(root, "db", "mmff_vector", "schema")
	return runMigrations(ctx, pool, "vector", dir, dryRun)
}

// ── library ───────────────────────────────────────────────────────────────────

func migrateLibrary(ctx context.Context, root string, dryRun bool) error {
	// LIBRARY_ADMIN_DB_USER is a dedicated role with DDL rights on mmff_library.
	// Fall back to the main DB user (mmff_dev / superuser) if not configured —
	// both DBs live on the same Postgres instance behind the tunnel.
	user := secrets.Get("LIBRARY_ADMIN_DB_USER")
	pwd := secrets.Get("LIBRARY_ADMIN_DB_PASSWORD")
	if user == "" {
		user = secrets.Get("DB_USER")
		pwd = secrets.Get("DB_PASSWORD")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=mmff_migrate_library",
		envOr("LIBRARY_DB_HOST", "localhost"),
		envOr("LIBRARY_DB_PORT", "5434"),
		user,
		pwd,
		envOr("LIBRARY_DB_NAME", "mmff_library"),
	)
	pool, err := openPool(ctx, dsn, "library")
	if err != nil {
		return err
	}
	defer pool.Close()

	dir := filepath.Join(root, "db", "mmff_library", "schema")
	return runMigrations(ctx, pool, "library", dir, dryRun)
}

// ── vector_artefacts ──────────────────────────────────────────────────────────

func migrateVectorArtefacts(ctx context.Context, root string, dryRun bool) error {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=mmff_migrate_vector_artefacts",
		envOr("VA_DB_HOST", "localhost"),
		envOr("VA_DB_PORT", "5435"),
		secrets.Get("VA_DB_USER"),
		secrets.Get("VA_DB_PASSWORD"),
		envOr("VA_DB_NAME", "vector_artefacts"),
	)

	// The FDW migration (015_backfill_work_items.sql) reads the source DB
	// password via current_setting('app.fdw_source_password') so that no
	// plaintext credential is committed to the SQL file. Inject it here via
	// AfterConnect so it is set on every connection the pool hands out.
	fdwPw := secrets.Get("DB_PASSWORD")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("pgxpool.ParseConfig [vector_artefacts]: %w", err)
	}
	if fdwPw != "" {
		escaped := strings.ReplaceAll(fdwPw, "'", "''")
		setGUC := fmt.Sprintf("SET app.fdw_source_password = '%s'", escaped)
		cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			_, err := conn.Exec(ctx, setGUC)
			return err
		}
	}

	pool, err := openPoolFromConfig(ctx, cfg, "vector_artefacts")
	if err != nil {
		return err
	}
	defer pool.Close()

	dir := filepath.Join(root, "db", "vector_artefacts", "schema")
	return runMigrations(ctx, pool, "vector_artefacts", dir, dryRun)
}

// ── core runner ───────────────────────────────────────────────────────────────

func runMigrations(ctx context.Context, pool *pgxpool.Pool, label, dir string, dryRun bool) error {
	if err := ensureTable(ctx, pool); err != nil {
		return fmt.Errorf("[%s] ensure schema_migrations: %w", label, err)
	}

	files, err := sqlFiles(dir)
	if err != nil {
		return fmt.Errorf("[%s] read dir %s: %w", label, dir, err)
	}

	applied, err := appliedMigrations(ctx, pool)
	if err != nil {
		return fmt.Errorf("[%s] query applied: %w", label, err)
	}

	pending := filterPending(files, applied)

	if len(pending) == 0 {
		fmt.Printf("[%s] up to date — no pending migrations\n", label)
		return nil
	}

	fmt.Printf("[%s] %d pending migration(s):\n", label, len(pending))
	for _, f := range pending {
		fmt.Printf("  • %s\n", filepath.Base(f))
	}

	if dryRun {
		fmt.Printf("[%s] dry-run: no changes made\n", label)
		return nil
	}

	for _, f := range pending {
		name := filepath.Base(f)
		if err := applyFile(ctx, pool, f, name); err != nil {
			return fmt.Errorf("[%s] apply %s: %w", label, name, err)
		}
		fmt.Printf("[%s] ✓ applied %s\n", label, name)
	}

	fmt.Printf("[%s] done\n", label)
	return nil
}

func ensureTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   TEXT        NOT NULL PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	return err
}

func appliedMigrations(ctx context.Context, pool *pgxpool.Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT filename FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

// sqlFiles returns the top-level *.sql files in dir, sorted lexicographically.
// Subdirectories are intentionally skipped so each `schema/down/` (rollback
// scripts) and any future side-folder cannot be picked up as forward
// migrations. Dropping a `_DOWN.sql` next to forward files used to silently
// schedule the rollback for execution; that lesson is encoded here.
func sqlFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(files)
	return files, nil
}

func filterPending(files []string, applied map[string]bool) []string {
	var out []string
	for _, f := range files {
		if !applied[filepath.Base(f)] {
			out = append(out, f)
		}
	}
	return out
}

func applyFile(ctx context.Context, pool *pgxpool.Pool, path, name string) error {
	sql, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	// Run the file SQL and record the migration in a single transaction.
	return pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("exec sql: %w", err)
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (filename, applied_at) VALUES ($1, $2)`,
			name, time.Now().UTC(),
		)
		return err
	})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func openPool(ctx context.Context, dsn, label string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New [%s]: %w", label, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db ping [%s]: %w", label, err)
	}
	return pool, nil
}

func openPoolFromConfig(ctx context.Context, cfg *pgxpool.Config, label string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.NewWithConfig [%s]: %w", label, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db ping [%s]: %w", label, err)
	}
	return pool, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

// resolveRoot walks up from the executable (or working directory) until it
// finds a directory containing "backend/go.mod", which identifies the repo root.
func resolveRoot(override string) (string, error) {
	if override != "" {
		return filepath.Abs(override)
	}

	// Try working directory first (most reliable for `go run`).
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	dir := wd
	for {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	// Fall back to the directory containing the executable.
	exe, err := os.Executable()
	if err != nil {
		return wd, nil
	}
	dir = filepath.Dir(exe)
	for {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	return "", fmt.Errorf("could not find repo root (no backend/go.mod found walking up from %s)", wd)
}
