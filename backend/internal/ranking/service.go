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
		row, err := loadRowForUpdate(ctx, tx, cfg.Table, req.SubscriptionID, req.RowID)
		if err != nil {
			return err
		}

		scope, scopeID := row.scope()

		// Lock the cohort. We don't actually need the rows back —
		// we just need their lock — but pgx requires a query, and
		// we'll re-use the result for position math anyway.
		cohort, err := lockCohort(ctx, tx, cfg.Table, req.SubscriptionID, scope, scopeID)
		if err != nil {
			return err
		}

		newPos, err := computePosition(cohort, row.id, req)
		if err != nil {
			return err
		}

		// Write the new position. Only the active scope column is
		// non-NULL; flip per scope.
		if scope == ScopeBacklog {
			_, err = tx.Exec(ctx, fmt.Sprintf(
				`UPDATE %s SET backlog_position = $1, updated_at = now() WHERE id = $2`,
				cfg.Table,
			), newPos, row.id)
		} else {
			_, err = tx.Exec(ctx, fmt.Sprintf(
				`UPDATE %s SET sprint_position = $1, updated_at = now() WHERE id = $2`,
				cfg.Table,
			), newPos, row.id)
		}
		if err != nil {
			return fmt.Errorf("write new position: %w", err)
		}

		if needsRebalance(cohort, row.id, newPos) {
			if err := rebalance(ctx, tx, cfg.Table, req.SubscriptionID, scope, scopeID); err != nil {
				return fmt.Errorf("rebalance: %w", err)
			}
			// Re-read final position after rebalance.
			final, err := readPosition(ctx, tx, cfg.Table, row.id, scope)
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
	id              uuid.UUID
	subscriptionID  uuid.UUID
	sprintID        *uuid.UUID
	backlogPosition *int
	sprintPosition  *int
}

func (r rankRow) scope() (Scope, *uuid.UUID) {
	if r.sprintID == nil {
		return ScopeBacklog, nil
	}
	return ScopeSprint, r.sprintID
}

func (r rankRow) currentPosition(scope Scope) int {
	switch scope {
	case ScopeBacklog:
		if r.backlogPosition != nil {
			return *r.backlogPosition
		}
	case ScopeSprint:
		if r.sprintPosition != nil {
			return *r.sprintPosition
		}
	}
	return 0
}

func loadRowForUpdate(ctx context.Context, tx pgx.Tx, table string, subID, rowID uuid.UUID) (rankRow, error) {
	q := fmt.Sprintf(`
		SELECT id, subscription_id, sprint_id, backlog_position, sprint_position
		FROM %s
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
		FOR UPDATE`, table)
	var r rankRow
	err := tx.QueryRow(ctx, q, rowID, subID).
		Scan(&r.id, &r.subscriptionID, &r.sprintID, &r.backlogPosition, &r.sprintPosition)
	if err == pgx.ErrNoRows {
		return rankRow{}, ErrRowNotFound
	}
	if err != nil {
		return rankRow{}, fmt.Errorf("load row: %w", err)
	}
	return r, nil
}

func lockCohort(ctx context.Context, tx pgx.Tx, table string, subID uuid.UUID, scope Scope, scopeID *uuid.UUID) ([]rankRow, error) {
	var (
		q    string
		args []any
	)
	if scope == ScopeBacklog {
		q = fmt.Sprintf(`
			SELECT id, subscription_id, sprint_id, backlog_position, sprint_position
			FROM %s
			WHERE subscription_id = $1 AND sprint_id IS NULL AND archived_at IS NULL
			ORDER BY backlog_position NULLS LAST, id
			FOR UPDATE`, table)
		args = []any{subID}
	} else {
		q = fmt.Sprintf(`
			SELECT id, subscription_id, sprint_id, backlog_position, sprint_position
			FROM %s
			WHERE subscription_id = $1 AND sprint_id = $2 AND archived_at IS NULL
			ORDER BY sprint_position NULLS LAST, id
			FOR UPDATE`, table)
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
		if err := rows.Scan(&r.id, &r.subscriptionID, &r.sprintID, &r.backlogPosition, &r.sprintPosition); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func readPosition(ctx context.Context, tx pgx.Tx, table string, rowID uuid.UUID, scope Scope) (int, error) {
	col := "backlog_position"
	if scope == ScopeSprint {
		col = "sprint_position"
	}
	var pos *int
	err := tx.QueryRow(ctx,
		fmt.Sprintf(`SELECT %s FROM %s WHERE id = $1`, col, table),
		rowID,
	).Scan(&pos)
	if err != nil {
		return 0, err
	}
	if pos == nil {
		return 0, fmt.Errorf("read position: row %s has NULL %s after move", rowID, col)
	}
	return *pos, nil
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

