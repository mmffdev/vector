// Package librarydb owns the connection pools for the mmff_library
// database. Three pools, three roles — see plan §9 and the grant
// matrix asserted in grants_test.go.
//
//   - RO       — every request-path read goes through this pool.
//   - Publish  — only the publish + share endpoints; no DELETE grant.
//   - Ack      — only the acknowledgement handler + reconciler.
//
// Admin (mmff_library_admin) is intentionally NOT exposed via a Go
// pool: release artifacts run via `psql -f` and never via the app.
package librarydb

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pools bundles the three live pools so callers receive one struct
// from New and can pick the right pool per endpoint.
type Pools struct {
	RO      *pgxpool.Pool
	Publish *pgxpool.Pool
	Ack     *pgxpool.Pool
}

// New opens the three pools. Returns the first error encountered;
// any pools opened before the failure are closed before returning.
//
// Required env vars:
//
//	LIBRARY_DB_HOST            (default localhost)
//	LIBRARY_DB_PORT            (default 5434)
//	LIBRARY_DB_NAME            (default mmff_library)
//	LIBRARY_DB_USER            — read-only role
//	LIBRARY_DB_PASSWORD
//	LIBRARY_PUBLISH_DB_USER     — publish role
//	LIBRARY_PUBLISH_DB_PASSWORD
//	LIBRARY_ACK_DB_USER         — ack role
//	LIBRARY_ACK_DB_PASSWORD
func New(ctx context.Context) (*Pools, error) {
	host := envOr("LIBRARY_DB_HOST", "localhost")
	port := envOr("LIBRARY_DB_PORT", "5434")
	dbname := envOr("LIBRARY_DB_NAME", "mmff_library")

	roUser := os.Getenv("LIBRARY_DB_USER")
	roPwd := os.Getenv("LIBRARY_DB_PASSWORD")
	pubUser := os.Getenv("LIBRARY_PUBLISH_DB_USER")
	pubPwd := os.Getenv("LIBRARY_PUBLISH_DB_PASSWORD")
	ackUser := os.Getenv("LIBRARY_ACK_DB_USER")
	ackPwd := os.Getenv("LIBRARY_ACK_DB_PASSWORD")

	if roUser == "" || pubUser == "" || ackUser == "" {
		return nil, errors.New("librarydb: LIBRARY_DB_USER, LIBRARY_PUBLISH_DB_USER, and LIBRARY_ACK_DB_USER must all be set")
	}

	ro, err := openPool(ctx, host, port, dbname, roUser, roPwd, "ro")
	if err != nil {
		return nil, err
	}
	pub, err := openPool(ctx, host, port, dbname, pubUser, pubPwd, "publish")
	if err != nil {
		ro.Close()
		return nil, err
	}
	ack, err := openPool(ctx, host, port, dbname, ackUser, ackPwd, "ack")
	if err != nil {
		ro.Close()
		pub.Close()
		return nil, err
	}

	return &Pools{RO: ro, Publish: pub, Ack: ack}, nil
}

// Close shuts down all three pools. Safe to call on a nil-receiver
// (no-op) so error-path defers don't need a guard.
func (p *Pools) Close() {
	if p == nil {
		return
	}
	if p.RO != nil {
		p.RO.Close()
	}
	if p.Publish != nil {
		p.Publish.Close()
	}
	if p.Ack != nil {
		p.Ack.Close()
	}
}

func openPool(ctx context.Context, host, port, dbname, user, pwd, label string) (*pgxpool.Pool, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=mmff_library_%s",
		host, port, user, pwd, dbname, label,
	)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("librarydb %s: pgxpool.New: %w", label, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("librarydb %s: ping: %w", label, err)
	}
	return pool, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
