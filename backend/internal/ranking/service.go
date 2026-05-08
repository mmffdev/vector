package ranking

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service performs scope-aware rank operations against any registered
// resource. One Service is wired into the HTTP handler; resource-type
// dispatch happens via the registry, not via per-resource subclasses.
type Service struct {
	pool *pgxpool.Pool
}

// New returns a Service backed by the given pool.
func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Scope is the addressable container a row's position is unique
// within. Backlog rows share one global-per-tenant order; sprint
// rows share an order with their sprint cohort.
type Scope string

const (
	ScopeBacklog Scope = "backlog"
	ScopeSprint  Scope = "sprint"
)

// MoveRequest describes one drag-and-drop drop. Exactly one of
// Before/After/ToTop/ToBottom must be set; the service rejects
// anything else with ErrInvalidArgument.
type MoveRequest struct {
	ResourceType   string    // registered name (e.g. "work_item")
	SubscriptionID uuid.UUID // tenant scope, ALWAYS from session, never the request body
	RowID          uuid.UUID // the row being moved

	// Drop intent — pick one:
	Before   *uuid.UUID // place this row immediately before target
	After    *uuid.UUID // place this row immediately after target
	ToTop    bool       // move to top of current scope
	ToBottom bool       // move to bottom of current scope
}

// MoveResult is what the caller (and ultimately the client) sees
// after a successful move. The final position is server-decided —
// clients use it to reconcile any optimistic UI ordering.
type MoveResult struct {
	RowID       uuid.UUID `json:"row_id"`
	Scope       Scope     `json:"scope"`
	NewPosition int       `json:"new_position"`
}

// Move applies the requested rank change. Concurrency model: every
// move opens a transaction, takes SELECT FOR UPDATE on all rows in
// the affected scope (sprint cohort or backlog cohort), computes
// the new position, writes it, commits. Two concurrent movers
// against the same scope serialise on the lock — last write wins on
// the lock release order, which is exactly the semantic the spec
// asks for. Different scopes never block each other.
func (s *Service) Move(ctx context.Context, req MoveRequest) (MoveResult, error) {
	if err := req.validate(); err != nil {
		return MoveResult{}, err
	}

	cfg, err := Lookup(req.ResourceType)
	if err != nil {
		return MoveResult{}, err
	}

	ok, err := cfg.Permissions.CanRank(ctx, req.SubscriptionID, req.RowID)
	if err != nil {
		return MoveResult{}, fmt.Errorf("permission check: %w", err)
	}
	if !ok {
		return MoveResult{}, ErrForbidden
	}

	var result MoveResult
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		row, err := loadRowForUpdate(ctx, tx, cfg, req.SubscriptionID, req.RowID)
		if err != nil {
			return err
		}

		scope, scopeID := row.scope()

		// Lock the cohort. We don't actually need the rows back —
		// we just need their lock — but pgx requires a query, and
		// we'll re-use the result for position math anyway.
		cohort, err := lockCohort(ctx, tx, cfg, req.SubscriptionID, scope, scopeID)
		if err != nil {
			return err
		}

		newPos, err := computePosition(cohort, row.id, req)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, fmt.Sprintf(
			`UPDATE %s SET position = $1, updated_at = now() WHERE id = $2`,
			cfg.Table,
		), newPos, row.id)
		if err != nil {
			return fmt.Errorf("write new position: %w", err)
		}

		if needsRebalance(cohort, row.id, newPos) {
			if err := rebalance(ctx, tx, cfg, req.SubscriptionID, scope, scopeID); err != nil {
				return fmt.Errorf("rebalance: %w", err)
			}
			// Re-read final position after rebalance.
			final, err := readPosition(ctx, tx, cfg.Table, row.id)
			if err != nil {
				return err
			}
			newPos = final
		}

		result = MoveResult{RowID: row.id, Scope: scope, NewPosition: newPos}
		return nil
	})

	return result, err
}

// ─── helpers ────────────────────────────────────────────────────────

type rankRow struct {
	id             uuid.UUID
	subscriptionID uuid.UUID
	scopeID        *uuid.UUID // NULL = backlog; non-NULL = sprint/timebox
	position       int
}

func (r rankRow) scope() (Scope, *uuid.UUID) {
	if r.scopeID == nil {
		return ScopeBacklog, nil
	}
	return ScopeSprint, r.scopeID
}

func (r rankRow) currentPosition() int { return r.position }

func loadRowForUpdate(ctx context.Context, tx pgx.Tx, cfg ResourceConfig, subID, rowID uuid.UUID) (rankRow, error) {
	q := fmt.Sprintf(`
		SELECT id, subscription_id, %s, position
		FROM %s
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
		FOR UPDATE`, cfg.ScopeColumn, cfg.Table)
	var r rankRow
	err := tx.QueryRow(ctx, q, rowID, subID).
		Scan(&r.id, &r.subscriptionID, &r.scopeID, &r.position)
	if err == pgx.ErrNoRows {
		return rankRow{}, ErrRowNotFound
	}
	if err != nil {
		return rankRow{}, fmt.Errorf("load row: %w", err)
	}
	return r, nil
}

func lockCohort(ctx context.Context, tx pgx.Tx, cfg ResourceConfig, subID uuid.UUID, scope Scope, scopeID *uuid.UUID) ([]rankRow, error) {
	var (
		q    string
		args []any
	)
	if scope == ScopeBacklog {
		q = fmt.Sprintf(`
			SELECT id, subscription_id, %s, position
			FROM %s
			WHERE subscription_id = $1 AND %s IS NULL AND archived_at IS NULL
			ORDER BY position, id
			FOR UPDATE`, cfg.ScopeColumn, cfg.Table, cfg.ScopeColumn)
		args = []any{subID}
	} else {
		q = fmt.Sprintf(`
			SELECT id, subscription_id, %s, position
			FROM %s
			WHERE subscription_id = $1 AND %s = $2 AND archived_at IS NULL
			ORDER BY position, id
			FOR UPDATE`, cfg.ScopeColumn, cfg.Table, cfg.ScopeColumn)
		args = []any{subID, *scopeID}
	}

	rows, err := tx.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("lock cohort: %w", err)
	}
	defer rows.Close()

	var out []rankRow
	for rows.Next() {
		var r rankRow
		if err := rows.Scan(&r.id, &r.subscriptionID, &r.scopeID, &r.position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func readPosition(ctx context.Context, tx pgx.Tx, table string, rowID uuid.UUID) (int, error) {
	var pos int
	err := tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT position FROM %s WHERE id = $1`, table),
		rowID,
	).Scan(&pos)
	if err != nil {
		return 0, fmt.Errorf("read position: %w", err)
	}
	return pos, nil
}

func (r MoveRequest) validate() error {
	if r.ResourceType == "" || r.SubscriptionID == uuid.Nil || r.RowID == uuid.Nil {
		return fmt.Errorf("%w: resource_type, subscription_id, row_id all required", ErrInvalidArgument)
	}
	intents := 0
	if r.Before != nil {
		intents++
	}
	if r.After != nil {
		intents++
	}
	if r.ToTop {
		intents++
	}
	if r.ToBottom {
		intents++
	}
	if intents != 1 {
		return fmt.Errorf("%w: exactly one of before/after/to_top/to_bottom must be set", ErrInvalidArgument)
	}
	return nil
}
