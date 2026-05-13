package libraryreleases

// Service is the sole DB boundary for the gadmin-facing library
// release-notification HTTP surface (PLA-0039 / Story 00528, B22.8).
//
// Three pools are involved post-PLA-0023 P1 (2026-05-13):
//   - LibRO      — read-only pool against mmff_library; release content +
//     existence checks for ack URL parameter.
//   - VectorPool — primary pool against mmff_vector; subscription tier
//     lookup. Stays here until subscriptions migrates in P5/P6.
//   - AcksPool   — pool that owns library_acknowledgements. vaPool when
//     available (post-cutover), falls back to VectorPool otherwise.
//
// The handler.go file hands every DB operation to this service —
// `lint:no-db-in-handlers` enforces the boundary. The librarydb package
// remains the row-level helper layer; Service composes those helpers
// (no duplicate SQL strings here) and exposes a stable per-capability
// surface to the handler.

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Sentinel errors. Most plumbing failures are returned wrapped; only
// release-not-found needs a separate path so the handler can map to 404.
var (
	ErrReleaseNotFound = librarydb.ErrReleaseNotFound
)

// Service holds the three pools needed for the cross-DB workflow.
type Service struct {
	libRO      *pgxpool.Pool
	vectorPool *pgxpool.Pool
	acksPool   *pgxpool.Pool
}

// NewService wires the service. All three pools are required for full
// functionality; tests pass nil to short-circuit specific paths.
// acksPool is vaPool post-PLA-0023 P1; callers may pass vectorPool for
// back-compat when vaPool is unavailable.
func NewService(libRO, vectorPool, acksPool *pgxpool.Pool) *Service {
	return &Service{libRO: libRO, vectorPool: vectorPool, acksPool: acksPool}
}

// SetAcksPool swaps the pool that owns library_acknowledgements after
// construction. Used at boot: the Service is wired early-bound on the
// mmff_vector pool, then upgraded to vaPool once it is initialised
// (PLA-0023 P1 — same pattern as audit.Logger.SetPool).
func (s *Service) SetAcksPool(p *pgxpool.Pool) {
	s.acksPool = p
}

// SubscriptionTier loads the caller's tier from mmff_vector.
// Identical SQL to the prior handler-local subscriptionTier method.
func (s *Service) SubscriptionTier(ctx context.Context, subID uuid.UUID) (string, error) {
	var tier string
	err := s.vectorPool.QueryRow(ctx,
		`SELECT tier FROM subscriptions WHERE id = $1`, subID,
	).Scan(&tier)
	if err != nil {
		return "", fmt.Errorf("libraryreleases: load tier: %w", err)
	}
	return tier, nil
}

// CountOutstanding returns the (count, has-blocking) pair for the
// caller's subscription. Wraps librarydb.CountOutstandingForSubscription.
func (s *Service) CountOutstanding(ctx context.Context, subID uuid.UUID, tier string) (int, bool, error) {
	return librarydb.CountOutstandingForSubscription(ctx, s.libRO, s.acksPool, subID, tier)
}

// ListSinceAck returns every active release the subscription has not
// yet acknowledged. Wraps librarydb.ListReleasesSinceAck.
func (s *Service) ListSinceAck(ctx context.Context, subID uuid.UUID, tier string) ([]librarydb.Release, error) {
	return librarydb.ListReleasesSinceAck(ctx, s.libRO, s.acksPool, subID, tier)
}

// FindRelease validates the release id against mmff_library before the
// handler writes an ack. Returns ErrReleaseNotFound when missing.
func (s *Service) FindRelease(ctx context.Context, releaseID uuid.UUID) error {
	_, err := librarydb.FindRelease(ctx, s.libRO, releaseID)
	if errors.Is(err, librarydb.ErrReleaseNotFound) {
		return ErrReleaseNotFound
	}
	return err
}

// AckRelease persists one ack row in the acks pool (vector_artefacts
// post-PLA-0023 P1). Returns (created, err) — created==true when this
// was the first ack, false on idempotent re-ack.
func (s *Service) AckRelease(ctx context.Context, subID, releaseID, userID uuid.UUID, actionTaken string) (bool, error) {
	return librarydb.AckRelease(ctx, s.acksPool, subID, releaseID, userID, actionTaken)
}
