// Package timeboxmilestones SQL constants. Sole writer for
// timeboxes_milestones (vector_artefacts).
package timeboxmilestones

// sqlInsertMilestone creates a new milestone and returns the hydrated row.
const sqlInsertMilestone = `
		INSERT INTO timeboxes_milestones (
			timeboxes_milestones_id_subscription,
			timeboxes_milestones_id_workspace,
			timeboxes_milestones_id_topology_node,
			timeboxes_milestones_name,
			timeboxes_milestones_description,
			timeboxes_milestones_id_user_owner,
			timeboxes_milestones_date_target,
			timeboxes_milestones_position
		) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, 0))
		RETURNING
			timeboxes_milestones_id,
			timeboxes_milestones_id_subscription,
			timeboxes_milestones_id_workspace,
			timeboxes_milestones_id_topology_node,
			timeboxes_milestones_name,
			timeboxes_milestones_description,
			timeboxes_milestones_id_user_owner,
			timeboxes_milestones_date_target::text,
			timeboxes_milestones_status,
			timeboxes_milestones_position,
			timeboxes_milestones_created_at,
			timeboxes_milestones_updated_at,
			timeboxes_milestones_archived_at
	`

// sqlSelectMilestoneByID returns one live milestone scoped to workspace.
const sqlSelectMilestoneByID = `
		SELECT
			timeboxes_milestones_id,
			timeboxes_milestones_id_subscription,
			timeboxes_milestones_id_workspace,
			timeboxes_milestones_id_topology_node,
			timeboxes_milestones_name,
			timeboxes_milestones_description,
			timeboxes_milestones_id_user_owner,
			timeboxes_milestones_date_target::text,
			timeboxes_milestones_status,
			timeboxes_milestones_position,
			timeboxes_milestones_created_at,
			timeboxes_milestones_updated_at,
			timeboxes_milestones_archived_at
		FROM timeboxes_milestones
		WHERE timeboxes_milestones_id = $1
		  AND timeboxes_milestones_id_workspace = $2
		  AND timeboxes_milestones_archived_at IS NULL
	`

// sqlListMilestonesTemplate is the dynamic list query — %s holds the
// composed WHERE clause built from List filters.
const sqlListMilestonesTemplate = `
		SELECT
			timeboxes_milestones_id,
			timeboxes_milestones_id_subscription,
			timeboxes_milestones_id_workspace,
			timeboxes_milestones_id_topology_node,
			timeboxes_milestones_name,
			timeboxes_milestones_description,
			timeboxes_milestones_id_user_owner,
			timeboxes_milestones_date_target::text,
			timeboxes_milestones_status,
			timeboxes_milestones_position,
			timeboxes_milestones_created_at,
			timeboxes_milestones_updated_at,
			timeboxes_milestones_archived_at
		FROM timeboxes_milestones
		WHERE %s
		ORDER BY timeboxes_milestones_date_target ASC, timeboxes_milestones_position ASC
	`

// sqlUpdateMilestoneTemplate is the sparse-UPDATE shell. %s slots: SET
// clause; $%d $%d in WHERE for (id, workspace_id).
const sqlUpdateMilestoneTemplate = `
		UPDATE timeboxes_milestones
		SET %s
		WHERE timeboxes_milestones_id = $%d
		  AND timeboxes_milestones_id_workspace = $%d
		  AND timeboxes_milestones_archived_at IS NULL
		RETURNING
			timeboxes_milestones_id,
			timeboxes_milestones_id_subscription,
			timeboxes_milestones_id_workspace,
			timeboxes_milestones_id_topology_node,
			timeboxes_milestones_name,
			timeboxes_milestones_description,
			timeboxes_milestones_id_user_owner,
			timeboxes_milestones_date_target::text,
			timeboxes_milestones_status,
			timeboxes_milestones_position,
			timeboxes_milestones_created_at,
			timeboxes_milestones_updated_at,
			timeboxes_milestones_archived_at
	`

// sqlArchiveMilestone soft-deletes one milestone scoped to workspace.
const sqlArchiveMilestone = `
		UPDATE timeboxes_milestones
		SET timeboxes_milestones_archived_at = now()
		WHERE timeboxes_milestones_id = $1
		  AND timeboxes_milestones_id_workspace = $2
		  AND timeboxes_milestones_archived_at IS NULL
	`
