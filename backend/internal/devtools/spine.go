package devtools

// Canonical flow spine — the authoritative default workflow definition that the
// reseed action writes into flows_states_defaults / flows_transitions_defaults
// and propagates into every in-scope flow.
//
// This is intentionally defined in Go rather than read from the live snapshot
// table, because the snapshot table is itself part of what the reseed REBUILDS
// (the live snapshot was found contaminated: e.g. a Risk default flow with only
// 4 states, an "Accpeted" typo, kind mismatches). The Go constant is the clean
// source of record; the snapshot is a materialised cache of it.
//
// Two spines:
//   - spineStandard: the 5-state Backlog→To Do→Doing→Completed→Accepted spine
//     used by every standard product type.
//   - spineTask: the 3-state To Do→Doing→Completed spine (Task has no Backlog
//     and no Accepted — it starts at To Do and terminates at Completed).
//
// Transitions are adjacent-bidirectional: each state links to its immediate
// neighbour in both directions (matching the live canonical graph: 8 edges for
// the 5-state spine, 4 for the 3-state spine).

// SpineState is one pill in a canonical spine.
type SpineState struct {
	Name       string
	Kind       string // backlog | todo | in_progress | done | accepted | cancelled
	SortOrder  int
	IsInitial  bool
	IsPullable bool
}

// SpineDef is a complete canonical flow: its ordered states. Transitions are
// derived (adjacent-bidirectional) so they never drift from the state list.
type SpineDef struct {
	States []SpineState
}

// AdjacentTransitions returns the adjacent-bidirectional edge list for the
// spine as (fromIdx, toIdx) pairs over States. For states [A,B,C] it yields
// A↔B and B↔C (4 directed edges).
func (d SpineDef) AdjacentTransitions() [][2]int {
	var edges [][2]int
	for i := 0; i+1 < len(d.States); i++ {
		edges = append(edges, [2]int{i, i + 1}) // forward
		edges = append(edges, [2]int{i + 1, i}) // back
	}
	return edges
}

// spineStandard — the 5-state spine for all standard product types.
var spineStandard = SpineDef{States: []SpineState{
	{Name: "Backlog", Kind: "backlog", SortOrder: 10, IsInitial: true},
	{Name: "To Do", Kind: "todo", SortOrder: 20, IsPullable: true},
	{Name: "Doing", Kind: "in_progress", SortOrder: 30},
	{Name: "Completed", Kind: "done", SortOrder: 40},
	{Name: "Accepted", Kind: "accepted", SortOrder: 50},
}}

// spineTask — the 3-state spine for the Task type.
var spineTask = SpineDef{States: []SpineState{
	{Name: "To Do", Kind: "todo", SortOrder: 10, IsInitial: true},
	{Name: "Doing", Kind: "in_progress", SortOrder: 20},
	{Name: "Completed", Kind: "done", SortOrder: 30},
}}

// canonicalTypeNames is the closed set of artefact-type NAMES the reseed action
// rebuilds. A type outside this set is left entirely untouched — this is how
// Risk/Defect SECONDARY spines (and any bespoke workflow) are preserved: only
// the primary spine of these named standard types is reseeded.
//
// "Task" maps to spineTask; every other entry maps to spineStandard. The map is
// keyed by name (not id) because ids differ per subscription, but the canonical
// product types share names across the tenant.
var canonicalSpineByTypeName = map[string]SpineDef{
	"Story":               spineStandard,
	"Epic":                spineStandard,
	"Feature":             spineStandard,
	"Defect":              spineStandard,
	"Business Epic":       spineStandard,
	"Business Outcome":    spineStandard,
	"Business Objective":  spineStandard,
	"Portfolio Objective": spineStandard,
	"Strategic Objective": spineStandard,
	"Task":                spineTask,
}

// SpineForTypeName returns the canonical spine for a type name and whether the
// type is in the reseed set at all.
func SpineForTypeName(name string) (SpineDef, bool) {
	d, ok := canonicalSpineByTypeName[name]
	return d, ok
}
