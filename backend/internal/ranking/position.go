package ranking

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Default gap between adjacent positions when assigning. 100 leaves
// 99 free slots between any two neighbours before a rebalance is
// needed; in practice you can do many drag operations between
// rebalances.
const defaultGap = 100

// minGap below which the cohort must be rebalanced — when neighbours
// touch (gap < 2), there's no room to insert between them.
const minGap = 2

// computePosition decides the new integer position for the moving
// row given the current cohort (already locked) and the move intent.
//
// `cohort` is the FOR-UPDATE-locked rows in the affected scope, in
// their current display order. The moving row IS included in the
// cohort and must be filtered out when picking neighbours, otherwise
// "move below the row immediately below me" produces a no-op.
func computePosition(cohort []rankRow, movingID uuid.UUID, req MoveRequest) (int, error) {
	others := excludeMover(cohort, movingID)

	switch {
	case req.ToTop:
		if len(others) == 0 {
			return defaultGap, nil
		}
		return others[0].currentPosition() - defaultGap, nil

	case req.ToBottom:
		if len(others) == 0 {
			return defaultGap, nil
		}
		return others[len(others)-1].currentPosition() + defaultGap, nil

	case req.Before != nil:
		idx := findIndex(others, *req.Before)
		if idx < 0 {
			return 0, fmt.Errorf("%w: before-target not in scope", ErrScopeMismatch)
		}
		target := others[idx].currentPosition()
		if idx == 0 {
			return target - defaultGap, nil
		}
		prev := others[idx-1].currentPosition()
		return midpoint(prev, target), nil

	case req.After != nil:
		idx := findIndex(others, *req.After)
		if idx < 0 {
			return 0, fmt.Errorf("%w: after-target not in scope", ErrScopeMismatch)
		}
		target := others[idx].currentPosition()
		if idx == len(others)-1 {
			return target + defaultGap, nil
		}
		next := others[idx+1].currentPosition()
		return midpoint(target, next), nil
	}

	return 0, fmt.Errorf("%w: no move intent", ErrInvalidArgument)
}

// needsRebalance is true when the new position can't sit between its
// neighbours without colliding (gap collapsed). Cheap and approximate
// — the rebalancer below produces clean 100-step output regardless.
func needsRebalance(cohort []rankRow, movingID uuid.UUID, newPos int) bool {
	others := excludeMover(cohort, movingID)
	for i, o := range others {
		pos := o.currentPosition()
		if i > 0 {
			gap := pos - others[i-1].currentPosition()
			if gap < minGap {
				return true
			}
		}
		if abs(pos-newPos) < minGap {
			return true
		}
	}
	return false
}

// rebalance rewrites every position in the scope to clean 100-step
// values, preserving current order. Runs inside the same transaction
// as the move, so observers see the move + rebalance atomically.
func rebalance(ctx context.Context, tx pgx.Tx, cfg ResourceConfig, subID uuid.UUID, scope Scope, scopeID *uuid.UUID) error {
	scopeCond := fmt.Sprintf("%s IS NULL", cfg.ScopeColumn)
	args := []any{subID}
	if scope == ScopeSprint {
		scopeCond = fmt.Sprintf("%s = $2", cfg.ScopeColumn)
		args = append(args, *scopeID)
	}

	q := fmt.Sprintf(`
		WITH ordered AS (
			SELECT id, row_number() OVER (ORDER BY position, id) * %d AS pos
			FROM %s
			WHERE subscription_id = $1 AND %s AND archived_at IS NULL
		)
		UPDATE %s t
		SET position = ordered.pos
		FROM ordered
		WHERE t.id = ordered.id`,
		defaultGap, cfg.Table, scopeCond, cfg.Table,
	)

	_, err := tx.Exec(ctx, q, args...)
	return err
}

// ─── tiny helpers ────────────────────────────────────────────────

func excludeMover(cohort []rankRow, id uuid.UUID) []rankRow {
	out := make([]rankRow, 0, len(cohort))
	for _, r := range cohort {
		if r.id != id {
			out = append(out, r)
		}
	}
	return out
}

func findIndex(rows []rankRow, id uuid.UUID) int {
	for i, r := range rows {
		if r.id == id {
			return i
		}
	}
	return -1
}

func midpoint(a, b int) int { return a + (b-a)/2 }

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
