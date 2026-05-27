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
	// flow-state so the handler can return (flow_state_id, limit) pairs.
	sqlSelectWipLimitsByNode = ``

	// sqlUpsertWipLimit — FB1.2.2 (PUT /_site/flowboard/wip).
	// UPSERT on (topology_nodes_wip_limits_node_id,
	// topology_nodes_wip_limits_flow_state_id); sets the limit value and
	// bumps topology_nodes_wip_limits_updated_at / _updated_by.
	sqlUpsertWipLimit = ``

	// sqlSelectCardPrefs — FB1.2.3 (GET /_site/flowboard/prefs).
	// Returns the users_flowboard_prefs row for (user_id, artefact_type_id).
	// When no row exists the handler returns the sidecar default fields list.
	sqlSelectCardPrefs = ``

	// sqlUpsertCardPrefs — FB1.2.3 (PUT /_site/flowboard/prefs).
	// UPSERT on (users_flowboard_prefs_user_id,
	// users_flowboard_prefs_artefact_type_id); writes the card_fields JSONB
	// column and bumps users_flowboard_prefs_updated_at.
	sqlUpsertCardPrefs = ``

	// sqlSelectNodeMembers — FB1.2.4 (GET /_site/topology/{id}/members).
	// Lists topology_nodes_members rows for a given node_id, sentinel-clamped
	// by workspace_id.
	sqlSelectNodeMembers = ``
)
