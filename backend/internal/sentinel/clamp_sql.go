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
// Behaviour:
//
//   - When the Sentinel middleware did not attach a Clamp (unscoped /
//     admin path), returns ("", args, startIdx) — handlers fall back to
//     their pre-existing scoping (subscription-only).
//   - When the Clamp.AllowedSubtreeIDs slice is empty (theoretical edge;
//     middleware always populates at least the focus itself), behaves
//     the same as no-clamp so a handler doesn't accidentally pass an
//     empty UUID[] to pgx and get "= ANY('{}')" → zero rows.
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
	if len(c.AllowedSubtreeIDs) == 0 {
		return "", args, startIdx
	}
	outArgs = append(args, c.AllowedSubtreeIDs)
	return fmt.Sprintf(" AND %s.artefacts_id_topology_node = ANY($%d::uuid[])", alias, startIdx), outArgs, startIdx + 1
}

// ApplyClampToIDs intersects a caller-supplied subtree list with the
// Sentinel clamp's AllowedSubtreeIDs. Used by the legacy `?scope=<id>`
// code path that resolved its own list of node IDs — that list now
// gets narrowed to the intersection with the Sentinel clamp so a
// hostile caller can't widen scope by passing `?scope=<ancestor>`.
//
// Returns the intersection. When the clamp is absent (unscoped /
// admin), returns the caller's list unchanged. When the caller's list
// is nil, returns the clamp's list unchanged.
//
// Both lists are treated as sets — duplicates and order are not
// preserved in the result.
func ApplyClampToIDs(ctx context.Context, callerIDs []uuid.UUID) []uuid.UUID {
	c := FromCtx(ctx)
	if len(c.AllowedSubtreeIDs) == 0 {
		return callerIDs
	}
	if len(callerIDs) == 0 {
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
