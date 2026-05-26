// Package workspaceresolver derives a user's active workspace_id from
// the database when the JWT does not carry the claim — used by
// auth.Refresh + auth.refreshFromSuccessor between FindUserByID and
// SignAccessToken so the re-minted access token preserves the user's
// picked workspace across refresh instead of silently reverting to
// the tenant's earliest workspace via the sentinel fallback.
//
// Cross-pool design:
//   - users.default_focus_node_id lives in mmff_vector (mvPool)
//   - topology_nodes.workspace_id lives in vector_artefacts (vaPool)
//   - users_roles_workspaces lives in mmff_vector (mvPool)
//
// Postgres cannot FK across databases, so the derivation runs two
// queries instead of one JOIN. The package lives outside auth so
// auth doesn't grow a vaPool field; auth depends on a small
// WorkspaceResolver interface (defined in auth/service.go) and main.go
// injects the concrete PoolResolver from this package at boot.
package workspaceresolver

// sqlWorkspaceForFocusNode returns the workspace_id of the given live
// topology node, gated by tenant. $1 = focusNodeID, $2 = tenantID.
// Returns ErrNoRows when the node is archived, in another tenant, or
// has been deleted between the JWT being signed and now.
//
// topology_nodes.workspace_id is NOT NULL (vector_artefacts schema),
// so a successful return guarantees a non-nil uuid.
const sqlWorkspaceForFocusNode = `
	SELECT topology_nodes_id_workspace
	  FROM topology_nodes
	 WHERE topology_nodes_id = $1
	   AND topology_nodes_id_subscription = $2
	   AND topology_nodes_archived_at IS NULL
	 LIMIT 1
`

// sqlFirstGrantedWorkspace returns the earliest-created live workspace
// in the tenant that the user holds an active grant on. $1 = userID,
// $2 = tenantID. Returns ErrNoRows when the user has zero active grants
// in the tenant (they have no business in this tenant any more — the
// caller leaves WorkspaceID == uuid.Nil and the JWT signs without the
// claim; sentinel.Middleware will 403 no-workspace on the next request,
// which is correct).
//
// Predicate mirrors the tightened sentinel.sqlFirstLiveWorkspace so a
// single source of truth governs "which workspaces can this user see".
const sqlFirstGrantedWorkspace = `
	SELECT mw.id
	  FROM master_record_workspaces mw
	  JOIN users_roles_workspaces urw
	    ON urw.users_roles_workspaces_id_workspace = mw.id
	   AND urw.users_roles_workspaces_id_user = $1
	   AND urw.users_roles_workspaces_revoked_at IS NULL
	 WHERE mw.subscription_id = $2
	   AND mw.archived_at IS NULL
	 ORDER BY mw.created_at ASC
	 LIMIT 1
`

// sqlUserHasActiveGrantOnWorkspace returns TRUE when the user holds
// an active grant on the workspace. $1 = userID, $2 = workspaceID.
//
// Mirrors sentinel.sqlExistsActiveWorkspaceRole exactly — same predicate,
// different parameter order to match the WorkspaceResolver method
// signature (userID first, workspace second, since callers usually
// have userID in hand from the JWT and workspace from the derivation).
const sqlUserHasActiveGrantOnWorkspace = `
	SELECT EXISTS (
	    SELECT 1
	      FROM users_roles_workspaces
	     WHERE users_roles_workspaces_id_user = $1
	       AND users_roles_workspaces_id_workspace = $2
	       AND users_roles_workspaces_revoked_at IS NULL
	)
`
