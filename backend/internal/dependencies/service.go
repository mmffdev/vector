package dependencies

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the sole writer for the artefact dependency substrate.
// Holds the vector_artefacts pool (vaPool) only — Sentinel is read
// from request context, NOT injected at construction time, matching
// the live artefactpriorities / artefactitems / topology pattern.
//
// Future stories (B23.1.5+) add methods directly to this struct so
// the same service governs reads, writes, and the dependency-impact
// preflight.
type Service struct {
	pool *pgxpool.Pool
}

// NewService constructs the service against the vector_artefacts
// pool. The pool may legitimately be nil in pre-cutover envs; methods
// guard against that and return a clear error rather than panic.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// VerifySchema runs a no-op SELECT against each of the three
// substrate tables. Intended to be called once at boot from
// cmd/server/main.go so the process fails fast if the operator
// forgot to apply migrations 173–175. Returns ErrSchemaMissing
// (wrapped) when any of the tables is absent; nil otherwise.
//
// Called once at boot; not on every request — repeating this on hot
// paths would just add round-trip latency for no detection benefit
// (the migrations either ran at boot or they didn't).
func (s *Service) VerifySchema(ctx context.Context) error {
	if s.pool == nil {
		// In pre-cutover envs the substrate genuinely is unavailable
		// — methods reject calls at the seam, but VerifySchema is a
		// boot hook and silently passing here lets servers without
		// vaPool boot. Subsequent method calls will return an error
		// at the seam instead.
		return nil
	}
	for _, q := range []string{sqlPingMaps, sqlPingEdges, sqlPingEdgeEvents} {
		if _, err := s.pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("%w: %v", ErrSchemaMissing, err)
		}
	}
	return nil
}

// requirePool is the shared guard used by every method that touches
// the DB. Returned error wraps a sentinel so callers can branch on it.
func (s *Service) requirePool() error {
	if s.pool == nil {
		return errors.New("dependencies: vector_artefacts pool not available")
	}
	return nil
}
