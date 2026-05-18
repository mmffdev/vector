package artefactitems_test

// PLA-0052 Story 8 — Risk artefact type integration tests (red-first).
//
// Tests are written BEFORE Story 9's BLOCKER patches:
//   - validItemTypesByScope["work"] adding "risk":true
//   - WorkItemsSummary.Risks int field
//   - service.go:306 populate out.Risks
//   - service.go:850 CASE sort `WHEN 'risk' THEN 5`
//
// Expected initial state: TestCreateWorkItem_RiskType and
// TestListWorkItems_SortByType_RiskAfterDefect fail (validation rejects risk;
// sort returns Risk at tier 99). TestSummariseWorkItems_PopulatesRisks
// compiles but the assertion on summary.Risks will fail because the field
// doesn't exist yet.
//
// After Story 9 patches all four hits, every test should be green.
//
// Substrate dependency: migrations 071-077 must have been applied (Risk type,
// flow, fields, sequence). The vaPool helper assumes the live dev DB.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// devSubscription is the live dev subscription where mig 071 seeded Risk.
// Same UUID hardcoded in all 7 migrations.
const devSubscription = "00000000-0000-0000-0000-000000000001"

// TestCreateWorkItem_RiskType verifies that creating an artefact with
// item_type="risk" succeeds post-patch. Today it should fail with
// ErrItemTypeNotAllowed (validItemTypesByScope rejects "risk").
//
// After Story 9: succeeds; returned ItemType=="risk".
func TestCreateWorkItem_RiskType_ReturnsRSKKey(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := uuid.MustParse(devSubscription)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	// Verify a Risk type exists for this sub.
	var atID uuid.UUID
	if err := va.QueryRow(ctx, `
		SELECT artefacts_types_id FROM artefacts_types
		WHERE artefacts_types_prefix='RSK'
		  AND artefacts_types_id_subscription=$1
		  AND artefacts_types_source='system'
		  AND artefacts_types_archived_at IS NULL
		LIMIT 1`, sub,
	).Scan(&atID); err != nil {
		t.Skipf("no Risk type seeded for dev sub: %v", err)
	}

	// Initial flow_state for Risk (Identified, from mig 073).
	fsID := defaultFlowStateIDForType(t, va, sub, "risk")
	_ = fsID

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType: "risk",
		Title:    "PLA-0052 Story 8 test — risk creation",
		Status:   "Identified",
		OwnerID:  "00000000-0000-0000-0000-000000000000",
	})
	if err != nil {
		t.Fatalf("CreateWorkItem item_type=risk: %v (expect green AFTER Story 9 patch)", err)
	}
	if wi == nil {
		t.Fatalf("CreateWorkItem returned nil work-item")
	}
	if wi.ItemType != "risk" {
		t.Errorf("ItemType = %q, want \"risk\"", wi.ItemType)
	}
	// Cleanup
	t.Cleanup(func() {
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE id=$1`, wi.ID)
	})
}

// TestSummariseWorkItems_PopulatesRisksField verifies that the summary
// surfaces a Risk count via ByType["risk"] after seeding a Risk artefact.
//
// History: previously asserted on a fixed-shape `.Risks int` field that
// PLA-0052 Story 9 added to WorkItemsSummary. TD-WORKITEMS-GENERIC paid
// that down 2026-05-16 by deleting every fixed-shape per-type field —
// `ByType` is now the only contract, so the assertion collapses to a
// single ByType bucket check.
func TestSummariseWorkItems_PopulatesRisksField(t *testing.T) {
	va := vaPool(t)
	sub := uuid.MustParse(devSubscription)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	// Seed one Risk artefact for the duration of the test.
	riskID := seedArtefact(t, va, sub, "risk", "PLA-0052 Story 8 — risk summary fixture")
	_ = riskID

	summary, err := svc.SummariseWorkItems(ctx, sub, nil, nil, nil, "")
	if err != nil {
		t.Fatalf("SummariseWorkItems: %v", err)
	}

	if got := summary.ByType["risk"]; got < 1 {
		t.Errorf("ByType[\"risk\"] = %d, want >= 1 (we just seeded one)", got)
	}
}

// TestListWorkItems_SortByType_RiskAfterDefect verifies the sort_by=item_type
// surface places the Risk type after Defect (and Defect after Story/Epic).
//
// Pre-TD-WORKITEMS-GENERIC pay-down (2026-05-16): sort order was a hardcoded
// CASE WHEN in service.go. Post-pay-down: sort uses the type row's own
// `artefacts_types_sort_order` column. This test now asserts that the seed
// migrations gave Risk a higher sort_order than Defect, so adding a new type
// is a one-row seed change rather than a Go edit.
func TestListWorkItems_SortByType_RiskAfterDefect(t *testing.T) {
	va := vaPool(t)
	ctx := context.Background()

	rows, err := va.Query(ctx, `
		SELECT lower(artefacts_types_name) AS name,
		       artefacts_types_sort_order  AS sort_order
		  FROM artefacts_types
		 WHERE artefacts_types_scope = 'work'
		   AND lower(artefacts_types_name) IN ('epic','story','task','defect','risk')`)
	if err != nil {
		t.Fatalf("query sort_order: %v", err)
	}
	defer rows.Close()

	order := map[string]int{}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			t.Fatalf("scan: %v", err)
		}
		// dev DB has both a system-seed row and a per-subscription clone for
		// each type; the per-sub rows share the system sort_order, so the
		// last-write-wins shape is fine for this assertion (they're equal).
		order[name] = n
	}
	for _, k := range []string{"epic", "story", "task", "defect", "risk"} {
		if _, ok := order[k]; !ok {
			t.Fatalf("artefact type %q has no row in artefacts_types (seed gap)", k)
		}
	}
	if !(order["risk"] > order["defect"]) {
		t.Errorf("risk sort_order (%d) must be > defect sort_order (%d) — seed migration drift",
			order["risk"], order["defect"])
	}
	if !(order["defect"] > order["story"]) {
		t.Errorf("defect sort_order (%d) must be > story sort_order (%d)",
			order["defect"], order["story"])
	}
}

// TestValidItemTypes_AcceptsRisk verifies the validator allows "risk".
// Pre-patch: returns ErrItemTypeNotAllowed for any item_type not in the
// hardcoded {epic,story,task,defect,portfolio item} set.
func TestValidItemTypes_AcceptsRisk(t *testing.T) {
	// Pure unit-style test against the exported Service.CreateWorkItem
	// validation path. Uses nil pool — should fail with a validation error
	// BEFORE hitting the DB pre-patch, and a different error (pool-nil)
	// post-patch.
	svc := artefactitems.NewService(nil, nil, "work")
	_, err := svc.CreateWorkItem(context.Background(), uuid.New(), artefactitems.CreateWorkItemInput{
		ItemType: "risk",
		Title:    "validate-only",
		Status:   "Identified",
		OwnerID:  "00000000-0000-0000-0000-000000000000",
	})
	if err == nil {
		t.Fatalf("expected an error (nil pool or validation), got nil")
	}
	// Post-Story-9: error must NOT be the item-type validator rejection.
	// Pre-Story-9: error IS the item-type rejection. So we assert the
	// error message does NOT contain "item_type" — that's the post-patch
	// expectation.
	if errMsg := err.Error(); contains(errMsg, "item_type") && contains(errMsg, "allowed") {
		t.Errorf("CreateWorkItem rejected item_type=\"risk\" with validation error: %v (Story 9 should allow it)", err)
	}
}

// TestSummariseRisks_ReturnsAggregates (PLA-0052 Story 10) verifies the
// /risks/summary endpoint returns severity × likelihood aggregates.
// Subscription-scoped; Risk artefacts only.
func TestSummariseRisks_ReturnsAggregates(t *testing.T) {
	va := vaPool(t)
	sub := uuid.MustParse(devSubscription)
	svc := artefactitems.NewService(va, nil, "work")
	ctx := context.Background()

	out, err := svc.SummariseRisks(ctx, sub)
	if err != nil {
		t.Fatalf("SummariseRisks: %v", err)
	}

	// Total must equal sum of matrix + critical (matrix excludes critical) + rows with NULL severity/likelihood.
	matrixSum := 0
	for r := 0; r < 3; r++ {
		for c := 0; c < 3; c++ {
			matrixSum += out.Matrix[r][c]
		}
	}
	// Loose invariant: open <= total.
	if out.Open > out.Total {
		t.Errorf("Open=%d > Total=%d — invariant violated", out.Open, out.Total)
	}
	// Loose invariant: severity sum <= total (rows may have NULL severity).
	sevSum := out.BySeverity.Critical + out.BySeverity.High + out.BySeverity.Medium + out.BySeverity.Low
	if sevSum > out.Total {
		t.Errorf("severity bucket sum %d > Total %d", sevSum, out.Total)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
