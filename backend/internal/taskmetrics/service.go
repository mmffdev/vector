package taskmetrics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service replays the task_burn_events ledger on demand. Holds no state beyond
// the pool — every Metrics call re-reads and recomputes from scratch.
type Service struct {
	pool *pgxpool.Pool
}

// NewService wires the service to the vector_artefacts pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Metrics reads the sprint window and its task ledger, then projects the neutral
// count Model. No caching.
func (s *Service) Metrics(ctx context.Context, sprintID, workspaceID uuid.UUID) (Model, error) {
	var start, end string
	if err := s.pool.QueryRow(ctx, sqlSelectSprintWindow, sprintID).Scan(&start, &end); err != nil {
		return Model{}, fmt.Errorf("taskmetrics: load window: %w", err)
	}

	rows, err := s.pool.Query(ctx, sqlSelectTaskBurnEvents, sprintID, workspaceID)
	if err != nil {
		return Model{}, fmt.Errorf("taskmetrics: query events: %w", err)
	}
	defer rows.Close()

	var events []TaskBurnEvent
	for rows.Next() {
		var e TaskBurnEvent
		if err := rows.Scan(&e.ArtefactID, &e.EventType, &e.RemainingDelta, &e.ScopeDelta, &e.OccurredAt); err != nil {
			return Model{}, fmt.Errorf("taskmetrics: scan event: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return Model{}, fmt.Errorf("taskmetrics: iterate events: %w", err)
	}

	win := buildWindow(start, end)
	return Project(ProjectInput{Window: win, Events: events}), nil
}

// buildWindow computes the sprint span and where "now" sits within it.
func buildWindow(start, end string) Window {
	span := dayOffset(start, end)
	if span < 0 {
		span = 0
	}
	today := 0
	if s := parseYMD(start); !s.IsZero() {
		today = int(time.Now().UTC().Sub(s).Hours() / 24)
	}
	if today < 0 {
		today = 0
	}
	if today > span {
		today = span
	}
	return Window{Start: start, End: end, Today: today, SprintDays: span}
}
