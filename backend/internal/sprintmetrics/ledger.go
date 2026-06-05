package sprintmetrics

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// kindAccepted is the single flow kind at which value is earned. Leaving it (to
// any other kind, including "done"/"completed") restores the points — "done" is
// not "accepted".
const kindAccepted = "accepted"

// ArtefactDelta is the pure, DB-free before/after snapshot of a work item as it
// crosses a write boundary. DeriveBurnEvents turns it into ledger rows.
type ArtefactDelta struct {
	ArtefactID      string
	BeforeSprintID  string
	AfterSprintID   string
	BeforeKind      string
	AfterKind       string
	BeforePoints    int
	AfterPoints     int
	Points          int // = AfterPoints; used by add/remove/accept paths
	IsAuthoritative bool
}

// PendingEvent is one un-persisted ledger row derived from an ArtefactDelta.
type PendingEvent struct {
	SprintID    string
	ArtefactID  string
	EventType   string
	PointsDelta int
	ScopeDelta  int
	PointsAfter int
}

// DeriveBurnEvents is the pure decision core: given a before/after snapshot it
// returns the ledger rows to append. The rules are mutually-exclusive by
// precedence (membership > acceptance/points), except that acceptance and a
// points change on the SAME sprint can both fire on one write.
//
// Value is earned ONLY when the AUTHORITATIVE PARENT flow state crosses INTO
// "accepted"; leaving "accepted" (to anything) restores the points. Non-
// authoritative rows (parents whose flow state is derived from children) emit
// nothing — their children already emit.
func DeriveBurnEvents(d ArtefactDelta) []PendingEvent {
	// 1. Only the authoritative row emits value/scope events.
	if !d.IsAuthoritative {
		return nil
	}

	// 2. Sprint-membership change takes precedence over kind/points events on
	//    this same write.
	if d.BeforeSprintID != d.AfterSprintID {
		switch {
		case d.BeforeSprintID == "" && d.AfterSprintID != "":
			// Added to a sprint.
			return []PendingEvent{{
				SprintID:    d.AfterSprintID,
				ArtefactID:  d.ArtefactID,
				EventType:   EventAdded,
				ScopeDelta:  d.Points,
				PointsDelta: d.Points,
				PointsAfter: d.Points,
			}}
		case d.BeforeSprintID != "" && d.AfterSprintID == "":
			// Removed from a sprint. Scope always drops; remaining only drops if
			// the points were not already burned (i.e. not accepted).
			pointsDelta := -d.Points
			if d.BeforeKind == kindAccepted {
				pointsDelta = 0
			}
			return []PendingEvent{{
				SprintID:    d.BeforeSprintID,
				ArtefactID:  d.ArtefactID,
				EventType:   EventRemoved,
				ScopeDelta:  -d.Points,
				PointsDelta: pointsDelta,
				PointsAfter: d.Points,
			}}
		default:
			// Sprint-to-sprint move (X -> Y, both non-empty). Record it as a
			// removal from the old sprint AND an addition to the new one, so
			// BOTH ledgers stay consistent: old sprint's scope drops (and its
			// remaining drops unless the points were already burned there),
			// new sprint's scope + remaining rise by the full points.
			removedPoints := -d.Points
			if d.BeforeKind == kindAccepted {
				removedPoints = 0
			}
			return []PendingEvent{
				{
					SprintID:    d.BeforeSprintID,
					ArtefactID:  d.ArtefactID,
					EventType:   EventRemoved,
					ScopeDelta:  -d.Points,
					PointsDelta: removedPoints,
					PointsAfter: d.Points,
				},
				{
					SprintID:    d.AfterSprintID,
					ArtefactID:  d.ArtefactID,
					EventType:   EventAdded,
					ScopeDelta:  d.Points,
					PointsDelta: d.Points,
					PointsAfter: d.Points,
				},
			}
		}
	}

	// From here the item stays in the same sprint. If it is not in a sprint at
	// all, there is nothing to record.
	if d.AfterSprintID == "" {
		return nil
	}

	var out []PendingEvent

	// 3. Acceptance crossing.
	if d.BeforeKind != d.AfterKind {
		switch {
		case d.AfterKind == kindAccepted && d.BeforeKind != kindAccepted:
			out = append(out, PendingEvent{
				SprintID:    d.AfterSprintID,
				ArtefactID:  d.ArtefactID,
				EventType:   EventAccepted,
				PointsDelta: -d.Points,
				PointsAfter: d.Points,
			})
		case d.BeforeKind == kindAccepted && d.AfterKind != kindAccepted:
			out = append(out, PendingEvent{
				SprintID:    d.AfterSprintID,
				ArtefactID:  d.ArtefactID,
				EventType:   EventUnaccepted,
				PointsDelta: d.Points,
				PointsAfter: d.Points,
			})
		}
	}

	// 4. Points change (same sprint). Scope always moves by the delta; remaining
	//    only moves if the item is NOT accepted (accepted already excludes it
	//    from remaining).
	if d.BeforePoints != d.AfterPoints {
		delta := d.AfterPoints - d.BeforePoints
		pointsDelta := delta
		if d.AfterKind == kindAccepted {
			pointsDelta = 0
		}
		out = append(out, PendingEvent{
			SprintID:    d.AfterSprintID,
			ArtefactID:  d.ArtefactID,
			EventType:   EventPointsChanged,
			ScopeDelta:  delta,
			PointsDelta: pointsDelta,
			PointsAfter: d.AfterPoints,
		})
	}

	return out
}

// AppendBurnEvents derives the ledger rows for one artefact write and inserts
// them INSIDE the caller's transaction, so the ledger can never drift from the
// artefact write. It is a no-op (nil error) when no events are derived.
//
// SprintID and ArtefactID on each PendingEvent are parsed as UUIDs; a malformed
// id is a programming error and surfaces as a returned error so the tx rolls
// back rather than writing a half-row.
func AppendBurnEvents(ctx context.Context, tx pgx.Tx, d ArtefactDelta, actorID, workspaceID uuid.UUID) error {
	for _, ev := range DeriveBurnEvents(d) {
		sprintID, err := uuid.Parse(ev.SprintID)
		if err != nil {
			return err
		}
		artefactID, err := uuid.Parse(ev.ArtefactID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, sqlInsertBurnEvent,
			sprintID,
			artefactID,
			ev.EventType,
			ev.PointsDelta,
			ev.PointsAfter,
			ev.ScopeDelta,
			actorID,
			workspaceID,
		); err != nil {
			return err
		}
	}
	return nil
}
