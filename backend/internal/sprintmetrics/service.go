package sprintmetrics

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service replays the sprint_burn_events ledger on demand. It holds no state
// beyond the pool — every Metrics call re-reads and recomputes from scratch.
type Service struct {
	pool *pgxpool.Pool
}

// NewService wires the service to the vector_artefacts pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Metrics reads the sprint window and its ledger, then projects the neutral
// chart-agnostic Model. It performs no caching.
func (s *Service) Metrics(ctx context.Context, sprintID, workspaceID uuid.UUID) (Model, error) {
	var start, end string
	if err := s.pool.QueryRow(ctx, sqlSelectSprintWindow, sprintID).Scan(&start, &end); err != nil {
		return Model{}, fmt.Errorf("sprintmetrics: load window: %w", err)
	}

	rows, err := s.pool.Query(ctx, sqlSelectBurnEvents, sprintID, workspaceID)
	if err != nil {
		return Model{}, fmt.Errorf("sprintmetrics: query events: %w", err)
	}
	defer rows.Close()

	var events []BurnEvent
	for rows.Next() {
		var e BurnEvent
		if err := rows.Scan(&e.ArtefactID, &e.EventType, &e.PointsDelta, &e.ScopeDelta, &e.OccurredAt); err != nil {
			return Model{}, fmt.Errorf("sprintmetrics: scan event: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return Model{}, fmt.Errorf("sprintmetrics: iterate events: %w", err)
	}

	win := buildWindow(start, end)
	return Project(ProjectInput{Window: win, Events: events}), nil
}

// buildWindow computes the sprint span (SprintDays, whole-day, clamped >= 0)
// and where "now" sits within it (Today, clamped 0..span).
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
