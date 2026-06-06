package taskmetrics

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TaskDelta is the pure before/after snapshot of a TASK crossing a write
// boundary. BeforeSprintID/AfterSprintID are the task's EFFECTIVE sprint — its
// parent story's sprint — resolved in-tx by the caller, NOT the task's own
// sprint_id column. IsTaskUnit gates all emission: only slot wrk_task emits.
type TaskDelta struct {
	ArtefactID     string
	BeforeSprintID string
	AfterSprintID  string
	BeforeKind     string
	AfterKind      string
	IsTaskUnit     bool
}

// PendingEvent is one un-persisted ledger row derived from a TaskDelta.
type PendingEvent struct {
	SprintID       string
	ArtefactID     string
	EventType      string
	RemainingDelta int
	ScopeDelta     int
}

// DeriveTaskEvents is the pure decision core. Membership change (parent story's
// sprint changed) takes precedence over a done/undone crossing on the same
// write. Counts only — a task is size 1.
func DeriveTaskEvents(d TaskDelta) []PendingEvent {
	if !d.IsTaskUnit {
		return nil
	}

	if d.BeforeSprintID != d.AfterSprintID {
		switch {
		case d.BeforeSprintID == "" && d.AfterSprintID != "":
			return []PendingEvent{{
				SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID,
				EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1,
			}}
		case d.BeforeSprintID != "" && d.AfterSprintID == "":
			rem := -1
			if d.BeforeKind == kindDone {
				rem = 0
			}
			return []PendingEvent{{
				SprintID: d.BeforeSprintID, ArtefactID: d.ArtefactID,
				EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: rem,
			}}
		default:
			rem := -1
			if d.BeforeKind == kindDone {
				rem = 0
			}
			return []PendingEvent{
				{SprintID: d.BeforeSprintID, ArtefactID: d.ArtefactID, EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: rem},
				{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1},
			}
		}
	}

	if d.AfterSprintID == "" {
		return nil
	}

	// done/undone crossing within the same sprint.
	if d.BeforeKind != d.AfterKind {
		switch {
		case d.AfterKind == kindDone && d.BeforeKind != kindDone:
			return []PendingEvent{{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventDone, RemainingDelta: -1}}
		case d.BeforeKind == kindDone && d.AfterKind != kindDone:
			return []PendingEvent{{SprintID: d.AfterSprintID, ArtefactID: d.ArtefactID, EventType: EventUndone, RemainingDelta: 1}}
		}
	}

	return nil
}

// AppendTaskEvents derives ledger rows for one task write and inserts them
// INSIDE the caller's tx so the ledger can never drift from the artefact write.
// No-op (nil error) when no events are derived.
func AppendTaskEvents(ctx context.Context, tx pgx.Tx, d TaskDelta, actorID, workspaceID uuid.UUID) error {
	for _, ev := range DeriveTaskEvents(d) {
		sprintID, err := uuid.Parse(ev.SprintID)
		if err != nil {
			return err
		}
		artefactID, err := uuid.Parse(ev.ArtefactID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, sqlInsertTaskBurnEvent,
			sprintID, artefactID, ev.EventType, ev.RemainingDelta, ev.ScopeDelta, actorID, workspaceID,
		); err != nil {
			return err
		}
	}
	return nil
}
