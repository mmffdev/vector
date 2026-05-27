// Package flowboard SQL constants.
//
// Every SQL string literal used by the flowboard package lives here as a
// named constant. Service methods reference these constants; they do NOT
// embed raw SQL inline.
//
// Naming: sqlVerbResource — e.g. sqlSelectWipLimitsByNode,
// sqlUpsertWipLimit. Matches the topology / artefactitems convention.
//
// Constants are intentionally empty strings at scaffold time. They will
// be filled in by the implementing stories (FB1.2.2 / FB1.2.3 / FB1.2.4).
package flowboard

const (
	// sqlSelectWipLimitsByNode — FB1.2.2 (GET /_site/flowboard/wip).
	// Returns all WIP-limit rows for a given topology node, joined to the
	// flow-state so the handler can return (flow_state_id, name, limit) tuples.
	// Sentinel-clamped: topology_nodes_wip_limits_workspace_id = $2.
	//
	// Parameters: $1 = node_id (uuid), $2 = workspace_id (uuid)
	sqlSelectWipLimitsByNode = `
		SELECT
			w.topology_nodes_wip_limits_flow_state_id,
			fs.flows_states_name,
			w.topology_nodes_wip_limits_limit,
			w.topology_nodes_wip_limits_updated_at,
			w.topology_nodes_wip_limits_updated_by
		FROM topology_nodes_wip_limits w
		JOIN flows_states fs
		  ON fs.flows_states_id = w.topology_nodes_wip_limits_flow_state_id
		WHERE w.topology_nodes_wip_limits_node_id    = $1
		  AND w.topology_nodes_wip_limits_workspace_id = $2
		ORDER BY fs.flows_states_sort_order ASC`

	// sqlUpsertWipLimit — FB1.2.2 (PUT /_site/flowboard/wip).
	// UPSERT on the unique constraint (topology_nodes_wip_limits_node_id,
	// topology_nodes_wip_limits_flow_state_id). Sets the limit value and
	// bumps topology_nodes_wip_limits_updated_at + _updated_by on every
	// write. Returns the full resulting row so the handler can echo it.
	//
	// Parameters:
	//   $1 = node_id (uuid)
	//   $2 = flow_state_id (uuid)
	//   $3 = limit (int or NULL)
	//   $4 = workspace_id (uuid)
	//   $5 = updated_by / caller user_id (uuid)
	sqlUpsertWipLimit = `
		INSERT INTO topology_nodes_wip_limits (
			topology_nodes_wip_limits_node_id,
			topology_nodes_wip_limits_flow_state_id,
			topology_nodes_wip_limits_limit,
			topology_nodes_wip_limits_workspace_id,
			topology_nodes_wip_limits_updated_at,
			topology_nodes_wip_limits_updated_by
		) VALUES ($1, $2, $3, $4, now(), $5)
		ON CONFLICT ON CONSTRAINT topology_nodes_wip_limits_node_state_uq
		DO UPDATE SET
			topology_nodes_wip_limits_limit      = EXCLUDED.topology_nodes_wip_limits_limit,
			topology_nodes_wip_limits_updated_at = now(),
			topology_nodes_wip_limits_updated_by = EXCLUDED.topology_nodes_wip_limits_updated_by
		RETURNING
			topology_nodes_wip_limits_flow_state_id,
			topology_nodes_wip_limits_limit,
			topology_nodes_wip_limits_updated_at,
			topology_nodes_wip_limits_updated_by`

	// sqlCheckMembership — FB1.2.2 (PUT /_site/flowboard/wip membership gate).
	// Returns one row when the user is a member of the given topology node
	// within the workspace (sentinel-clamped). Returns zero rows when not.
	//
	// Parameters: $1 = node_id (uuid), $2 = user_id (uuid)
	sqlCheckMembership = `
		SELECT 1
		FROM topology_nodes_members
		WHERE topology_nodes_members_node_id = $1
		  AND topology_nodes_members_user_id = $2
		LIMIT 1`

	// sqlSelectCardPrefs — FB1.2.3 (GET /_site/flowboard/prefs).
	// Returns the users_flowboard_prefs row for (user_id, artefact_type_id).
	// When no row exists the handler returns the sidecar default fields list.
	sqlSelectCardPrefs = ``

	// sqlUpsertCardPrefs — FB1.2.3 (PUT /_site/flowboard/prefs).
	// UPSERT on (users_flowboard_prefs_user_id,
	// users_flowboard_prefs_artefact_type_id); writes the card_fields JSONB
	// column and bumps users_flowboard_prefs_updated_at.
	sqlUpsertCardPrefs = ``

	// sqlSelectNodeWorkspace — FB1.2.2 (GET workspace-scope gate).
	// Returns the workspace that owns the given topology node.
	// Used by listWipLimits to enforce cross-scope 403 before the main query.
	//
	// Parameters: $1 = node_id (uuid)
	sqlSelectNodeWorkspace = `
		SELECT topology_nodes_id_workspace
		FROM topology_nodes
		WHERE topology_nodes_id = $1`

	// sqlSelectNodeMembers — FB1.2.4 (GET /_site/topology/{id}/members).
	// Lists topology_nodes_members rows for a given node_id, sentinel-clamped
	// by workspace_id.
	sqlSelectNodeMembers = ``
)
