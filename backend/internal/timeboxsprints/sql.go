// Package timeboxsprints SQL constants.
//
// PLA-0048 / RF1.2.10. Sole writer for timebox_sprints (vector_artefacts).
package timeboxsprints

// sqlInsertSprint creates a new sprint and returns the hydrated row.
const sqlInsertSprint = `
		INSERT INTO timebox_sprints (
			subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days, sprint_date_start, sprint_date_end,
			sprint_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
	`

// sqlSelectSprintByID returns one live sprint scoped to workspace.
const sqlSelectSprintByID = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
		FROM timebox_sprints
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`

// sqlListSprintsTemplate is the dynamic list query — %s holds the
// composed WHERE clause built from List filters.
const sqlListSprintsTemplate = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
		FROM timebox_sprints
		WHERE %s
		ORDER BY sprint_date_start ASC
	`

// sqlUpdateSprintTemplate is the sparse-UPDATE shell. %s slots: SET
// clause; $%d $%d in WHERE for (id, workspace_id).
const sqlUpdateSprintTemplate = `
		UPDATE timebox_sprints
		SET %s
		WHERE id = $%d AND workspace_id = $%d AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
	`

// sqlArchiveSprint soft-deletes one sprint scoped to workspace.
const sqlArchiveSprint = `
		UPDATE timebox_sprints
		SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`

// sqlStartSprint atomically transitions planned → active and returns
// the hydrated row. RETURNING is empty when status != 'planned'.
const sqlStartSprint = `
		UPDATE timebox_sprints
		SET status = 'active'
		WHERE id = $1 AND workspace_id = $2 AND status = 'planned' AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
	`

// sqlCloseSprint atomically transitions active → completed.
const sqlCloseSprint = `
		UPDATE timebox_sprints
		SET status = 'completed'
		WHERE id = $1 AND workspace_id = $2 AND status = 'active' AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			sprint_name, sprint_suffix, sprint_owner,
			sprint_cadence_days,
			sprint_date_start::text, sprint_date_end::text,
			sprint_scope, sprint_velocity, sprint_estimate,
			sprint_creep_by_count, sprint_creep_by_estimate,
			status, sprint_date_added, sprint_date_updated, archived_at
	`

// sqlSelectLastSprintEndDateRoot returns the latest sprint_date_end
// for workspace-level sprints (no org_node).
const sqlSelectLastSprintEndDateRoot = `
		SELECT sprint_date_end::text
		FROM timebox_sprints
		WHERE workspace_id = $1 AND org_node_id IS NULL AND archived_at IS NULL
		ORDER BY sprint_date_end DESC LIMIT 1
	`

// sqlSelectLastSprintEndDateForNode returns the latest sprint_date_end
// for a specific org_node within a workspace.
const sqlSelectLastSprintEndDateForNode = `
		SELECT sprint_date_end::text
		FROM timebox_sprints
		WHERE workspace_id = $1 AND org_node_id = $2 AND archived_at IS NULL
		ORDER BY sprint_date_end DESC LIMIT 1
	`
