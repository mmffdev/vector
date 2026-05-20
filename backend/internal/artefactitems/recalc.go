package artefactitems

// Flow-state cascade — derives a parent artefact's flow state from its
// direct live children, then recurses up the chain.
//
// Rule (execution-zone only — TA/US/DE/EP):
//   - ANY child in_progress → parent → first in_progress in parent's flow.
//   - ALL children done     → parent → first done.
//   - ALL children backlog/todo → parent → first backlog (fallback todo).
//   - accepted is NEVER set automatically.
//   - No live children → no derivation (parent is freely editable).
//   - Strategy-scope rows (Theme/BO/Feature) are never auto-recalc'd —
//     the cascade stops at the strategy boundary. Manual editing on
//     strategic items remains unrestricted.
//
// Triggers (wired into the mutation paths in service.go):
//   - PatchWorkItem(flow_state_id=...) → recalc(parent_artefact_id).
//   - PatchWorkItem(parent_artefact_id=...) → recalc(old_parent), recalc(new_parent).
//   - CreateWorkItem(parent_id set)    → recalc(parent_id).
//   - ArchiveWorkItem(had parent_id)   → recalc(parent_id).
//
// The recalc engine bypasses the PatchWorkItem guard via a direct
// UPDATE (sqlSetFlowStateInternal). That's the only sanctioned path
// past the guard — every other write goes through PatchWorkItem which
// rejects with ErrParentFlowStateDerived on parented rows.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// childKindBucket holds the counts the rule cares about. One pass over
// the GROUP BY result populates all four fields.
type childKindBucket struct {
	backlog    int
	todo       int
	inProgress int
	done       int
	accepted   int
	cancelled  int
	other      int
}

func (b childKindBucket) total() int {
	return b.backlog + b.todo + b.inProgress + b.done + b.accepted + b.cancelled + b.other
}

// recalcParentFlowState applies the cascade rule to `parentID` and
// recurses upward when the parent's state changes. Safe to call with
// uuid.Nil (returns immediately).
//
// Errors are returned but caller (the mutation path) is expected to log
// and swallow — a recalc failure must NOT roll back the underlying
// PATCH/POST/DELETE. The state may briefly diverge from the rule but a
// later mutation will re-trigger the cascade.
func (s *Service) recalcParentFlowState(ctx context.Context, subscriptionID, parentID uuid.UUID) error {
	if parentID == uuid.Nil {
		return nil
	}
	if s.vectorArtefactsPool == nil {
		return nil
	}

	// Step 1 — load the parent row's recalc context (scope, type, current
	// flow_state, grandparent id). One round-trip.
	var (
		scope          string
		artefactTypeID uuid.UUID
		currentStateID uuid.UUID
		grandparentID  *uuid.UUID
		archivedAt     *string
	)
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectArtefactForRecalc,
		parentID, subscriptionID,
	).Scan(&scope, &artefactTypeID, &currentStateID, &grandparentID, &archivedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Parent isn't in this subscription — nothing to do.
			return nil
		}
		return fmt.Errorf("recalc: load parent %s: %w", parentID, err)
	}
	// Don't recalc archived rows; they're not on the visible tree.
	if archivedAt != nil {
		return nil
	}
	// Strategy boundary — never auto-set strategic artefacts' states.
	// The cascade only fires within the execution scope this service is
	// bound to (s.scope == "work"); strategy-scope rows stay user-edited.
	// We compare against s.scope rather than a literal so a future
	// renaming of scope tokens lands in NewService(...) once.
	if scope != s.scope {
		return nil
	}

	// Step 2 — bucket the parent's live children by canonical kind.
	bucket, err := s.loadChildKindBucket(ctx, subscriptionID, parentID)
	if err != nil {
		return err
	}
	// No live children = no derivation. Parent stays put and is freely
	// editable by users.
	if bucket.total() == 0 {
		return nil
	}

	// Step 3 — pick the target kind per the rule.
	targetKind := pickTargetKind(bucket)
	if targetKind == "" {
		// Rule didn't fire (e.g. mixed completed + backlog without any
		// in_progress). Parent stays where it is.
		return nil
	}

	// Step 4 — resolve the actual flow_state row to land on.
	targetStateID, err := s.firstFlowStateByKind(ctx, artefactTypeID, targetKind)
	if err != nil {
		return err
	}
	if targetStateID == uuid.Nil {
		// The parent's flow doesn't expose that kind. Skip silently —
		// re-fires next time a different bucket would apply.
		return nil
	}
	if targetStateID == currentStateID {
		// Already there.
		return nil
	}

	// Step 5 — write. Internal path bypasses the "parented row" guard
	// since the cascade IS the system, not a user.
	ct, err := s.vectorArtefactsPool.Exec(ctx, sqlSetFlowStateInternal,
		targetStateID, parentID, subscriptionID,
	)
	if err != nil {
		return fmt.Errorf("recalc: write %s: %w", parentID, err)
	}
	if ct.RowsAffected() == 0 {
		// Row disappeared between read and write — bail.
		return nil
	}

	// Fire a webhook so listeners know the change came from the cascade
	// rather than a user. Separate event name keeps downstream consumers
	// from looping (e.g. a "fire on user-changed status" automation
	// won't re-trigger on a cascade write).
	if s.notifier != nil {
		s.notifier.Fire(subscriptionID, "item.status_changed_by_cascade", map[string]string{
			"id":            parentID.String(),
			"flow_state_id": targetStateID.String(),
		})
	}

	// Step 6 — recurse up if the parent itself has a parent.
	if grandparentID != nil && *grandparentID != uuid.Nil {
		return s.recalcParentFlowState(ctx, subscriptionID, *grandparentID)
	}
	return nil
}

// loadChildKindBucket runs sqlCountChildrenByKind and projects the rows
// into a childKindBucket. Unknown kinds fall into `.other`.
func (s *Service) loadChildKindBucket(ctx context.Context, subscriptionID, parentID uuid.UUID) (childKindBucket, error) {
	var b childKindBucket
	rows, err := s.vectorArtefactsPool.Query(ctx, sqlCountChildrenByKind, parentID, subscriptionID)
	if err != nil {
		return b, fmt.Errorf("recalc: count children: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			return b, fmt.Errorf("recalc: scan child bucket: %w", err)
		}
		switch kind {
		case "backlog":
			b.backlog += n
		case "todo":
			b.todo += n
		case "in_progress":
			b.inProgress += n
		case "done":
			b.done += n
		case "accepted":
			b.accepted += n
		case "cancelled":
			b.cancelled += n
		default:
			b.other += n
		}
	}
	return b, rows.Err()
}

// pickTargetKind applies the rule against the bucket. Returns the
// flows_states_kind value (`in_progress` / `done` / `backlog` / `todo`)
// to land the parent on, or "" if no rule fires.
//
// Precedence (top wins):
//  1. ANY child in_progress         → in_progress
//  2. ALL children done OR accepted → done   (accepted is "past done" so
//     a sibling accepted alongside others done is treated as "all done")
//  3. ALL children backlog OR todo  → backlog (fallback todo if flow has no
//     backlog state — handled by firstFlowStateByKind)
//
// Mixed buckets (some done, some backlog, none in_progress) fall
// through to "" — parent stays put.
//
// `cancelled` and `other` are ignored as "doesn't count" — a cancelled
// child doesn't block the parent from completing.
func pickTargetKind(b childKindBucket) string {
	if b.inProgress > 0 {
		return "in_progress"
	}
	// Rule says ALL children must be done. Accepted is treated as ≥ done
	// because the user already manually moved that child past completed —
	// it counts toward the "all are finished" check.
	if b.done+b.accepted > 0 && b.backlog == 0 && b.todo == 0 {
		return "done"
	}
	// All backlog/todo (no done, no in_progress).
	if b.backlog+b.todo > 0 && b.done == 0 && b.accepted == 0 {
		return "backlog"
	}
	return ""
}

// firstFlowStateByKind resolves the first (lowest sort_order) live
// flow_states_id for the artefact-type's DEFAULT flow with the given
// kind. Returns uuid.Nil + nil error when no state of that kind exists
// (caller treats as "skip, the flow doesn't expose this transition").
//
// For the 'backlog' bucket the caller's intent is "land in the first
// pre-work state", so if the flow has no kind=backlog state we fall
// back to kind=todo (the canonical "pulled" state name in this repo).
func (s *Service) firstFlowStateByKind(ctx context.Context, artefactTypeID uuid.UUID, kind string) (uuid.UUID, error) {
	id, err := s.lookupFirstStateByKind(ctx, artefactTypeID, kind)
	if err != nil {
		return uuid.Nil, err
	}
	if id != uuid.Nil {
		return id, nil
	}
	// Backlog fallback — try todo when backlog is absent.
	if kind == "backlog" {
		return s.lookupFirstStateByKind(ctx, artefactTypeID, "todo")
	}
	return uuid.Nil, nil
}

func (s *Service) lookupFirstStateByKind(ctx context.Context, artefactTypeID uuid.UUID, kind string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFirstFlowStateByKind,
		artefactTypeID, kind,
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, nil
		}
		return uuid.Nil, fmt.Errorf("recalc: lookup %s: %w", kind, err)
	}
	return id, nil
}

// hasLiveChildren returns true when `id` has at least one live (non-
// archived) child in the caller's subscription. Used by the
// PatchWorkItem guard to reject manual flow_state_id writes on parented
// rows.
func (s *Service) hasLiveChildren(ctx context.Context, subscriptionID, id uuid.UUID) (bool, error) {
	if s.vectorArtefactsPool == nil {
		return false, nil
	}
	var n int
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlCountLiveChildrenOnly,
		id, subscriptionID,
	).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("recalc: count children for guard: %w", err)
	}
	return n > 0, nil
}

// loadParentID resolves the parent_artefact_id of a single artefact
// without doing a full GetWorkItem fetch. Used by the wiring code in
// PatchWorkItem so we know which parent(s) to recalc after a parent_id
// change. Returns (nil, nil) when the row has no parent.
func (s *Service) loadParentID(ctx context.Context, id uuid.UUID) (*uuid.UUID, error) {
	if s.vectorArtefactsPool == nil {
		return nil, nil
	}
	var parentID *uuid.UUID
	var subID uuid.UUID
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectParentForRecalc,
		id,
	).Scan(&parentID, &subID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("recalc: load parent_id for %s: %w", id, err)
	}
	return parentID, nil
}
