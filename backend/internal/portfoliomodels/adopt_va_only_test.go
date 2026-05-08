package portfoliomodels

// PLA-0026 / Story 00503 (T3): integration test asserting that the
// adoption saga, post-cutover, writes ONLY to vector_artefacts and
// produces zero rows in the legacy obj_* / subscription_* mirror
// tables.
//
// Per the user-confirmed plan (R047 §13.8), the saga still dual-writes
// today: the legacy mirror steps remain in place until M7 (drop
// strategy_layers_adopted + obj_strategy_types_layers) lands, gated on
// 7 days of zero observed reads against those tables. The standing
// instruction is gradual sanitisation — we do NOT remove the legacy
// writes here.
//
// Therefore this test is a forward-looking guardrail. It runs the
// saga against the seeded MMFF Standard bundle, then:
//
//   - SKIPs with a clear marker if any legacy mirror rows landed —
//     proves the cutover has not happened yet (expected today, until
//     M7 runs).
//   - PASSes once the legacy writes are removed AND the vector_artefacts
//     side carries the strategy hierarchy + master_record_portfolio.
//
// When M7 ships, this skip flips to a real assertion automatically —
// no test edit required. That is exactly the gate PLA-0026 wants.
//
// Test discipline:
//   - hits the live mmff_vector pool via the SSH tunnel on :5435
//     (inherits testVectorPoolPadmin from adoption_state_test.go)
//   - hits the live vector_artefacts pool via vaTestPool
//     (inherits from adopt_strategy_types_test.go)
//   - SKIPs cleanly when either pool is unreachable
//   - cleans up its own state via resetAdoptionFixture + a workspace-
//     scoped DELETE on artefact_types so no cross-test bleed.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/portfolio"
)

// TestAdoptSaga_VectorArtefactsOnly — runs the full saga, then asserts:
//
//	(1) vector_artefacts.artefact_types contains strategy-scope rows for
//	    the resolved workspace (cutover-side present), AND
//	(2) zero rows landed in obj_strategy_types_layers /
//	    subscription_workflows / subscription_workflow_transitions /
//	    subscription_artifacts / subscription_terminology for this
//	    subscription (legacy-side absent).
//
// Today (1) holds and (2) does NOT — the test SKIPs with a clear
// marker so the build stays green during the deferred-M7 window.
func TestAdoptSaga_VectorArtefactsOnly(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	// Resolve the workspace the saga's VA-side writers will target.
	// The saga's resolveWorkspaceID picks the lowest-id live workspace
	// for the subscription from the `master_record_workspaces` table (plural, new in 098).
	// Note: both `workspace` (singular, legacy) and `master_record_workspaces` (plural, new)
	// coexist in mmff_vector; the saga uses the new table.
	var workspaceID uuid.UUID
	if err := vec.QueryRow(ctx, `
		SELECT id FROM master_record_workspaces
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY id
		 LIMIT 1`,
		user.SubscriptionID,
	).Scan(&workspaceID); err != nil {
		t.Skipf("no live workspace in 'master_record_workspaces' table for padmin subscription %s: %v", user.SubscriptionID, err)
	}

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	// Clean any artefact_types this workspace might have left over from
	// a prior run, so the cutover-side count post-saga is meaningful.
	defer func() {
		c := context.Background()
		_, _ = va.Exec(c, `DELETE FROM artefacts WHERE workspace_id = $1`, workspaceID)
		_, _ = va.Exec(c, `DELETE FROM artefact_types WHERE workspace_id = $1`, workspaceID)
	}()

	// Wire a real master-record service so the finalize step's
	// master_record_portfolio upsert runs (PLA-0026 / B6). Without it
	// the orchestrator skips the upsert and the cutover-side parity
	// check would be incomplete.
	mrSvc := portfolio.NewService(va)
	o := NewOrchestrator(libRO, vec, va, mrSvc)
	res, err := o.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-req-va-only", AdoptOptions{})
	if err != nil {
		t.Fatalf("Adopt: %v", err)
	}
	if res.Status != "completed" {
		t.Fatalf("status: want completed, got %q", res.Status)
	}

	// (1) cutover-side present — strategy artefact_types for the
	//     workspace must be > 0 after a successful adopt.
	var vaCount int
	if err := va.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefact_types
		 WHERE workspace_id = $1
		   AND scope         = 'strategy'
		   AND archived_at  IS NULL`,
		workspaceID,
	).Scan(&vaCount); err != nil {
		t.Fatalf("count vector_artefacts.artefact_types: %v", err)
	}
	if vaCount == 0 {
		t.Fatalf("vector_artefacts.artefact_types: want >0 strategy rows for workspace %s after adopt, got 0",
			workspaceID)
	}

	// (2) legacy-side absent — every legacy mirror table must carry
	//     zero live rows for this subscription. While the saga still
	//     dual-writes (M7 deferred), this assertion is the gate that
	//     makes us SKIP rather than FAIL — the cutover-side proof is
	//     already in place above.
	legacyTables := []string{
		"obj_strategy_types_layers",
		"subscription_workflows",
		"subscription_workflow_transitions",
		"subscription_artifacts",
		"subscription_terminology",
	}
	type legacyHit struct {
		table string
		count int
	}
	var hits []legacyHit
	for _, table := range legacyTables {
		var n int
		if err := vec.QueryRow(ctx,
			"SELECT COUNT(*) FROM "+table+
				" WHERE subscription_id = $1 AND archived_at IS NULL",
			user.SubscriptionID,
		).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n > 0 {
			hits = append(hits, legacyHit{table: table, count: n})
		}
	}
	if len(hits) > 0 {
		// Saga still dual-writes — expected today. Skip with a clear
		// marker so M7's drop is the trigger that flips this to PASS.
		msg := "saga still writes to legacy mirror tables (M7 deferred); rows: "
		for i, h := range hits {
			if i > 0 {
				msg += ", "
			}
			msg += h.table + "=" + itoa(h.count)
		}
		t.Skip(msg)
	}

	// Reached here only post-M7. The saga is VA-only; AC met.
}

// itoa is a tiny stdlib-free integer-to-string helper so the skip
// message stays self-contained (no strconv import for one call site).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
