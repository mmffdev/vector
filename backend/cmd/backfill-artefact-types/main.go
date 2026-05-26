//go:build ignore

// Backfill one-shot: seed default artefact types for every workspace in the
// tenant DB. Post-2026-05-26 (refactorDB Pillar 3), the tenant DB is
// vector_artefacts; the variable name `vectorPool` is kept for diff
// minimisation but the connection now points at vector_artefacts. "vector" is
// legacy nomenclature here — both pools end up at the same DB.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/artefacttypes"
)

func main() {
	ctx := context.Background()

	// "vector" is legacy nomenclature: post-refactorDB the tenant DB is
	// vector_artefacts. Default switched to vector_artefacts so a fresh
	// env (with DB_NAME unset) connects to the live tenant DB.
	vectorDSN := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getenv("DB_HOST", "localhost"), getenv("DB_PORT", "5435"),
		getenv("DB_USER", "mmff_dev"), getenv("DB_PASSWORD", ""),
		getenv("DB_NAME", "vector_artefacts"),
	)
	vaDSN := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getenv("VA_DB_HOST", "localhost"), getenv("VA_DB_PORT", "5435"),
		getenv("VA_DB_USER", "mmff_dev"), getenv("VA_DB_PASSWORD", ""),
		getenv("VA_DB_NAME", "vector_artefacts"),
	)

	vectorPool, err := pgxpool.New(ctx, vectorDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer vectorPool.Close()

	vaPool, err := pgxpool.New(ctx, vaDSN)
	if err != nil {
		log.Fatal(err)
	}
	defer vaPool.Close()

	rows, err := vectorPool.Query(ctx,
		`SELECT master_record_workspaces_id, master_record_workspaces_id_subscription, master_record_workspaces_name FROM master_record_workspaces WHERE master_record_workspaces_archived_at IS NULL ORDER BY master_record_workspaces_created_at`,
	)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	type ws struct {
		id, subID uuid.UUID
		name      string
	}
	var workspaces []ws
	for rows.Next() {
		var w ws
		if err := rows.Scan(&w.id, &w.subID, &w.name); err != nil {
			log.Fatal(err)
		}
		workspaces = append(workspaces, w)
	}

	svc := artefacttypes.NewService(vaPool)
	for _, w := range workspaces {
		if err := svc.SeedDefaultWorkspaceTypes(ctx, w.subID, w.id); err != nil {
			log.Printf("FAIL %s (%s): %v", w.name, w.id, err)
		} else {
			log.Printf("OK   %s (%s)", w.name, w.id)
		}
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
