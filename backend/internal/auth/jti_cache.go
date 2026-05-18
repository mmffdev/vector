package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// JTICache backs the RFC 9449 DPoP replay-prevention requirement
// (§ 4.3, item 11: "the jti value has not been used before in this
// context"). It is a thin wrapper around the dpop_jti_cache table —
// every successfully validated proof reserves its jti here, and a
// repeat presentation of the same jti within the freshness window
// (iat ± tolerance, plus buffer) reports a replay.
//
// Storage choice: Postgres rather than in-memory. Documented in the
// 212_dpop_jti_cache.sql migration header. The summary: survives
// restart, is multi-instance-ready, and slots into the existing
// auth-substrate ops pattern.

// ErrJTIReplay is returned by MarkAndCheck when the jti was already
// present in dpop_jti_cache — the proof is a replay and the caller
// must reject the request with 401 invalid_dpop_proof.
var ErrJTIReplay = errors.New("dpop proof jti already used")

// JTICache reserves and reaps RFC 9449 proof JTIs.
type JTICache struct {
	pool *pgxpool.Pool
}

// NewJTICache constructs a cache bound to a pgx pool. Callers wire one
// instance in main.go and share it between RequireAuth middleware and
// the cleanup goroutine.
func NewJTICache(pool *pgxpool.Pool) *JTICache {
	return &JTICache{pool: pool}
}

// MarkAndCheck atomically records jti with the given expiry. The first
// time a jti is seen the INSERT writes a row and the function returns
// nil. On any repeat (within the row's expiry window) the conflict
// branch fires and the function returns ErrJTIReplay.
//
// Implementation note: we rely on the xmax column in the RETURNING
// clause. PostgreSQL sets xmax to the transaction id that locked the
// existing row on a conflict, so xmax != 0 distinguishes "row already
// existed" from "row newly inserted" without a separate SELECT.
func (c *JTICache) MarkAndCheck(ctx context.Context, jti string, expiresAt time.Time) error {
	var xmax uint32
	err := c.pool.QueryRow(ctx, sqlInsertDPoPJTI, jti, expiresAt).Scan(&xmax)
	if err != nil {
		// ON CONFLICT DO NOTHING with RETURNING produces zero rows
		// when the conflict fires — pgx surfaces that as ErrNoRows,
		// which is the replay signal.
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrJTIReplay
		}
		return err
	}
	// Defensive: if xmax came back non-zero on a successful INSERT,
	// treat as replay. The ON CONFLICT branch is the only path that
	// would non-zero this in practice; we'd have returned ErrNoRows
	// above. Leaving the guard so a subtle Postgres semantics change
	// doesn't silently let a replay through.
	if xmax != 0 {
		return ErrJTIReplay
	}
	return nil
}

// CleanupExpired removes every cached jti whose expires_at has passed.
// Called by a 10-minute ticker goroutine in backend/cmd/server/main.go.
// Returns the number of rows deleted so the caller can audit-log the
// volume (useful for spotting either a replay-attack burst or a
// runaway proof-storm bug).
func (c *JTICache) CleanupExpired(ctx context.Context) (int64, error) {
	tag, err := c.pool.Exec(ctx, sqlDeleteExpiredDPoPJTIs)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
