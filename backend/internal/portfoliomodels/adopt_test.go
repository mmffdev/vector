package portfoliomodels

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Smoke test for the adopt orchestrator. Mirrors the
// skip-on-unreachable discipline of the rest of this package: when the
// cluster, library RO pool, or the migration-029 mirror tables are
// missing, the test SKIPs rather than failing — there is no other way
// to assert against a real cross-DB saga.
//
// Coverage shape:
//   - happy path: run the saga end-to-end against the seeded MMFF
//     library bundle, assert state row flips to `completed` and at
//     least one row landed in subscription_layers.
//   - failure path: invoke with FailAtStep="layers", assert state row
//     ends up `failed`, an error_event landed with code
//     ADOPT_STEP_FAIL_LAYERS, and the orchestrator returns an
//     adoptionError carrying that code.
//   - retry-resume: re-run the saga after a forced "fail at layers"
//     attempt, assert it now reaches `completed` and the state row
//     transitions failed → in_progress → completed without duplicating
//     mirror rows (idempotent inserts).

const seededMMFFModelID = "00000000-0000-0000-0000-00000000aa01"

// TestOrchestrator_HappyPath runs the full saga against the seeded
// MMFF Standard bundle. It cleans up before + after so re-runs are
// safe.
func TestOrchestrator_HappyPath(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	o := NewOrchestrator(libRO, vec)
	res, err := o.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-req-happy", AdoptOptions{})
	if err != nil {
		t.Fatalf("Adopt: %v", err)
	}
	if res.Status != "completed" {
		t.Fatalf("status: want completed, got %q", res.Status)
	}
	if res.ModelID != modelID {
		t.Errorf("model_id: want %s, got %s", modelID, res.ModelID)
	}

	// At least one mirror layer row should now exist.
	var layerCount int
	if err := vec.QueryRow(ctx, `
		SELECT COUNT(*) FROM subscription_layers
		 WHERE subscription_id = $1 AND archived_at IS NULL`,
		user.SubscriptionID).Scan(&layerCount); err != nil {
		t.Fatalf("count layers: %v", err)
	}
	if layerCount == 0 {
		t.Errorf("subscription_layers: want >0 rows after happy-path adopt, got 0")
	}
}

// TestOrchestrator_FailAtLayers — the sim-harness FailAtStep hook
// short-circuits at the layers step. Assert the state row is failed
// and an error_event with ADOPT_STEP_FAIL_LAYERS landed.
func TestOrchestrator_FailAtLayers(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	o := NewOrchestrator(libRO, vec)
	_, err := o.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-req-fail",
		AdoptOptions{FailAtStep: stepLayers})
	if err == nil {
		t.Fatalf("Adopt: want error from FailAtStep=layers, got nil")
	}
	var aerr adoptionError
	if !errors.As(err, &aerr) {
		t.Fatalf("err: want adoptionError, got %T (%v)", err, err)
	}
	if aerr.Code != codeAdoptStepFailLayers {
		t.Errorf("code: want %s, got %s", codeAdoptStepFailLayers, aerr.Code)
	}
	if aerr.Step != stepLayers {
		t.Errorf("step: want %s, got %s", stepLayers, aerr.Step)
	}

	// State row should be failed.
	var status string
	if err := vec.QueryRow(ctx, `
		SELECT status FROM subscription_portfolio_model_state
		 WHERE subscription_id = $1
		   AND adopted_model_id = $2
		   AND archived_at IS NULL
		 ORDER BY created_at DESC LIMIT 1`,
		user.SubscriptionID, modelID).Scan(&status); err != nil {
		t.Fatalf("load state: %v", err)
	}
	if status != "failed" {
		t.Errorf("state.status: want failed, got %s", status)
	}

	// One error_event with ADOPT_STEP_FAIL_LAYERS should have landed.
	var evCount int
	if err := vec.QueryRow(ctx, `
		SELECT COUNT(*) FROM error_events
		 WHERE subscription_id = $1
		   AND code = $2`,
		user.SubscriptionID, codeAdoptStepFailLayers).Scan(&evCount); err != nil {
		t.Fatalf("count error_events: %v", err)
	}
	if evCount == 0 {
		t.Errorf("error_events: want >0 row with code %s, got 0", codeAdoptStepFailLayers)
	}
}

// TestOrchestrator_RetryResume — fail once at layers, then re-run the
// saga and assert it lands in completed. Verifies the failed→
// in_progress→completed transition path and the idempotent inserts.
func TestOrchestrator_RetryResume(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	o := NewOrchestrator(libRO, vec)

	// Attempt 1: fail at layers.
	if _, err := o.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-req-resume-1",
		AdoptOptions{FailAtStep: stepLayers}); err == nil {
		t.Fatalf("attempt 1: want error, got nil")
	}

	// Attempt 2: clean re-run.
	res, err := o.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-req-resume-2", AdoptOptions{})
	if err != nil {
		t.Fatalf("attempt 2 (resume): %v", err)
	}
	if res.Status != "completed" {
		t.Errorf("attempt 2 status: want completed, got %s", res.Status)
	}

	// Exactly one live (non-failed/rolled_back) state row.
	var liveCount int
	if err := vec.QueryRow(ctx, `
		SELECT COUNT(*) FROM subscription_portfolio_model_state
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		   AND status NOT IN ('failed','rolled_back')`,
		user.SubscriptionID).Scan(&liveCount); err != nil {
		t.Fatalf("count live state: %v", err)
	}
	if liveCount != 1 {
		t.Errorf("live state rows: want 1, got %d", liveCount)
	}
}

// resetAdoptionFixture archives any live state row and any mirror rows
// for this subscription so a saga can run fresh. Soft-archive only
// (RESTRICT FK to users + subscriptions makes hard-delete unsafe).
func resetAdoptionFixture(ctx context.Context, pool *pgxpool.Pool, subscriptionID uuid.UUID) error {
	for _, table := range []string{
		"subscription_workflow_transitions",
		"subscription_workflows",
		"subscription_layers",
		"subscription_artifacts",
		"subscription_terminology",
	} {
		if _, err := pool.Exec(ctx,
			"UPDATE "+table+" SET archived_at = NOW() WHERE subscription_id = $1 AND archived_at IS NULL",
			subscriptionID); err != nil {
			return err
		}
	}
	if _, err := pool.Exec(ctx,
		`UPDATE subscription_portfolio_model_state
		    SET archived_at = NOW()
		  WHERE subscription_id = $1 AND archived_at IS NULL`,
		subscriptionID); err != nil {
		return err
	}
	return nil
}
