package sprintmetrics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Velocity computes the cross-sprint team velocity for a workspace: the mean
// net-accepted points over the rolling window (see ComputeVelocity). This is the
// DB-touching wrapper around the pure ComputeVelocity core — it reads each
// sprint's net accepted points from the ledger, then defers ALL the maths
// (eligibility, window, average) to the pure function so the rule lives in one
// shared, tested place.
//
// asOf is injected (not read from the clock here) so the method is deterministic
// and the same "as of" instant can be threaded from a caller or a test.
func (s *Service) Velocity(ctx context.Context, workspaceID uuid.UUID, asOf time.Time) (VelocityResult, error) {
	rows, err := s.pool.Query(ctx, sqlSelectSprintAcceptance, workspaceID)
	if err != nil {
		return VelocityResult{}, fmt.Errorf("sprintmetrics: query sprint acceptance: %w", err)
	}
	defer rows.Close()

	var accs []SprintAcceptance
	for rows.Next() {
		var (
			id, name, endStr string
			pts              int
		)
		if err := rows.Scan(&id, &name, &endStr, &pts); err != nil {
			return VelocityResult{}, fmt.Errorf("sprintmetrics: scan acceptance: %w", err)
		}
		end := parseYMD(endStr) // zero time on parse failure → treated as not-past, excluded
		accs = append(accs, SprintAcceptance{
			SprintID:    id,
			Name:        name,
			EndDate:     end,
			AcceptedPts: pts,
		})
	}
	if err := rows.Err(); err != nil {
		return VelocityResult{}, fmt.Errorf("sprintmetrics: iterate acceptance: %w", err)
	}

	return ComputeVelocity(accs, asOf), nil
}
