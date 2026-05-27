package relay

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// DefaultSweeperInterval is how often the sweeper checks for stuck claims.
	DefaultSweeperInterval = 60 * time.Second

	// DefaultStaleThreshold is how long a claim must be held before the sweeper
	// considers it stuck. A relay that crashes mid-publish will have set
	// claimed_at but never delivered_at; after 5 minutes any surviving relay
	// instance resets the row so it re-enters the claimable queue.
	DefaultStaleThreshold = 5 * time.Minute

	// stuckClaimMarker is appended to last_error so auditors can distinguish
	// stuck-claim recoveries from relay-publish failures.
	stuckClaimMarker = " [stuck-claim-recovered]"
)

// sqlSweep resets claimed_at to NULL for rows where the claim is older
// than the stale threshold and the row has not been delivered yet.
// last_error has the marker appended (via COALESCE) so the history is
// auditable. Rows with attempts >= 100 are already outside the partial
// relay index and are left alone; the sweeper does not revive parked rows.
const sqlSweep = `
UPDATE notifications_outbox_v2
SET    notifications_outbox_v2_claimed_at  = NULL,
       notifications_outbox_v2_last_error  =
           COALESCE(notifications_outbox_v2_last_error, '') || $2
WHERE  notifications_outbox_v2_claimed_at   IS NOT NULL
  AND  notifications_outbox_v2_claimed_at   < now() - $1::interval
  AND  notifications_outbox_v2_delivered_at IS NULL
  AND  notifications_outbox_v2_attempts     < 100
RETURNING notifications_outbox_v2_id
`

// Sweeper recovers stuck claims: rows that have been claimed
// (claimed_at IS NOT NULL) but never delivered (delivered_at IS NULL)
// after the stale threshold. This handles the crash-after-claim,
// before-publish failure mode described in the v2 design spec.
type Sweeper struct {
	pool           *pgxpool.Pool
	logger         *slog.Logger
	tickInterval   time.Duration
	staleThreshold time.Duration
}

// SweeperOption is a functional option for NewSweeper.
type SweeperOption func(*Sweeper)

// WithSweeperInterval overrides the default tick interval (60s).
func WithSweeperInterval(d time.Duration) SweeperOption {
	return func(s *Sweeper) { s.tickInterval = d }
}

// WithStaleThreshold overrides the default stale threshold (5min).
func WithStaleThreshold(d time.Duration) SweeperOption {
	return func(s *Sweeper) { s.staleThreshold = d }
}

// NewSweeper constructs a Sweeper. logger may be nil.
func NewSweeper(pool *pgxpool.Pool, logger *slog.Logger, opts ...SweeperOption) *Sweeper {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Sweeper{
		pool:           pool,
		logger:         logger,
		tickInterval:   DefaultSweeperInterval,
		staleThreshold: DefaultStaleThreshold,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Run blocks until ctx is cancelled. Spawn in its own goroutine.
func (s *Sweeper) Run(ctx context.Context) error {
	ticker := time.NewTicker(s.tickInterval)
	defer ticker.Stop()

	s.logger.Info("notifications/v2/sweeper: running",
		"tick_interval", s.tickInterval,
		"stale_threshold", s.staleThreshold,
	)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			s.runOnce(ctx)
		}
	}
}

// runOnce executes one sweep cycle. Exported for testing.
func (s *Sweeper) runOnce(ctx context.Context) {
	rows, err := s.pool.Query(ctx, sqlSweep,
		s.staleThreshold.String(), // $1 — interval string (e.g. "5m0s")
		stuckClaimMarker,          // $2 — appended to last_error
	)
	if err != nil {
		s.logger.Error("notifications/v2/sweeper: sweep query", "err", err)
		return
	}
	defer rows.Close()

	var recovered []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			s.logger.Error("notifications/v2/sweeper: scan", "err", err)
			continue
		}
		recovered = append(recovered, id)
	}
	if rows.Err() != nil {
		s.logger.Error("notifications/v2/sweeper: rows error", "err", rows.Err())
	}

	if len(recovered) == 0 {
		return
	}

	// WARN: stuck claims indicate a relay instance crashed between claim
	// and publish. One or two per deploy is expected (rolling restart);
	// sustained elevated counts indicate a bug or RabbitMQ degradation.
	s.logger.Warn("notifications/v2/sweeper: recovered stuck claims",
		"count", len(recovered),
		"stale_threshold", s.staleThreshold,
	)
}
