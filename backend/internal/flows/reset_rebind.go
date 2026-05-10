package flows

import "sort"

// pillRow is the minimal shape pickSuccessor needs.
type pillRow struct {
	ID        string
	Name      string
	SortOrder int
	Survives  bool // true if the live pill is also in the snapshot (matched by name+kind)
}

// pickSuccessor implements the deterministic walk-back rule for rebinding
// artefacts that sit on a removed state.
//
// Rule (in priority order):
//  1. Highest sort_order strictly LESS than the removed pill's sort_order
//     among pills that survive.
//  2. If none, lowest sort_order strictly GREATER than the removed pill's
//     sort_order among pills that survive.
//
// Returns ("", "") if no surviving pill exists at all (caller should refuse
// the reset in that case — there is nowhere to rebind to).
func pickSuccessor(removed pillRow, all []pillRow) (id string, name string) {
	sort.Slice(all, func(i, j int) bool { return all[i].SortOrder < all[j].SortOrder })

	// Walk backwards (lower sort_order) for a survivor.
	for i := len(all) - 1; i >= 0; i-- {
		p := all[i]
		if !p.Survives {
			continue
		}
		if p.SortOrder < removed.SortOrder {
			return p.ID, p.Name
		}
	}
	// Fallback: forwards (higher sort_order).
	for _, p := range all {
		if !p.Survives {
			continue
		}
		if p.SortOrder > removed.SortOrder {
			return p.ID, p.Name
		}
	}
	return "", ""
}
