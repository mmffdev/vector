// Package devtools is a dev-environment-only framework for running scoped
// maintenance actions against vector_artefacts. It is NOT product code: every
// entry point is gated behind a fail-closed BACKEND_ENV check (see env.go) and
// mounted under the existing /_site/admin/dev/* route group, which is already
// permission-gated.
//
// The framework has two halves:
//
//  1. A reusable SCOPE RESOLVER (this file) — a cascading
//     Subscription → Workspace → Topology Node → Artefact Type selector that
//     resolves to a SQL predicate over the `artefacts` table. Any level may be
//     omitted; an omitted level means "everything below". The resolved
//     predicate is consumed by ACTIONS.
//
//  2. An ACTION set (flow_reseed.go, fixture_cleanup.go) — operations that run
//     against the resolved scope. The first two actions are flow reseed and
//     fixture cleanup, but the scope resolver is deliberately generic so future
//     actions (delete-by-criteria, seed-into-criteria, state resets) plug in
//     without reworking the targeting layer.
//
// Everything is dev-tooling: hard deletes, no audit trail, single-transaction,
// backup-first. The owner triggers these from the Dev Setup page.
package devtools

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Scope is the resolved target of an action. Each field is optional; a nil
// field widens the scope one level. The cascade is strictly nested — a
// WorkspaceID without a SubscriptionID is meaningless and rejected by Validate,
// because the UI always picks top-down.
//
//	SubscriptionID == nil → every subscription (whole tenant DB)
//	WorkspaceID    == nil → every workspace in the chosen subscription
//	TopologyNodeID == nil → every node in the chosen workspace
//	ArtefactTypeID == nil → every artefact type in the chosen node
type Scope struct {
	SubscriptionID *uuid.UUID `json:"subscription_id"`
	WorkspaceID    *uuid.UUID `json:"workspace_id"`
	TopologyNodeID *uuid.UUID `json:"topology_node_id"`
	ArtefactTypeID *uuid.UUID `json:"artefact_type_id"`
}

// Validate enforces the nested cascade: a narrower level cannot be set without
// every wider level also set. This mirrors the UI's top-down dropdown flow and
// prevents an ambiguous predicate (e.g. "this workspace across all
// subscriptions") that would silently cross tenant boundaries.
func (s Scope) Validate() error {
	if s.WorkspaceID != nil && s.SubscriptionID == nil {
		return fmt.Errorf("workspace_id set without subscription_id")
	}
	if s.TopologyNodeID != nil && s.WorkspaceID == nil {
		return fmt.Errorf("topology_node_id set without workspace_id")
	}
	if s.ArtefactTypeID != nil && s.WorkspaceID == nil {
		return fmt.Errorf("artefact_type_id set without workspace_id")
	}
	return nil
}

// IsWholeTenant reports whether the scope targets the entire DB (no level set).
// Actions surface this in their confirm copy so the operator sees the true
// blast radius before running an unscoped operation.
func (s Scope) IsWholeTenant() bool {
	return s.SubscriptionID == nil && s.WorkspaceID == nil &&
		s.TopologyNodeID == nil && s.ArtefactTypeID == nil
}

// ArtefactPredicate builds a WHERE fragment + ordered args that select the
// `artefacts` rows in this scope. The fragment is written against an `a` alias
// (callers must alias the artefacts table as `a`). startArg is the 1-based
// index of the first placeholder ($N) to emit, so the caller can splice the
// fragment into a larger statement that already consumes earlier placeholders.
//
// The returned fragment is always a non-empty boolean expression (it falls back
// to "TRUE" when the scope is whole-tenant) so it can be dropped into
// "WHERE <frag>" or "AND (<frag>)" unconditionally. Live-only filtering
// (archived_at IS NULL) is the caller's choice and is NOT baked in here.
func (s Scope) ArtefactPredicate(startArg int) (frag string, args []any) {
	var clauses []string
	n := startArg
	if s.SubscriptionID != nil {
		clauses = append(clauses, fmt.Sprintf("a.artefacts_id_subscription = $%d", n))
		args = append(args, *s.SubscriptionID)
		n++
	}
	if s.WorkspaceID != nil {
		clauses = append(clauses, fmt.Sprintf("a.artefacts_id_workspace = $%d", n))
		args = append(args, *s.WorkspaceID)
		n++
	}
	if s.TopologyNodeID != nil {
		clauses = append(clauses, fmt.Sprintf("a.artefacts_id_topology_node = $%d", n))
		args = append(args, *s.TopologyNodeID)
		n++
	}
	if s.ArtefactTypeID != nil {
		clauses = append(clauses, fmt.Sprintf("a.artefacts_id_artefact_type = $%d", n))
		args = append(args, *s.ArtefactTypeID)
		n++
	}
	if len(clauses) == 0 {
		return "TRUE", nil
	}
	return strings.Join(clauses, " AND "), args
}

// FlowPredicate builds a WHERE fragment + args that select the `flows` rows in
// this scope, aliased as `f`. Flows are scoped only by artefact type (flows
// belong to a type, not directly to a workspace/node), so the workspace and
// node levels are resolved by joining through the type's workspace. To keep the
// fragment self-contained, only the two levels that flows can be filtered by
// directly — subscription (via the type) and the explicit type id — are
// emitted here; workspace/node narrowing for flows is applied by the action via
// a type-id subquery (see flow_reseed.go scopedTypeIDs).
func (s Scope) FlowPredicate(startArg int, typeIDs []uuid.UUID) (frag string, args []any) {
	// Flows are always resolved through the explicit set of in-scope type IDs
	// the action computed (so workspace/node narrowing is already applied).
	if len(typeIDs) == 0 {
		return "FALSE", nil // empty scope → match nothing, fail-closed
	}
	placeholders := make([]string, len(typeIDs))
	for i, id := range typeIDs {
		placeholders[i] = fmt.Sprintf("$%d", startArg+i)
		args = append(args, id)
	}
	return fmt.Sprintf("f.flows_id_artefact_type IN (%s)", strings.Join(placeholders, ", ")), args
}
