package apikeys

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedDevKey inserts a hardcoded dev API key for local testing.
// Only runs in development (APP_ENV=development); no-op in staging/production.
// The key is hashed and stored; the raw key is logged once for convenience.
//
// Story 00443: temporary measure until proper key issuance UI is built.
func SeedDevKey(ctx context.Context, db *pgxpool.Pool, appEnv string, devKeyRaw string) error {
	if appEnv != "development" {
		return nil // No-op in non-dev environments
	}

	if devKeyRaw == "" {
		return nil // No-op if env var not set
	}

	// Find any subscription to attach the key to (for dev, use the first one).
	// This is temporary — in production, keys are issued per-subscription via API.
	var subID string
	err := db.QueryRow(ctx, `SELECT id FROM subscriptions LIMIT 1`).Scan(&subID)
	if err != nil {
		if err == pgx.ErrNoRows {
			log.Printf("⚠ no subscriptions found; skipping dev API key seed")
			return nil
		}
		return fmt.Errorf("query subscriptions: %w", err)
	}

	// Check if dev key already exists to avoid duplicates
	prefix := devKeyRaw[:16]
	hash := hashKey(devKeyRaw)

	var existing string
	err = db.QueryRow(ctx,
		`SELECT admin_api_keys_id FROM admin_api_keys WHERE admin_api_keys_hash = $1 LIMIT 1`,
		hash,
	).Scan(&existing)

	if err == nil {
		// Key already exists
		log.Printf("✓ dev API key already seeded (prefix: %s)", prefix)
		return nil
	}

	if err != pgx.ErrNoRows {
		return fmt.Errorf("check existing dev key: %w", err)
	}

	// Insert the dev key
	var keyID string
	err = db.QueryRow(ctx,
		`INSERT INTO admin_api_keys (
			admin_api_keys_id_subscription,
			admin_api_keys_prefix,
			admin_api_keys_hash,
			admin_api_keys_scopes
		) VALUES ($1, $2, $3, $4)
		 RETURNING admin_api_keys_id`,
		subID, prefix, hash, []string{"*"},
	).Scan(&keyID)
	if err != nil {
		return fmt.Errorf("insert dev api_key: %w", err)
	}

	log.Printf("✓ seeded dev API key: %s (id: %s)", devKeyRaw, keyID)
	log.Printf("  use: curl -H 'Authorization: Bearer %s' http://localhost:5100/v1/api/...", devKeyRaw)
	return nil
}
