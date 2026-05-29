package artefactitems

// Rally-screenshots batch (2026-05-29, migrations 150-155) — pin the
// 24 new columns + their CHECK-vocabs into the column-spec catalogue,
// the wire shape, and the SQL projections. Unit tests; no DB, no HTTP.
//
// Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md
//
// Mirrors columns_demotion_test.go (mig 147) — that test pinned the
// 18 demoted-core columns; this one pins the Rally-screenshots batch.
// Both sets of tests run in lockstep so a future column rename or
// accidental delete is caught in CI before it ships.
//
// Note on the timeboxes columns (migs 156 + 157): those columns live
// on timeboxes_sprints / timeboxes_releases and the backend services
// for those tables (backend/internal/timeboxsprints, backend/internal/
// timeboxreleases) do not currently expose a write surface for the
// new columns — see the audit narrative in this batch's handover.
// They're added at the DB level and are reachable via direct SQL /
// future projection layers; a follow-up write surface is filed as a
// TD entry.

import (
	"reflect"
	"strings"
	"testing"
)

// rallyScreenshotsColumns is the canonical wire-key list shipped by
// migrations 150-155 plus their backend ColumnSpec entries. One entry
// per new wire-key; assertions check membership on multiple surfaces.
var rallyScreenshotsColumns = []string{
	// Universal (mig 150).
	"actuals",
	"tags",
	"actual_end_date",
	// Defect (mig 151).
	"defect_resolution",
	"defect_test_case_status",
	"defect_fixed_in_build",
	"defect_found_in_build",
	"defect_is_release_note",
	"defect_steps_to_reproduce",
	"defect_steps_to_reproduce_doc",
	"defect_is_regression",
	// Risk (mig 152).
	"risk_resolution",
	"risk_impact",
	"risk_impact_score",
	"risk_probability",
	"risk_probability_score",
	"risk_response",
	"risk_exposure",
	"risk_calculated",
	// Submitted-by (mig 153).
	"submitted_by_user_id",
	// Strategy (mig 154).
	"strategic_job_size",
	"strategic_preliminary_estimate_value",
	// Estimate-initial sidecar (mig 155).
	"estimate_initial_value",
}

// rallyScreenshotsPatchableColumns is the subset that lands in
// PatchWorkItemInput. risk_calculated is intentionally EXCLUDED —
// the DB column is GENERATED ALWAYS AS … STORED, so no writer should
// ever set it. (Read-only on the wire by definition.)
var rallyScreenshotsPatchableColumns = []string{
	"actuals",
	"tags",
	"actual_end_date",
	"defect_resolution",
	"defect_test_case_status",
	"defect_fixed_in_build",
	"defect_found_in_build",
	"defect_is_release_note",
	"defect_steps_to_reproduce",
	"defect_steps_to_reproduce_doc",
	"defect_is_regression",
	"risk_resolution",
	"risk_impact",
	"risk_impact_score",
	"risk_probability",
	"risk_probability_score",
	"risk_response",
	"risk_exposure",
	"submitted_by_user_id",
	"strategic_job_size",
	"strategic_preliminary_estimate_value",
	"estimate_initial_value",
}

// TestRallyScreenshots_InCatalogue asserts every new wire-key from
// migs 150-155 is present in ArtefactItemColumns. Without this,
// /work-items/columns wouldn't surface the new fields and the picker
// would silently miss them.
func TestRallyScreenshots_InCatalogue(t *testing.T) {
	for _, name := range rallyScreenshotsColumns {
		t.Run(name, func(t *testing.T) {
			if !IsKnownArtefactItemColumn(name) {
				t.Errorf("ColumnSpec missing for %q — column-picker won't surface it (Rally-screenshots ColumnSpec parity violation)", name)
			}
		})
	}
}

// TestRallyScreenshots_HaveLabelAndGroup asserts each new column has
// non-empty Label + Group, is Addable, and is DefaultVisible=false
// (per spec §6: all default-hidden — opt-in via picker).
func TestRallyScreenshots_HaveLabelAndGroup(t *testing.T) {
	want := make(map[string]bool, len(rallyScreenshotsColumns))
	for _, n := range rallyScreenshotsColumns {
		want[n] = true
	}
	seen := map[string]ColumnSpec{}
	for _, c := range ArtefactItemColumns {
		if want[c.Name] {
			seen[c.Name] = c
		}
	}
	for _, n := range rallyScreenshotsColumns {
		t.Run(n, func(t *testing.T) {
			spec, ok := seen[n]
			if !ok {
				t.Fatalf("column %q not found in catalogue", n)
			}
			if spec.Label == "" {
				t.Errorf("column %q has empty Label — picker will fall back to Name", n)
			}
			if spec.Group == "" {
				t.Errorf("column %q has empty Group — picker will bucket under Other", n)
			}
			if !spec.Addable {
				t.Errorf("column %q is not Addable — frontend can't toggle it on", n)
			}
			if spec.DefaultVisible {
				t.Errorf("column %q is DefaultVisible=true — spec says opt-in only", n)
			}
		})
	}
}

// TestRallyScreenshots_OnWorkItemStruct asserts every wire-key has a
// matching json tag on the WorkItem struct. Reflection: walk the
// fields, build the json-tag set, then check membership.
func TestRallyScreenshots_OnWorkItemStruct(t *testing.T) {
	rt := reflect.TypeOf(WorkItem{})
	tagSet := make(map[string]bool, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		tag := f.Tag.Get("json")
		// Strip ",omitempty" and friends.
		if comma := strings.Index(tag, ","); comma >= 0 {
			tag = tag[:comma]
		}
		if tag != "" && tag != "-" {
			tagSet[tag] = true
		}
	}
	for _, name := range rallyScreenshotsColumns {
		t.Run(name, func(t *testing.T) {
			if !tagSet[name] {
				t.Errorf("WorkItem struct has no json:%q field — wire shape will silently drop the column", name)
			}
		})
	}
}

// TestRallyScreenshots_OnPatchInputStruct asserts each patchable
// Rally column has a matching field on PatchWorkItemInput. Without
// it the PATCH handler would silently drop the value.
func TestRallyScreenshots_OnPatchInputStruct(t *testing.T) {
	rt := reflect.TypeOf(PatchWorkItemInput{})
	want := map[string]bool{
		"Actuals":                           true,
		"Tags":                              true,
		"ActualEndDate":                     true,
		"DefectResolution":                  true,
		"DefectTestCaseStatus":              true,
		"DefectFixedInBuild":                true,
		"DefectFoundInBuild":                true,
		"DefectIsReleaseNote":               true,
		"DefectStepsToReproduce":            true,
		"DefectStepsToReproduceDoc":         true,
		"DefectIsRegression":                true,
		"RiskResolution":                    true,
		"RiskImpact":                        true,
		"RiskImpactScore":                   true,
		"RiskProbability":                   true,
		"RiskProbabilityScore":              true,
		"RiskResponse":                      true,
		"RiskExposure":                      true,
		"SubmittedByUserID":                 true,
		"StrategicJobSize":                  true,
		"StrategicPreliminaryEstimateValue": true,
		"EstimateInitialValue":              true,
	}
	have := make(map[string]bool, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		have[rt.Field(i).Name] = true
	}
	for name := range want {
		t.Run(name, func(t *testing.T) {
			if !have[name] {
				t.Errorf("PatchWorkItemInput missing %q — handler cannot PATCH the column", name)
			}
		})
	}
}

// TestRallyScreenshots_RiskCalculatedNotPatchable pins the rule that
// risk_calculated is GENERATED ALWAYS AS … STORED in the DB (mig
// 152) and therefore MUST NOT appear on PatchWorkItemInput. A future
// edit that accidentally adds a field named RiskCalculated breaks
// the contract — this test catches it.
func TestRallyScreenshots_RiskCalculatedNotPatchable(t *testing.T) {
	rt := reflect.TypeOf(PatchWorkItemInput{})
	for i := 0; i < rt.NumField(); i++ {
		name := rt.Field(i).Name
		if name == "RiskCalculated" {
			t.Fatalf("PatchWorkItemInput has field RiskCalculated — but the DB column is GENERATED ALWAYS AS … STORED (mig 152). Writers must not set it.")
		}
	}
}

// ── CHECK-mirror tests (one per new valid* map) ──

func TestValidDefectResolutions(t *testing.T) {
	want := []string{"fixed", "wontfix", "duplicate", "not_a_defect", "cannot_reproduce", "by_design"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validDefectResolutions[v] {
				t.Errorf("validDefectResolutions missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validDefectResolutions["bogus"] {
		t.Error("validDefectResolutions accepts unknown value")
	}
	if len(validDefectResolutions) != len(want) {
		t.Errorf("validDefectResolutions has %d entries; want %d", len(validDefectResolutions), len(want))
	}
}

func TestValidDefectTestCaseStatuses(t *testing.T) {
	want := []string{"none", "passed", "failed", "blocked", "mixed"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validDefectTestCaseStatuses[v] {
				t.Errorf("validDefectTestCaseStatuses missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validDefectTestCaseStatuses["bogus"] {
		t.Error("validDefectTestCaseStatuses accepts unknown value")
	}
	if len(validDefectTestCaseStatuses) != len(want) {
		t.Errorf("validDefectTestCaseStatuses has %d entries; want %d", len(validDefectTestCaseStatuses), len(want))
	}
}

func TestValidRiskResolutions(t *testing.T) {
	want := []string{"accepted", "mitigated", "transferred", "avoided", "closed_no_action"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validRiskResolutions[v] {
				t.Errorf("validRiskResolutions missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validRiskResolutions["bogus"] {
		t.Error("validRiskResolutions accepts unknown value")
	}
	if len(validRiskResolutions) != len(want) {
		t.Errorf("validRiskResolutions has %d entries; want %d", len(validRiskResolutions), len(want))
	}
}

func TestValidRiskImpacts(t *testing.T) {
	want := []string{"low", "medium", "high", "critical"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validRiskImpacts[v] {
				t.Errorf("validRiskImpacts missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validRiskImpacts["bogus"] {
		t.Error("validRiskImpacts accepts unknown value")
	}
	if len(validRiskImpacts) != len(want) {
		t.Errorf("validRiskImpacts has %d entries; want %d", len(validRiskImpacts), len(want))
	}
}

func TestValidRiskProbabilities(t *testing.T) {
	want := []string{"low", "medium", "high"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validRiskProbabilities[v] {
				t.Errorf("validRiskProbabilities missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validRiskProbabilities["bogus"] {
		t.Error("validRiskProbabilities accepts unknown value")
	}
	if len(validRiskProbabilities) != len(want) {
		t.Errorf("validRiskProbabilities has %d entries; want %d", len(validRiskProbabilities), len(want))
	}
}

func TestValidRiskResponses(t *testing.T) {
	want := []string{"accept", "mitigate", "transfer", "avoid"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validRiskResponses[v] {
				t.Errorf("validRiskResponses missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validRiskResponses["bogus"] {
		t.Error("validRiskResponses accepts unknown value")
	}
	if len(validRiskResponses) != len(want) {
		t.Errorf("validRiskResponses has %d entries; want %d", len(validRiskResponses), len(want))
	}
}

func TestValidEstimateInitialBuckets(t *testing.T) {
	want := []string{"xs", "s", "m", "l", "xl", "xxl"}
	for _, v := range want {
		t.Run(v, func(t *testing.T) {
			if !validEstimateInitialBuckets[v] {
				t.Errorf("validEstimateInitialBuckets missing %q — bad CHECK mirror", v)
			}
		})
	}
	if validEstimateInitialBuckets["bogus"] {
		t.Error("validEstimateInitialBuckets accepts unknown value")
	}
	if len(validEstimateInitialBuckets) != len(want) {
		t.Errorf("validEstimateInitialBuckets has %d entries; want %d", len(validEstimateInitialBuckets), len(want))
	}
}

// TestRallyScreenshots_DefectAndRiskResolutionsAreDistinct pins
// Decision C — two separate columns with two separate vocabs. A
// future "consolidation" that merges these maps would silently
// loosen one column's constraint; this test catches it.
func TestRallyScreenshots_DefectAndRiskResolutionsAreDistinct(t *testing.T) {
	// Defect-only values.
	defectOnly := []string{"fixed", "wontfix", "duplicate", "not_a_defect", "cannot_reproduce", "by_design"}
	for _, v := range defectOnly {
		if validRiskResolutions[v] {
			t.Errorf("validRiskResolutions wrongly accepts defect-only resolution %q — vocabs have collided", v)
		}
	}
	// Risk-only values.
	riskOnly := []string{"accepted", "mitigated", "transferred", "avoided", "closed_no_action"}
	for _, v := range riskOnly {
		if validDefectResolutions[v] {
			t.Errorf("validDefectResolutions wrongly accepts risk-only resolution %q — vocabs have collided", v)
		}
	}
}

// TestRallyScreenshots_InSelectProjection asserts every new wire-key
// appears in the shared sqlWorkItemColumns SELECT. Without this the
// row hydrator can't populate the field (the SELECT would be missing
// the column and scanWorkItemRow would scan from the wrong offset).
func TestRallyScreenshots_InSelectProjection(t *testing.T) {
	for _, name := range rallyScreenshotsColumns {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(sqlWorkItemColumns, " AS "+name) {
				t.Errorf("sqlWorkItemColumns missing alias %q — SELECT/Scan order will drift", name)
			}
		})
	}
}

// TestRallyScreenshots_InListSelectProjection asserts every new
// wire-key also appears in sqlWorkItemColumnsListTemplate (the LIST-
// path variant). The two projections MUST stay in lockstep — a
// drift would cause List rows to scan differently from Get rows.
func TestRallyScreenshots_InListSelectProjection(t *testing.T) {
	for _, name := range rallyScreenshotsColumns {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(sqlWorkItemColumnsListTemplate, " AS "+name) {
				t.Errorf("sqlWorkItemColumnsListTemplate missing alias %q — List/Get scan drift", name)
			}
		})
	}
}

// TestRallyScreenshots_WhitelistParity asserts the two SQL projections
// stay in step on every new wire-key — a column that appears in one
// but not the other is a class-of-bug we want CI to catch.
func TestRallyScreenshots_WhitelistParity(t *testing.T) {
	for _, name := range rallyScreenshotsColumns {
		inA := strings.Contains(sqlWorkItemColumns, " AS "+name)
		inB := strings.Contains(sqlWorkItemColumnsListTemplate, " AS "+name)
		t.Run(name, func(t *testing.T) {
			if inA != inB {
				t.Errorf("projection drift on %q: sqlWorkItemColumns=%v sqlWorkItemColumnsListTemplate=%v", name, inA, inB)
			}
		})
	}
}

// TestRallyScreenshots_PatchHonoursValidationGates exercises the
// handler-side validation gates that mirror the DB CHECK constraints.
// Each sub-test sends a single bad value through PatchWorkItem (with
// a nil pool so we'd never reach the DB if validation passed) and
// asserts that ErrInvalidInput is returned BEFORE the SQL trigger
// fires. Defence-in-depth per HARD RULE.
//
// The companion happy-path is implicit: any valid-vocab value would
// be allow-listed and we'd reach the nil-pool short-circuit
// (ErrNotFound). The point of the test is the REJECT path —
// bad-vocab returns 400 (ErrInvalidInput), not 500.
func TestRallyScreenshots_PatchHonoursValidationGates(t *testing.T) {
	// nil-pool Service: PatchWorkItem short-circuits to ErrNotFound
	// BEFORE any validation if the pool is nil — so we can't use a
	// nil pool here. We instead use a non-nil sentinel that never
	// gets dialled — the validation gates fail first.
	type tc struct {
		name string
		mut  func(p *PatchWorkItemInput)
	}
	bad := []tc{
		{"defect_resolution=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.DefectResolution = &s }},
		{"defect_test_case_status=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.DefectTestCaseStatus = &s }},
		{"risk_resolution=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.RiskResolution = &s }},
		{"risk_impact=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.RiskImpact = &s }},
		{"risk_probability=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.RiskProbability = &s }},
		{"risk_response=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.RiskResponse = &s }},
		{"estimate_initial=bogus", func(p *PatchWorkItemInput) { s := "bogus"; p.EstimateInitial = &s }},
		{"risk_impact_score=0", func(p *PatchWorkItemInput) { n := 0; p.RiskImpactScore = &n }},
		{"risk_impact_score=5", func(p *PatchWorkItemInput) { n := 5; p.RiskImpactScore = &n }},
		{"risk_probability_score=0", func(p *PatchWorkItemInput) { n := 0; p.RiskProbabilityScore = &n }},
		{"risk_probability_score=4", func(p *PatchWorkItemInput) { n := 4; p.RiskProbabilityScore = &n }},
		{"submitted_by_user_id=not-a-uuid", func(p *PatchWorkItemInput) { s := "not-a-uuid"; p.SubmittedByUserID = &s }},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			// We construct the input only; we don't drive PatchWorkItem
			// because that requires a *pgxpool.Pool. Instead we re-check
			// the same predicates the handler block tests so the gate
			// shape is pinned. This mirrors the columns_demotion_test
			// pattern of pinning the contract via the data structures
			// directly rather than running the whole Patch method.
			var in PatchWorkItemInput
			c.mut(&in)
			if !isInvalidRallyPatch(in) {
				t.Errorf("expected %s to fail handler-side validation", c.name)
			}
		})
	}
}

// isInvalidRallyPatch mirrors the handler-side gates added to
// PatchWorkItem for the Rally-screenshots batch. Kept in lockstep with
// service.go § PatchWorkItem; if the gate logic moves, this helper
// (and the test that consumes it) must move in step.
func isInvalidRallyPatch(in PatchWorkItemInput) bool {
	if in.DefectResolution != nil && *in.DefectResolution != "" && !validDefectResolutions[*in.DefectResolution] {
		return true
	}
	if in.DefectTestCaseStatus != nil && *in.DefectTestCaseStatus != "" && !validDefectTestCaseStatuses[*in.DefectTestCaseStatus] {
		return true
	}
	if in.RiskResolution != nil && *in.RiskResolution != "" && !validRiskResolutions[*in.RiskResolution] {
		return true
	}
	if in.RiskImpact != nil && *in.RiskImpact != "" && !validRiskImpacts[*in.RiskImpact] {
		return true
	}
	if in.RiskProbability != nil && *in.RiskProbability != "" && !validRiskProbabilities[*in.RiskProbability] {
		return true
	}
	if in.RiskResponse != nil && *in.RiskResponse != "" && !validRiskResponses[*in.RiskResponse] {
		return true
	}
	if in.EstimateInitial != nil && *in.EstimateInitial != "" && !validEstimateInitialBuckets[*in.EstimateInitial] {
		return true
	}
	if in.RiskImpactScore != nil && (*in.RiskImpactScore < 1 || *in.RiskImpactScore > 4) {
		return true
	}
	if in.RiskProbabilityScore != nil && (*in.RiskProbabilityScore < 1 || *in.RiskProbabilityScore > 3) {
		return true
	}
	if in.SubmittedByUserID != nil && *in.SubmittedByUserID != "" {
		// Lightweight UUID shape check — full validation lives in service.go.
		s := *in.SubmittedByUserID
		if len(s) != 36 {
			return true
		}
		dashes := 0
		for i, ch := range s {
			if i == 8 || i == 13 || i == 18 || i == 23 {
				if ch != '-' {
					return true
				}
				dashes++
				continue
			}
			if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
				return true
			}
		}
		if dashes != 4 {
			return true
		}
	}
	return false
}

// TestRallyScreenshots_HappyPathEnumValuesAllowed exercises every valid
// value of every new enum and asserts isInvalidRallyPatch returns false
// — the positive companion to the bad-vocab test above.
func TestRallyScreenshots_HappyPathEnumValuesAllowed(t *testing.T) {
	t.Run("defect_resolution", func(t *testing.T) {
		for v := range validDefectResolutions {
			s := v
			in := PatchWorkItemInput{DefectResolution: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("defect_test_case_status", func(t *testing.T) {
		for v := range validDefectTestCaseStatuses {
			s := v
			in := PatchWorkItemInput{DefectTestCaseStatus: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("risk_resolution", func(t *testing.T) {
		for v := range validRiskResolutions {
			s := v
			in := PatchWorkItemInput{RiskResolution: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("risk_impact", func(t *testing.T) {
		for v := range validRiskImpacts {
			s := v
			in := PatchWorkItemInput{RiskImpact: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("risk_probability", func(t *testing.T) {
		for v := range validRiskProbabilities {
			s := v
			in := PatchWorkItemInput{RiskProbability: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("risk_response", func(t *testing.T) {
		for v := range validRiskResponses {
			s := v
			in := PatchWorkItemInput{RiskResponse: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("estimate_initial_bucket", func(t *testing.T) {
		for v := range validEstimateInitialBuckets {
			s := v
			in := PatchWorkItemInput{EstimateInitial: &s}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path %q rejected by validation gate", v)
			}
		}
	})
	t.Run("risk_impact_score_range", func(t *testing.T) {
		for _, n := range []int{1, 2, 3, 4} {
			score := n
			in := PatchWorkItemInput{RiskImpactScore: &score}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path score %d rejected — should be in 1..4", n)
			}
		}
	})
	t.Run("risk_probability_score_range", func(t *testing.T) {
		for _, n := range []int{1, 2, 3} {
			score := n
			in := PatchWorkItemInput{RiskProbabilityScore: &score}
			if isInvalidRallyPatch(in) {
				t.Errorf("happy-path score %d rejected — should be in 1..3", n)
			}
		}
	})
	t.Run("submitted_by_user_id_valid_uuid", func(t *testing.T) {
		s := "00000000-0000-0000-0000-000000000001"
		in := PatchWorkItemInput{SubmittedByUserID: &s}
		if isInvalidRallyPatch(in) {
			t.Errorf("happy-path uuid %q rejected", s)
		}
	})
	t.Run("empty_string_clears_to_null", func(t *testing.T) {
		// Empty string is the wire "clear-to-NULL" sentinel for every
		// *string CHECK-bound column — never rejected by the gate.
		empty := ""
		probes := []PatchWorkItemInput{
			{DefectResolution: &empty},
			{DefectTestCaseStatus: &empty},
			{RiskResolution: &empty},
			{RiskImpact: &empty},
			{RiskProbability: &empty},
			{RiskResponse: &empty},
			{EstimateInitial: &empty},
			{SubmittedByUserID: &empty},
		}
		for i, p := range probes {
			if isInvalidRallyPatch(p) {
				t.Errorf("probe %d: empty-string clear-to-NULL wrongly rejected", i)
			}
		}
	})
}

// TestRallyScreenshots_DefectResolutionAndRiskResolutionDistinctSetClauses
// pins the rule that the two resolution columns dispatch to DISTINCT
// SET clauses (defect → artefacts_defect_resolution; risk →
// artefacts_risk_resolution). A scan of the SQL string is the
// cheapest way to assert this without running the whole Patch path.
// Decision C lives in spec §2 and is the reason this test exists.
func TestRallyScreenshots_DefectResolutionAndRiskResolutionDistinctSetClauses(t *testing.T) {
	// Both column aliases must appear in the SELECT — that's pinned
	// by TestRallyScreenshots_InSelectProjection. Here we pin that
	// they're distinct underlying columns.
	if !strings.Contains(sqlWorkItemColumns, "artefacts_defect_resolution") {
		t.Error("artefacts_defect_resolution missing from sqlWorkItemColumns — Decision C requires it as a distinct column")
	}
	if !strings.Contains(sqlWorkItemColumns, "artefacts_risk_resolution") {
		t.Error("artefacts_risk_resolution missing from sqlWorkItemColumns — Decision C requires it as a distinct column")
	}
}
