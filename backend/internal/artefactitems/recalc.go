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
	// flow_state + its kind, grandparent id). One round-trip.
	var (
		scope          string
		artefactTypeID uuid.UUID
		currentStateID uuid.UUID
		currentKind    string
		grandparentID  *uuid.UUID
		archivedAt     *string
	)
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectArtefactForRecalc,
		parentID, subscriptionID,
	).Scan(&scope, &artefactTypeID, &currentStateID, &currentKind, &grandparentID, &archivedAt)
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
	// IMPORTANT — there is NO "accepted is sacred" skip. The rule is:
	// every parent follows its children, propagating up. If a child
	// moves back from done → in_progress, an accepted parent MUST
	// follow back. Manual acceptance sticks only while the children
	// still agree with the terminal bucket; the moment they diverge,
	// the cascade re-asserts. `currentKind` is read for the unused-var
	// suppression below — kept on the load so future rule tweaks have
	// it without another SQL change.
	_ = currentKind

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

	// Step 4 — resolve the actual flow_state row to land on. Honours
	// tenant-customised transition rules: the target must be reachable
	// from currentStateID via a single flows_transitions edge. If no
	// legal edge exists, we fall back to the first state of the target
	// kind on the type's default flow — this is the bootstrapping case
	// for fresh rows whose currentStateID has no outgoing edges yet, OR
	// when the tenant hasn't customised transitions. Falls through to
	// uuid.Nil only when the type has no state of that kind at all.
	targetStateID, err := s.resolveTargetState(ctx, artefactTypeID, currentStateID, targetKind)
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

// recalcParentFlowStateCollecting — Slice 4.6c of the ObjectTree refactor.
// Same cascade logic as recalcParentFlowState but appends every row id
// the cascade WROTE to `touched`. Used by PatchWorkItem to report
// touched_ids in the response so the frontend can narrow its refetch
// to only the rows the cascade actually changed.
//
// This is a parallel implementation of the recalc function — same shape,
// extra slice append at the write site, recursion threads the slice
// through. Returning `*touched` lets the caller append from multiple
// recalcs (parent_artefact_id patches recalc OLD + NEW parents).
//
// As with the existing recalcParentFlowState, errors are surfaced but
// the caller is expected to log + swallow.
func (s *Service) recalcParentFlowStateCollecting(
	ctx context.Context,
	subscriptionID, parentID uuid.UUID,
	touched *[]uuid.UUID,
) error {
	if parentID == uuid.Nil {
		return nil
	}
	if s.vectorArtefactsPool == nil {
		return nil
	}

	var (
		scope          string
		artefactTypeID uuid.UUID
		currentStateID uuid.UUID
		currentKind    string
		grandparentID  *uuid.UUID
		archivedAt     *string
	)
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectArtefactForRecalc,
		parentID, subscriptionID,
	).Scan(&scope, &artefactTypeID, &currentStateID, &currentKind, &grandparentID, &archivedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("recalc: load parent %s: %w", parentID, err)
	}
	if archivedAt != nil {
		return nil
	}
	if scope != s.scope {
		return nil
	}
	_ = currentKind

	bucket, err := s.loadChildKindBucket(ctx, subscriptionID, parentID)
	if err != nil {
		return err
	}
	if bucket.total() == 0 {
		return nil
	}

	targetKind := pickTargetKind(bucket)
	if targetKind == "" {
		return nil
	}

	targetStateID, err := s.resolveTargetState(ctx, artefactTypeID, currentStateID, targetKind)
	if err != nil {
		return err
	}
	if targetStateID == uuid.Nil {
		return nil
	}
	if targetStateID == currentStateID {
		return nil
	}

	ct, err := s.vectorArtefactsPool.Exec(ctx, sqlSetFlowStateInternal,
		targetStateID, parentID, subscriptionID,
	)
	if err != nil {
		return fmt.Errorf("recalc: write %s: %w", parentID, err)
	}
	if ct.RowsAffected() == 0 {
		return nil
	}

	// Slice 4.6c — record the touched row id BEFORE recursing so the
	// cascade order is parent-first, ancestor-after (deepest-changed
	// last). Frontend doesn't care about order, but predictable order
	// makes tests easier.
	*touched = append(*touched, parentID)

	if s.notifier != nil {
		s.notifier.Fire(subscriptionID, "item.status_changed_by_cascade", map[string]string{
			"id":            parentID.String(),
			"flow_state_id": targetStateID.String(),
		})
	}

	if grandparentID != nil && *grandparentID != uuid.Nil {
		return s.recalcParentFlowStateCollecting(ctx, subscriptionID, *grandparentID, touched)
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
// flows_states_kind value (`in_progress` / `done` / `backlog`) to land
// the parent on, or "" when the rule shouldn't move the parent.
//
// Semantic (work-flows-up):
//   - ALL children at the start (backlog only)   → parent backlog
//   - ALL children at the end   (done/accepted)  → parent done
//   - ANYTHING ELSE — any progress at all but
//     not all the way finished                   → parent in_progress
//
// This is the "anything in flight or mixed = in_progress" rule. It
// includes the case the prior version missed: a child moved from
// backlog to done while a sibling is still backlog/todo — work has
// HAPPENED, so the parent is in_progress, not stuck at backlog.
//
// `accepted` is treated as ≥ done for the "all-finished" check (the
// user manually moved that child past completed; it counts toward the
// terminal bucket). `accepted` is NEVER set automatically on the
// parent — only `done` is the auto-terminal state.
//
// `cancelled` and `other` are ignored as "doesn't count" — a cancelled
// child doesn't block the parent from completing.
func pickTargetKind(b childKindBucket) string {
	// All children are at the terminal bucket → parent done.
	// (Both done and accepted count as terminal; either or both is fine.)
	if (b.done+b.accepted) > 0 && b.backlog == 0 && b.todo == 0 && b.inProgress == 0 {
		return "done"
	}
	// All children are at the start bucket → parent backlog.
	// (`backlog` strictly here; a single child past backlog flips us to
	// the in_progress branch below.)
	if b.backlog > 0 && b.todo == 0 && b.inProgress == 0 && b.done == 0 && b.accepted == 0 {
		return "backlog"
	}
	// Any other shape with at least one live child counts as in_progress.
	// Includes:
	//   - any child in 'doing' (was the original rule)
	//   - any child in 'todo' (pulled from backlog — work has started)
	//   - mixed buckets (some done, some not) — parent is mid-flight
	if b.total() > 0 {
		return "in_progress"
	}
	return ""
}

// resolveTargetState picks the flow_state the cascade should land
// `parent` on given:
//   - the parent's artefact type (so we can scope to its default flow)
//   - the parent's CURRENT state (so we can honour transition edges)
//   - the desired kind ("in_progress" / "done" / "backlog")
//
// Precedence:
//  1. **Reachable via transition edge** — first state of the target
//     kind that flows_transitions allows from currentStateID. Respects
//     tenant-customised transition rules. This is the right answer for
//     a row in mid-flow.
//  2. **Type-default fallback** — first state of the target kind on
//     the type's default flow, even if no edge reaches it from
//     currentStateID. Covers two cases:
//       (a) bootstrapping — currentStateID has no outgoing edges yet
//           (e.g. a freshly-created row whose state was set by
//           CreateWorkItem's is_initial pick, before any user has
//           authored a transition graph).
//       (b) backlog fallback — the rule says move parent to backlog,
//           but the flow's backlog state is unreachable via the user's
//           edge graph. Still better to land somewhere visible than
//           leave parent stuck.
//  3. **Backlog→todo fallback** — when the flow has no kind=backlog
//     state at all, treat kind=todo as the canonical "pre-work" landing.
//
// Returns uuid.Nil when none of the above apply (e.g. the flow has no
// state of the target kind whatsoever — Task default flow has no
// 'backlog' state). Caller treats as "skip; no legal move toward this
// kind right now".
func (s *Service) resolveTargetState(
	ctx context.Context,
	artefactTypeID, currentStateID uuid.UUID,
	kind string,
) (uuid.UUID, error) {
	// 1. Try the edge-respecting path first.
	id, err := s.lookupReachableStateByKind(ctx, currentStateID, kind)
	if err != nil {
		return uuid.Nil, err
	}
	if id != uuid.Nil {
		return id, nil
	}
	// 2. Fall back to the type-default first-by-kind.
	id, err = s.firstFlowStateByKind(ctx, artefactTypeID, kind)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// lookupReachableStateByKind asks: from `currentStateID`, is there a
// single flows_transitions edge to a state of `kind`? Returns uuid.Nil
// + nil error when no such edge exists (sql.ErrNoRows is the expected
// happy-path "no" answer).
func (s *Service) lookupReachableStateByKind(
	ctx context.Context,
	currentStateID uuid.UUID,
	kind string,
) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectFirstReachableStateByKind,
		currentStateID, kind,
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			return uuid.Nil, nil
		}
		return uuid.Nil, fmt.Errorf("recalc: lookup reachable %s: %w", kind, err)
	}
	return id, nil
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

// currentFlowStateKind reads the flows_states_kind of an artefact's
// current state. Returns "" when the row has no flow state (defensive
// — shouldn't happen post-mig but the LEFT JOIN allows it) or the row
// doesn't exist. Used by the PatchWorkItem guard so terminal-state
// parents (done / accepted) can be manually edited — once the cascade
// has finished its job, the user is back in control (to mark accepted
// or push the parent back to in_progress for further work).
func (s *Service) currentFlowStateKind(ctx context.Context, subscriptionID, id uuid.UUID) (string, error) {
	if s.vectorArtefactsPool == nil {
		return "", nil
	}
	var kind string
	err := s.vectorArtefactsPool.QueryRow(ctx, sqlSelectCurrentFlowKind,
		id, subscriptionID,
	).Scan(&kind)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("recalc: read current kind for guard: %w", err)
	}
	return kind, nil
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
