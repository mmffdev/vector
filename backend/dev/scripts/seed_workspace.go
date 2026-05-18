// seed_workspace.go — dev helper to insert a workspace + root topology node.
//
// Run from the backend directory:
//
//	go run ./dev/scripts/seed_workspace.go
//	go run ./dev/scripts/seed_workspace.go -name "My Workspace" -subscription mmffdev
//
// Each run inserts a NEW workspace (random UUID) and its root topology node.
// Safe to run multiple times — produces distinct workspaces on every call.
//
// Env: reads backend/.env.dev (DB_HOST/PORT/USER/PASSWORD/DB_NAME +
// VECTOR_ARTEFACTS_DB_URL). Falls back to OS env if .env.dev is absent.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	subscriptionSlug := flag.String("subscription", "", "subscription slug (default: first subscription found)")
	workspaceName := flag.String("name", "", "workspace name (default: Dev Workspace <timestamp>)")
	flag.Parse()

	// Load .env.dev relative to this file's location (../../.env.dev from dev/scripts/).
	for _, rel := range []string{".env.dev", "../../.env.dev"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	ctx := context.Background()

	// mmff_vector pool.
	vectorDSN := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"),
	)
	vectorPool, err := pgxpool.New(ctx, vectorDSN)
	must(err, "open mmff_vector pool")
	defer vectorPool.Close()
	must(vectorPool.Ping(ctx), "ping mmff_vector")

	// vector_artefacts pool.
	vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if vaURL == "" {
		fatalf("VECTOR_ARTEFACTS_DB_URL is not set — cannot seed topology node")
	}
	vaPool, err := pgxpool.New(ctx, vaURL)
	must(err, "open vector_artefacts pool")
	defer vaPool.Close()
	must(vaPool.Ping(ctx), "ping vector_artefacts")

	// Resolve subscription.
	var subscriptionID uuid.UUID
	if *subscriptionSlug != "" {
		if err := vectorPool.QueryRow(ctx,
			`SELECT id FROM subscriptions WHERE slug = $1`, *subscriptionSlug,
		).Scan(&subscriptionID); err != nil {
			fatalf("subscription %q not found: %v", *subscriptionSlug, err)
		}
	} else {
		if err := vectorPool.QueryRow(ctx,
			`SELECT id FROM subscriptions ORDER BY created_at LIMIT 1`,
		).Scan(&subscriptionID); err != nil {
			fatalf("no subscriptions found: %v", err)
		}
	}

	// Resolve gadmin user for created_by.
	var createdBy uuid.UUID
	if err := vectorPool.QueryRow(ctx,
		`SELECT id FROM users WHERE email = 'gadmin@mmffdev.com' AND subscription_id = $1`, subscriptionID,
	).Scan(&createdBy); err != nil {
		// Fall back to any gadmin in this subscription.
		if err2 := vectorPool.QueryRow(ctx,
			`SELECT id FROM users WHERE subscription_id = $1 AND role = 'gadmin' ORDER BY created_at LIMIT 1`, subscriptionID,
		).Scan(&createdBy); err2 != nil {
			fatalf("no gadmin user found for subscription %s: %v", subscriptionID, err2)
		}
	}

	// Build workspace name and slug.
	name := *workspaceName
	if name == "" {
		name = "Dev Workspace " + time.Now().Format("2006-01-02T15:04:05")
	}
	slug := toSlug(name)

	// Insert workspace on mmff_vector.
	workspaceID := uuid.New()
	var insertedName string
	if err := vectorPool.QueryRow(ctx, `
		INSERT INTO master_record_workspaces (id, subscription_id, name, slug, description, created_by)
		VALUES ($1, $2, $3, $4, '', $5)
		RETURNING name`,
		workspaceID, subscriptionID, name, slug, createdBy,
	).Scan(&insertedName); err != nil {
		fatalf("insert workspace: %v", err)
	}
	fmt.Printf("workspace inserted: %s  name=%q  slug=%q\n", workspaceID, insertedName, slug)

	// Grant the gadmin user admin access on the new workspace.
	if _, err := vectorPool.Exec(ctx, `
		INSERT INTO users_roles_workspaces (
			users_roles_workspaces_id_subscription,
			users_roles_workspaces_id_workspace,
			users_roles_workspaces_id_user,
			users_roles_workspaces_role,
			users_roles_workspaces_id_user_granted_by
		) VALUES ($1, $2, $3, 'admin', $3)`,
		subscriptionID, workspaceID, createdBy,
	); err != nil {
		fatalf("insert workspace grant: %v", err)
	}
	fmt.Printf("workspace grant inserted: admin on %s for user %s\n", workspaceID, createdBy)

	// Insert root topology node on vector_artefacts.
	var topologyID uuid.UUID
	if err := vaPool.QueryRow(ctx, `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id,
			name, description, layout_mode, collapsed_default, sort_order
		) VALUES (
			gen_random_uuid(), $1, $2, NULL,
			$3, '', 'auto-horizontal', FALSE, 0
		) RETURNING id`,
		workspaceID, subscriptionID, name,
	).Scan(&topologyID); err != nil {
		fatalf("insert topology root node: %v", err)
	}
	fmt.Printf("topology root node: %s  workspace_id=%s\n", topologyID, workspaceID)
}

// toSlug converts a name to a valid workspace slug (lowercase, hyphens).
func toSlug(name string) string {
	slug := make([]byte, 0, len(name))
	for _, c := range []byte(name) {
		switch {
		case c >= 'A' && c <= 'Z':
			slug = append(slug, c+32)
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			slug = append(slug, c)
		default:
			if len(slug) > 0 && slug[len(slug)-1] != '-' {
				slug = append(slug, '-')
			}
		}
	}
	// Trim trailing hyphen.
	for len(slug) > 0 && slug[len(slug)-1] == '-' {
		slug = slug[:len(slug)-1]
	}
	if len(slug) == 0 {
		slug = []byte("dev-workspace")
	}
	return string(slug)
}

func must(err error, msg string) {
	if err != nil {
		fatalf("%s: %v", msg, err)
	}
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "seed_workspace: "+format+"\n", args...)
	os.Exit(1)
}
