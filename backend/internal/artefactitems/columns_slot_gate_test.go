package artefactitems

import (
	"sort"
	"testing"
)

// Drift-pin test: the Family tags on ArtefactItemColumns MUST mirror the
// live DB slot-gate trigger trg_artefacts_slot_gate_aiu_fn (migration 158,
// extended by migration 162). The trigger is the HARD enforcement; the
// Family tag is the Form Layout Builder's presentation + save-validation
// mirror. If this test breaks, mig 158/162 and the Go rubric have diverged
// — reconcile them; do NOT loosen the test to make it pass.
//
// The expected sets below are transcribed from the trigger function body
// (the IF-block column lists in db/vector_artefacts/schema/{158,162}*.sql).
// The trigger references DB column names (artefacts_<col>); the catalogue
// Name is that name with the artefacts_ prefix stripped — the names below
// are the catalogue Name form.

// triggerDefectColumns — the wrk_defect-gated set (mig 158 + 162).
var triggerDefectColumns = []string{
	"defect_resolution",
	"defect_test_case_status",
	"defect_fixed_in_build",
	"defect_found_in_build",
	"defect_is_release_note",
	"defect_steps_to_reproduce",
	"defect_steps_to_reproduce_doc",
	"defect_is_regression",
	"environment",
	"defect_severity",
	"defect_status",
	"affects_doc",
	"defect_browser", // added mig 162
}

// triggerRiskColumns — the wrk_risk-gated set (mig 152, in trigger 158).
//
// NOTE the documented exception: risk_calculated is a GENERATED column that
// self-gates via NULL inputs, so the trigger does NOT list it. The Go
// catalogue tags it FamilyRisk anyway (the builder must never offer a
// read-only generated column on a non-risk type) — Go is intentionally
// STRICTER than the trigger for this one column. It is therefore NOT in the
// trigger set below but IS expected in the Go set; the assertion accounts
// for it explicitly.
var triggerRiskColumns = []string{
	"risk_resolution",
	"risk_impact",
	"risk_impact_score",
	"risk_probability",
	"risk_probability_score",
	"risk_response",
	"risk_exposure",
}

// goStricterThanTrigger — columns the Go rubric gates that the trigger does
// NOT, by deliberate decision. Each entry must carry a comment justifying
// why Go-stricter is safe (presentation hides it; the trigger would have
// allowed a NULL). Keep this list TINY — it is an escape hatch, not a habit.
var goStricterThanTrigger = map[string]string{
	// GENERATED column, read-only; self-gates via NULL inputs in the DB.
	// Hiding it on non-risk types in the builder is correct.
	"risk_calculated": FamilyRisk,
}

// triggerTaskColumns — the wrk_task-gated set (mig 147 Decision E).
var triggerTaskColumns = []string{
	"estimate_hours",
	"estimate_remaining",
}

// triggerSubmittedByColumns — gated to slot IN (wrk_defect, wrk_risk) (mig 153).
var triggerSubmittedByColumns = []string{
	"submitted_by_user_id",
}

// triggerStrategyColumns — the scope=strategy-gated set (mig 154 + 162).
var triggerStrategyColumns = []string{
	"strategic_job_size",
	"strategic_preliminary_estimate_value",
	"strategic_investment_group",
	"strategic_value_stream_identifier", // added mig 162
	"strategic_investment_weight",       // added mig 162
}

// goColumnsForFamily returns the catalogue Names tagged with the given Family.
func goColumnsForFamily(family string) []string {
	var out []string
	for _, c := range ArtefactItemColumns {
		if c.Family == family {
			out = append(out, c.Name)
		}
	}
	sort.Strings(out)
	return out
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func assertSetEqual(t *testing.T, family string, want, got []string) {
	t.Helper()
	want = sortedCopy(want)
	got = sortedCopy(got)
	wantSet := map[string]bool{}
	for _, c := range want {
		wantSet[c] = true
	}
	gotSet := map[string]bool{}
	for _, c := range got {
		gotSet[c] = true
	}
	for _, c := range want {
		if !gotSet[c] {
			t.Errorf("family %q: trigger gates %q but the Go catalogue does NOT tag it Family=%q — add the Family tag in columns.go (mig 158/162 drift)", family, c, family)
		}
	}
	for _, c := range got {
		if !wantSet[c] {
			if expectFam, ok := goStricterThanTrigger[c]; ok && expectFam == family {
				continue // documented Go-stricter exception
			}
			t.Errorf("family %q: the Go catalogue tags %q Family=%q but the trigger does NOT gate it — either remove the tag or add it to goStricterThanTrigger with justification (mig 158/162 drift)", family, c, family)
		}
	}
}

func TestFamilyTagsMatchSlotGateTrigger(t *testing.T) {
	cases := []struct {
		family string
		want   []string
	}{
		{FamilyDefect, triggerDefectColumns},
		{FamilyRisk, triggerRiskColumns},
		{FamilyTask, triggerTaskColumns},
		{FamilySubmittedBy, triggerSubmittedByColumns},
		{FamilyStrategy, triggerStrategyColumns},
	}
	for _, tc := range cases {
		assertSetEqual(t, tc.family, tc.want, goColumnsForFamily(tc.family))
	}
}

// TestGoStricterExceptionsAreActuallyTagged guards the escape hatch: every
// entry in goStricterThanTrigger must actually be tagged with the stated
// family in the catalogue (so the map can't rot into a lie).
func TestGoStricterExceptionsAreActuallyTagged(t *testing.T) {
	for name, family := range goStricterThanTrigger {
		spec, ok := CoreColumnSpecForName(name)
		if !ok {
			t.Errorf("goStricterThanTrigger lists %q but it is not in the catalogue", name)
			continue
		}
		if spec.Family != family {
			t.Errorf("goStricterThanTrigger says %q should be Family=%q but the catalogue tags it Family=%q", name, family, spec.Family)
		}
	}
}

// TestAppliesToTypeGating spot-checks the predicate against representative
// (slot, scope) tuples so a future refactor of AppliesToType can't silently
// change the gating semantics.
func TestAppliesToTypeGating(t *testing.T) {
	type probe struct {
		name       string
		slot       string
		scope      string
		wantApply  bool
	}
	probes := []probe{
		// Universal applies everywhere.
		{"title", SlotStory, ScopeWork, true},
		{"title", "", ScopeStrategy, true},
		// Defect family.
		{"defect_severity", SlotDefect, ScopeWork, true},
		{"defect_severity", SlotStory, ScopeWork, false},
		{"defect_severity", "", ScopeStrategy, false},
		// Risk family.
		{"risk_impact", SlotRisk, ScopeWork, true},
		{"risk_impact", SlotStory, ScopeWork, false},
		// Task family.
		{"estimate_hours", SlotTask, ScopeWork, true},
		{"estimate_hours", SlotEpic, ScopeWork, false},
		// Submitted-by — defect OR risk.
		{"submitted_by_user_id", SlotDefect, ScopeWork, true},
		{"submitted_by_user_id", SlotRisk, ScopeWork, true},
		{"submitted_by_user_id", SlotStory, ScopeWork, false},
		// Strategy — scope-gated, slot is NULL for strategy types.
		{"strategic_job_size", "", ScopeStrategy, true},
		{"strategic_job_size", SlotStory, ScopeWork, false},
	}
	for _, p := range probes {
		spec, ok := CoreColumnSpecForName(p.name)
		if !ok {
			t.Fatalf("probe column %q not in catalogue", p.name)
		}
		if got := spec.AppliesToType(p.slot, p.scope); got != p.wantApply {
			t.Errorf("AppliesToType(%q, slot=%q, scope=%q) = %v, want %v",
				p.name, p.slot, p.scope, got, p.wantApply)
		}
	}
}
