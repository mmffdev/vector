package topology

import (
	"context"
	"fmt"

	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// workspaceClause + workspaceClauseAt are the SQL-splicing helpers that
// service.go and commands.go use to apply the workspace clamp inside
// list queries. They were lifted out of the deleted middleware.go on
// 2026-05-24 (PLA062 S25); the only behavioural change is the
// workspace-id source — it now reads from `sentinel.WorkspaceIDFromCtx`
// instead of the topology-package-internal `WorkspaceIDFromCtx`.
//
// Both helpers return ("", args, 0) when no clamp is set on the
// request context — callers treat that as "no clamp" and fall back to
// subscription-only scoping.

// workspaceClause returns the SQL fragment that filters by the active
// workspace_id, plus the appended args slice and the parameter slot.
//
// Usage: extend the existing args list with `args` and splice `clause`
// into the WHERE list; subsequent multi-alias references should call
// workspaceClauseAt(alias, slot) so the same parameter is reused.
func workspaceClause(ctx context.Context, alias string, args []any) (clause string, out []any, slot int) {
	wsID, ok := sentinel.WorkspaceIDFromCtx(ctx)
	if !ok {
		return "", args, 0
	}
	args = append(args, wsID)
	slot = len(args)
	return fmt.Sprintf(" AND %s.topology_nodes_id_workspace = $%d", alias, slot), args, slot
}

// workspaceClauseAt returns the same fragment workspaceClause produces
// but reuses an already-bound parameter slot — used by multi-alias
// queries (e.g. the Subtree recursive CTE) where every alias points
// at the same workspace_id and adding the param multiple times would
// be wasteful.
//
// When slot == 0 the clamp is disabled (workspaceClause returned a
// zero slot), so the fragment is empty.
func workspaceClauseAt(alias string, slot int) string {
	if slot == 0 {
		return ""
	}
	return fmt.Sprintf(" AND %s.topology_nodes_id_workspace = $%d", alias, slot)
}

// itoa avoids importing strconv just for line-number formatting in
// debug log messages. Lifted from the deleted sql_helpers.go.
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
