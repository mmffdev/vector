package artefactitems_test

// Flow-state cascade integration tests — verify the recalc engine fires
// correctly when children change, and that the manual-edit guard
// rejects flow_state_id writes on parented rows.
//
// All tests hit live vector_artefacts (same pattern as service_test.go);
// skipped automatically when the tunnel/env is down.
//
// Run:
//   BACKEND_ENV=dev go test -v -run TestRecalc ./internal/artefactitems/...

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// seedArtefactWithFlow is a tighter variant of seedArtefact: it picks an
// artefact_type that ALSO has a default flow with at least one
// flows_states row, so the cascade-related queries don't trip over
// fixture pollution (multiple "Epic" type rows where some have no
// flow attached — see the long debug session 2026-05-21).
//
// Returns the new artefact's id AND the artefact_type_id it was pinned
// to, so callers can resolve flow-state UUIDs against the SAME type id
// the recalc engine will read.
func seedArtefactWithFlow(t *testing.T, va *pgxpool.Pool, subID uuid.UUID, itemType, title string) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	// Pick a type that has a default flow with kinds in_progress AND done.
	// Without this we'd grab an orphan type whose flow_states table has
	// no in_progress row → recalc resolves to uuid.Nil and silently skips.
	var atID uuid.UUID
	err := va.QueryRow(ctx, `
		SELECT at.artefacts_types_id
		FROM artefacts_types at
		WHERE at.artefacts_types_id_subscription = $1
		  AND at.artefacts_types_scope = 'work'
		  AND lower(at.artefacts_types_name) = $2
		  AND at.artefacts_types_archived_at IS NULL
		  AND EXISTS (
			SELECT 1 FROM flows f
			JOIN flows_states fs1 ON fs1.flows_states_id_flow = f.flows_id AND fs1.flows_states_kind = 'in_progress'
			JOIN flows_states fs2 ON fs2.flows_states_id_flow = f.flows_id AND fs2.flows_states_kind = 'done'
			WHERE f.flows_id_artefact_type = at.artefacts_types_id
			  AND f.flows_is_default = TRUE
			  AND f.flows_archived_at IS NULL
		  )
		ORDER BY at.artefacts_types_created_at ASC
		LIMIT 1
	`, subID, itemType).Scan(&atID)
	if err != nil {
		t.Skipf("no %s artefact_type with complete default flow on sub %s: %v", itemType, subID, err)
	}

	// Resolve the type's initial flow state.
	var fsID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT fs.flows_states_id FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1
		  AND f.flows_is_default = TRUE
		  AND fs.flows_states_is_initial = TRUE
		  AND fs.flows_states_archived_at IS NULL
		LIMIT 1`,
		atID,
	).Scan(&fsID); err != nil {
		t.Skipf("no initial flow_state for type %s: %v", atID, err)
	}

	// Workspace + priority resolution (mirror of seedArtefact).
	var wsID uuid.UUID
	if err := va.QueryRow(ctx,
		`SELECT workspace_id FROM artefacts WHERE subscription_id=$1 LIMIT 1`, subID,
	).Scan(&wsID); err != nil {
		wsID = subID
	}
	var priorityID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT id FROM artefact_priorities
		WHERE workspace_id=$1 AND archived_at IS NULL
		ORDER BY sort_order LIMIT 1`, wsID,
	).Scan(&priorityID); err != nil {
		t.Skipf("no artefact_priorities row for workspace %s: %v", wsID, err)
	}

	// Allocate a number.
	var num int64
	_ = va.QueryRow(ctx, `
		INSERT INTO artefacts_number_sequences (subscription_id, artefact_type_id, next_num)
		VALUES ($1,$2,2)
		ON CONFLICT (subscription_id, artefact_type_id) DO UPDATE
			SET next_num = artefacts_number_sequences.next_num + 1
		RETURNING next_num - 1`,
		subID, atID,
	).Scan(&num)

	var id uuid.UUID
	if err := va.QueryRow(ctx, `
		INSERT INTO artefacts
			(subscription_id, workspace_id, artefact_type_id, number, title, flow_state_id, priority_id, position)
		VALUES ($1,$2,$3,$4,$5,$6,$7,100)
		RETURNING id`,
		subID, wsID, atID, num, title, fsID, priorityID,
	).Scan(&id); err != nil {
		t.Fatalf("insert artefact %s: %v", title, err)
	}
	t.Cleanup(func() {
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, id)
	})
	return id, atID
}

// flowStateForType resolves the first live flow_state of `kind` for the
// given artefact_type. Used by tests where seedArtefactWithFlow returned
// a specific type id and we want to assert against THAT type's flow,
// not "any flow with this name for this subscription".
func flowStateForType(t *testing.T, va *pgxpool.Pool, artefactTypeID uuid.UUID, kind string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := va.QueryRow(context.Background(), `
		SELECT fs.flows_states_id FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		WHERE f.flows_id_artefact_type = $1
		  AND f.flows_is_default = TRUE
		  AND fs.flows_states_kind = $2
		  AND fs.flows_states_archived_at IS NULL
		ORDER BY fs.flows_states_sort_order ASC
		LIMIT 1`,
		artefactTypeID, kind,
	).Scan(&id)
	if err != nil {
		t.Skipf("no kind=%s state on type %s: %v", kind, artefactTypeID, err)
	}
	return id
}

// flowStateByKind finds the first (lowest sort_order) live flow_state of
// the given kind for the default flow on this subscription's item_type.
// Test helper — mirrors what the recalc engine itself does internally,
// so we can assert "the row landed on the kind=in_progress state".
func flowStateByKind(t *testing.T, va *pgxpool.Pool, subID uuid.UUID, itemType, kind string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := va.QueryRow(ctx, `
		SELECT fs.flows_states_id FROM flows_states fs
		JOIN flows f ON f.flows_id = fs.flows_states_id_flow
		JOIN artefacts_types at ON at.artefacts_types_id = f.flows_id_artefact_type
		WHERE at.artefacts_types_id_subscription = $1
		  AND lower(at.artefacts_types_name) = $2
		  AND at.artefacts_types_scope = 'work'
		  AND f.flows_is_default = TRUE
		  AND f.flows_archived_at IS NULL
		  AND fs.flows_states_kind = $3
		  AND fs.flows_states_archived_at IS NULL
		ORDER BY fs.flows_states_sort_order ASC
		LIMIT 1`,
		subID, itemType, kind,
	).Scan(&id)
	if err != nil {
		t.Skipf("no flow_state of kind=%s for %s in sub %s: %v", kind, itemType, subID, err)
	}
	return id
}

// readFlowStateID returns the current flow_state_id of an artefact row.
func readFlowStateID(t *testing.T, va *pgxpool.Pool, id uuid.UUID) uuid.UUID {
	t.Helper()
	var fsID uuid.UUID
	if err := va.QueryRow(context.Background(),
		`SELECT flow_state_id FROM artefacts WHERE id = $1`, id,
	).Scan(&fsID); err != nil {
		t.Fatalf("read flow_state_id for %s: %v", id, err)
	}
	return fsID
}

// reparentArtefact directly updates parent_artefact_id in the DB — used
// to set the parent/child link our seed helper leaves NULL.
func reparentArtefact(t *testing.T, va *pgxpool.Pool, child, parent uuid.UUID) {
	t.Helper()
	if _, err := va.Exec(context.Background(),
		`UPDATE artefacts SET parent_artefact_id = $1 WHERE id = $2`, parent, child,
	); err != nil {
		t.Fatalf("reparent %s -> %s: %v", child, parent, err)
	}
}

// ── Cascade: ANY child in_progress → parent in_progress ──────────────────────

func TestRecalc_AnyChildInProgress_PromotesParent(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	storyID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "recalc-test story")
	taskAID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "recalc-test task A")
	taskBID, _ := seedArtefactWithFlow(t, va, sub, "task", "recalc-test task B")
	reparentArtefact(t, va, taskAID, storyID)
	reparentArtefact(t, va, taskBID, storyID)

	storyInProgress := flowStateForType(t, va, storyTypeID, "in_progress")
	taskInProgress := flowStateForType(t, va, taskTypeID, "in_progress")

	// Sanity: Story sits at its initial state (not in_progress) to start.
	if got := readFlowStateID(t, va, storyID); got == storyInProgress {
		t.Fatalf("precondition: Story shouldn't already be at in_progress (was %s)", got)
	}

	// Move task A to in_progress — this is a Task with NO children, so
	// the PATCH succeeds and the cascade fires on its parent (Story).
	taskAFsStr := taskInProgress.String()
	if _, err := svc.PatchWorkItem(ctx, sub, taskAID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskAFsStr,
	}); err != nil {
		t.Fatalf("patch task A: %v", err)
	}

	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should have cascaded to in_progress %s; got %s", storyInProgress, got)
	}
}

// ── Cascade: ALL children done → parent done ─────────────────────────────────

func TestRecalc_AllChildrenDone_PromotesParentToDone(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	storyID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "recalc-done story")
	taskAID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "recalc-done task A")
	taskBID, _ := seedArtefactWithFlow(t, va, sub, "task", "recalc-done task B")
	reparentArtefact(t, va, taskAID, storyID)
	reparentArtefact(t, va, taskBID, storyID)

	storyDone := flowStateForType(t, va, storyTypeID, "done")
	storyInProgress := flowStateForType(t, va, storyTypeID, "in_progress")
	taskDone := flowStateForType(t, va, taskTypeID, "done")
	taskDoneStr := taskDone.String()

	// Mark A done. B still at initial — mixed bucket. Under the
	// work-flows-up rule "anything not all-start-and-not-all-end" means
	// the parent is in_progress (work has happened). Story should NOT
	// be done yet, but SHOULD have moved off backlog to in_progress.
	if _, err := svc.PatchWorkItem(ctx, sub, taskAID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskDoneStr,
	}); err != nil {
		t.Fatalf("patch task A done: %v", err)
	}
	if got := readFlowStateID(t, va, storyID); got == storyDone {
		t.Fatalf("Story should NOT yet be done after only 1/2 tasks done; got %s", got)
	}
	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should have moved to in_progress after 1/2 tasks done; got %s", got)
	}

	// Now mark B done — all children done, Story should land on done.
	if _, err := svc.PatchWorkItem(ctx, sub, taskBID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskDoneStr,
	}); err != nil {
		t.Fatalf("patch task B done: %v", err)
	}
	if got := readFlowStateID(t, va, storyID); got != storyDone {
		t.Fatalf("Story should have cascaded to done %s; got %s", storyDone, got)
	}
}

// ── Cascade: recurses up through Story to Epic ───────────────────────────────

func TestRecalc_PropagatesUpThreeLevels(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	epicID, epicTypeID := seedArtefactWithFlow(t, va, sub, "epic", "recalc-cascade epic")
	storyID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "recalc-cascade story")
	taskID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "recalc-cascade task")
	reparentArtefact(t, va, storyID, epicID)
	reparentArtefact(t, va, taskID, storyID)

	epicInProgress := flowStateForType(t, va, epicTypeID, "in_progress")
	storyInProgress := flowStateForType(t, va, storyTypeID, "in_progress")
	taskInProgress := flowStateForType(t, va, taskTypeID, "in_progress")
	taskInProgressStr := taskInProgress.String()

	if _, err := svc.PatchWorkItem(ctx, sub, taskID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskInProgressStr,
	}); err != nil {
		t.Fatalf("patch task: %v", err)
	}

	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should have cascaded to in_progress %s; got %s", storyInProgress, got)
	}
	if got := readFlowStateID(t, va, epicID); got != epicInProgress {
		t.Fatalf("Epic should have cascaded to in_progress %s through Story; got %s", epicInProgress, got)
	}
}

// ── Guard: parented row rejects manual flow_state_id PATCH ───────────────────

func TestRecalc_GuardRejectsManualFlowOnParentedRow(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	storyID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "guard-test story")
	taskID, _ := seedArtefactWithFlow(t, va, sub, "task", "guard-test task")
	reparentArtefact(t, va, taskID, storyID)

	storyDone := flowStateForType(t, va, storyTypeID, "done").String()

	// Story has a live child — manual flow_state_id PATCH must be
	// rejected with ErrParentFlowStateDerived.
	_, err := svc.PatchWorkItem(ctx, sub, storyID, artefactitems.PatchWorkItemInput{
		FlowStateID: &storyDone,
	})
	if !errors.Is(err, artefactitems.ErrParentFlowStateDerived) {
		t.Fatalf("expected ErrParentFlowStateDerived, got %v", err)
	}
}

// ── Guard: childless row freely editable ─────────────────────────────────────

func TestRecalc_GuardAllowsManualFlowOnLeafRow(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	taskID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "leaf-edit task")
	taskInProgress := flowStateForType(t, va, taskTypeID, "in_progress").String()

	if _, err := svc.PatchWorkItem(ctx, sub, taskID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskInProgress,
	}); err != nil {
		t.Fatalf("childless task PATCH should succeed; got %v", err)
	}
}

// ── Archive: parent recalcs when only in_progress child is archived ──────────

func TestRecalc_ArchiveChildRecalcsParent(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	storyID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "archive-test story")
	taskAID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "archive-test task A")
	taskBID, _ := seedArtefactWithFlow(t, va, sub, "task", "archive-test task B")
	reparentArtefact(t, va, taskAID, storyID)
	reparentArtefact(t, va, taskBID, storyID)

	taskInProgress := flowStateForType(t, va, taskTypeID, "in_progress").String()
	storyInProgress := flowStateForType(t, va, storyTypeID, "in_progress")

	// A goes in_progress → Story cascades in_progress.
	if _, err := svc.PatchWorkItem(ctx, sub, taskAID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskInProgress,
	}); err != nil {
		t.Fatalf("patch A: %v", err)
	}
	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should be in_progress after A; got %s", got)
	}

	// Archive A — only sibling left is B at initial (kind=todo). Under
	// the work-flows-up rule "any child past nothing/all-end" means
	// in_progress, so a single todo child still keeps the Story at
	// in_progress (the work is queued, not finished). The cascade
	// MUST fire (children set changed), but the resulting state is
	// idempotent — Story stays at in_progress because that's still the
	// rule's answer for the new bucket {todo: 1}.
	if err := svc.ArchiveWorkItem(ctx, sub, taskAID); err != nil {
		t.Fatalf("archive A: %v", err)
	}
	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should still be in_progress after archiving A (one todo child remains); got %s", got)
	}

	// Now archive B too — Story has zero live children → rule shouldn't
	// fire (no derivation). Story stays put (still in_progress) because
	// the rule explicitly skips when total == 0.
	if err := svc.ArchiveWorkItem(ctx, sub, taskBID); err != nil {
		t.Fatalf("archive B: %v", err)
	}
	if got := readFlowStateID(t, va, storyID); got != storyInProgress {
		t.Fatalf("Story should stay where the cascade left it once it has no children; got %s", got)
	}
}

// ── Reparent: both old and new parent recalc ─────────────────────────────────

func TestRecalc_ReparentTriggersBothSides(t *testing.T) {
	va := vaPool(t)
	svc := artefactitems.NewService(va, nil, "work")
	sub := pickTestSubscription(t, va)
	ctx := context.Background()

	storyAID, storyTypeID := seedArtefactWithFlow(t, va, sub, "story", "reparent-A story")
	storyBID, _ := seedArtefactWithFlow(t, va, sub, "story", "reparent-B story")
	taskID, taskTypeID := seedArtefactWithFlow(t, va, sub, "task", "reparent task")
	reparentArtefact(t, va, taskID, storyAID)

	taskInProgress := flowStateForType(t, va, taskTypeID, "in_progress").String()
	storyInProgress := flowStateForType(t, va, storyTypeID, "in_progress")

	// Move task in_progress under Story A.
	if _, err := svc.PatchWorkItem(ctx, sub, taskID, artefactitems.PatchWorkItemInput{
		FlowStateID: &taskInProgress,
	}); err != nil {
		t.Fatalf("patch task: %v", err)
	}
	if got := readFlowStateID(t, va, storyAID); got != storyInProgress {
		t.Fatalf("Story A should be in_progress; got %s", got)
	}

	// Reparent to Story B.
	storyBStr := storyBID.String()
	if _, err := svc.PatchWorkItem(ctx, sub, taskID, artefactitems.PatchWorkItemInput{
		ParentArtefactID: &storyBStr,
	}); err != nil {
		t.Fatalf("reparent task: %v", err)
	}

	// Story A no longer has the in_progress child (no children at all)
	// → A's state is freely editable; no derivation; it stays put. But
	// importantly it shouldn't be stuck claiming in_progress when we
	// move the task — actually our rule says no children → no
	// derivation → parent stays put. So we DON'T expect A to revert.
	// What we DO expect is Story B to flip to in_progress.
	if got := readFlowStateID(t, va, storyBID); got != storyInProgress {
		t.Fatalf("Story B should be in_progress after reparent; got %s", got)
	}
}
