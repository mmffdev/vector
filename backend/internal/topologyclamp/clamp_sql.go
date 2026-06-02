// Package topologyclamp adapts a Sentinel request clamp to consumer-owned
// topology-node SQL predicates. Sentinel owns the clamp; row-owning services
// decide which column should be narrowed by it.
package topologyclamp

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// SubtreeClause splices the per-request topology clamp into a SQL statement.
// topologyColumn must be a trusted SQL identifier/expression owned by the
// caller, for example "a.artefacts_id_topology_node".
//
// Returns:
//   - fragment: a SQL string starting with " AND " (or "" when no clamp
//     should be applied), ready to drop into an existing WHERE list.
//   - outArgs: the input args slice with the clamp's []uuid.UUID appended
//     (or unchanged when no clamp).
//   - nextIdx: the placeholder index the caller should use next.
//
// Behaviour follows sentinel.Clamp.SubtreeResolved's four-state contract:
// no middleware / deliberate bypass -> no-op; resolved empty -> fail closed;
// resolved non-empty -> topologyColumn = ANY($N::uuid[]).
func SubtreeClause(ctx context.Context, topologyColumn string, args []any, startIdx int) (fragment string, outArgs []any, nextIdx int) {
	c := sentinel.FromCtx(ctx)
	if !c.SubtreeResolved {
		return "", args, startIdx
	}
	if len(c.AllowedSubtreeIDs) == 0 {
		return " AND FALSE", args, startIdx
	}
	outArgs = append(args, c.AllowedSubtreeIDs)
	return fmt.Sprintf(" AND %s = ANY($%d::uuid[])", topologyColumn, startIdx), outArgs, startIdx + 1
}

// ApplyClampToIDs intersects a caller-supplied topology-node list with the
// Sentinel clamp's AllowedSubtreeIDs. Used when a caller resolves its own
// topology list and that list must narrow, never widen, the request clamp.
func ApplyClampToIDs(ctx context.Context, callerIDs []uuid.UUID) []uuid.UUID {
	c := sentinel.FromCtx(ctx)
	if !c.SubtreeResolved {
		return callerIDs
	}
	if len(c.AllowedSubtreeIDs) == 0 {
		return []uuid.UUID{}
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
