package artefacttypes

// sqlInsertDefaultWorkspaceType inserts one system artefact type for a new
// workspace. ON CONFLICT on the partial unique index
// artefacts_types_slot_per_workspace_uniq (workspace, slot) WHERE slot IS
// NOT NULL AND archived_at IS NULL — idempotent, safe to re-run.
// $1=subscriptionID $2=workspaceID $3=name $4=prefix $5=slot $6=colour $7=sortOrder
const sqlInsertDefaultWorkspaceType = `
	INSERT INTO artefacts_types (
		artefacts_types_id_subscription,
		artefacts_types_id_workspace,
		artefacts_types_scope,
		artefacts_types_source,
		artefacts_types_name,
		artefacts_types_prefix,
		artefacts_types_slot,
		artefacts_types_colour,
		artefacts_types_sort_order,
		artefacts_types_allows_children,
		artefacts_types_layer_depth
	) VALUES ($1, $2, 'work', 'system', $3, $4, $5, $6, $7, FALSE, 0)
	ON CONFLICT (artefacts_types_id_workspace, artefacts_types_slot)
	WHERE artefacts_types_slot IS NOT NULL AND artefacts_types_archived_at IS NULL
	DO NOTHING`
