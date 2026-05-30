package sentinel

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// SubtreeClause splices the per-request subtree clamp into a list/get
// SQL statement. Returns:
//
//   - fragment: a SQL string starting with " AND " (or "" when no clamp
//     should be applied), ready to drop into an existing WHERE list.
//   - outArgs:  the input args slice with the clamp's []uuid.UUID
//     appended (or unchanged when no clamp).
//   - nextIdx:  the placeholder index the caller should use for its
//     next $N argument.
//
// Usage pattern:
//
//	args := []any{subscriptionID, scope}
//	clauseClamp, args, n := sentinel.SubtreeClause(ctx, "a", args, 3)
//	// n is now the next placeholder, e.g. $4 if the clamp bound $3.
//	sql := baseSQL + clauseClamp + extraWHERE
//
// Behaviour — there are FOUR distinct states, gated by SubtreeResolved
// (set true only by Middleware Step 7) and len(AllowedSubtreeIDs):
//
//   - State 1 — NO MIDDLEWARE (unscoped / admin / dev path): FromCtx
//     returns a zero-value Clamp (SubtreeResolved == false). Returns
//     ("", args, startIdx) — handlers fall back to their pre-existing
//     scoping (subscription-only). Intentional.
//   - State 2 — MIDDLEWARE RAN, resolved >=1 node (normal authenticated
//     request): emits " AND <alias>.artefacts_id_topology_node =
//     ANY($N::uuid[])" binding the allowed set.
//   - State 3 — MIDDLEWARE RAN but resolved an EMPTY set
//     (SubtreeResolved == true, len == 0): fail CLOSED. Returns
//     (" AND FALSE", args, startIdx) so the query matches zero rows,
//     NOT subscription-wide. This is unreachable today (middleware always
//     seeds at least the focus node) but is made safe by construction so
//     a future middleware regression cannot silently leak the whole
//     subscription. This replaces the old behaviour, which treated empty
//     the same as no-clamp and was fail-OPEN.
//   - State 4 — DELIBERATE BYPASS via WithBypassedSubtreeClamp
//     (SubtreeResolved == false, AllowedSubtreeIDs == nil): treated
//     identically to State 1 — returns ("", ...). Used on the post-write
//     read where the actor was already authorised by the write and the
//     row may have moved out of the entry-time focus subtree.
//
//   - The fragment is column-prefixed: pass the alias the table is
//     joined under in the SQL (e.g. "a" for artefacts). The column
//     name is hard-coded to `artefacts_id_topology_node` per the
//     project's convention — every artefact-bearing table pins to
//     this column. Post-RF1.5.7 column-prefix sweep — the column is
//     fully prefixed `<table>_id_<target>`.
//   - NULL `artefacts_id_topology_node` rows are EXCLUDED. This
//     matches the legacy `?scope=` behaviour: un-pinned artefacts
//     are orphans, visible only on unscoped reads (admin / sweep /
//     migration tools). Procurement story: a clamped read MUST NOT
//     surface un-pinned data either; if a user can't see the node,
//     they can't see the row.
//
// PLA062 / S26.
func SubtreeClause(ctx context.Context, alias string, args []any, startIdx int) (fragment string, outArgs []any, nextIdx int) {
	c := FromCtx(ctx)
	if !c.SubtreeResolved {
		// State 1 (no middleware) or State 4 (deliberate bypass): no clause.
		return "", args, startIdx
	}
	if len(c.AllowedSubtreeIDs) == 0 {
		// State 3: middleware resolved an empty set — fail CLOSED, not open.
		return " AND FALSE", args, startIdx
	}
	// State 2: normal subtree narrowing.
	outArgs = append(args, c.AllowedSubtreeIDs)
	return fmt.Sprintf(" AND %s.artefacts_id_topology_node = ANY($%d::uuid[])", alias, startIdx), outArgs, startIdx + 1
}

// ApplyClampToIDs intersects a caller-supplied subtree list with the
// Sentinel clamp's AllowedSubtreeIDs. Used by the legacy `?scope=<id>`
// code path that resolved its own list of node IDs — that list now
// gets narrowed to the intersection with the Sentinel clamp so a
// hostile caller can't widen scope by passing `?scope=<ancestor>`.
//
// Mirrors SubtreeClause's four-state contract:
//
//   - State 1 (no middleware) / State 4 (deliberate bypass):
//     SubtreeResolved == false — returns the caller's list unchanged.
//   - State 3 (middleware resolved an empty set): SubtreeResolved == true
//     && len(AllowedSubtreeIDs) == 0 — returns an EMPTY slice, NOT the
//     caller's list. Intersection with an empty allowed-set is empty;
//     this fails CLOSED rather than passing the caller's list through.
//   - State 2 (resolved >=1 node): returns the intersection. When the
//     caller's list is nil/empty in this state, returns the clamp's list
//     unchanged (the clamp IS the narrowing).
//
// Both lists are treated as sets — duplicates and order are not
// preserved in the result.
func ApplyClampToIDs(ctx context.Context, callerIDs []uuid.UUID) []uuid.UUID {
	c := FromCtx(ctx)
	if !c.SubtreeResolved {
		// State 1 / State 4: no clamp narrowing — passthrough.
		return callerIDs
	}
	if len(c.AllowedSubtreeIDs) == 0 {
		// State 3: empty allowed-set — intersection is empty. Fail CLOSED.
		return []uuid.UUID{}
	}
	if len(callerIDs) == 0 {
		// State 2 with no caller list — the clamp is the narrowing.
		return c.AllowedSubtreeIDs
	}
	allowed := make(map[uuid.UUID]struct{}, len(c.AllowedSubtreeIDs))
	for _, id := range c.AllowedSubtreeIDs {
		allowed[id] = struct{}{}
	}
	out := make([]uuid.UUID, 0, len(callerIDs))
	for _, id := range callerIDs {
		if _, ok := allowed[id]; ok {
			out = append(out, id)
		}
	}
	return out
}
