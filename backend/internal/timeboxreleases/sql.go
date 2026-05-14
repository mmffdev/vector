// Package timeboxreleases SQL constants.
//
// PLA-0048 / RF1.2.10. Sole writer for timebox_releases (vector_artefacts).
package timeboxreleases

// sqlInsertRelease creates a new release and returns the hydrated row.
const sqlInsertRelease = `
		INSERT INTO timebox_releases (
			subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days, release_date_start, release_date_end,
			release_velocity
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
	`

// sqlSelectReleaseByID returns one live release scoped to workspace.
const sqlSelectReleaseByID = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
		FROM timebox_releases
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`

// sqlListReleasesTemplate is the dynamic list query — %s holds the
// composed WHERE clause built from List filters.
const sqlListReleasesTemplate = `
		SELECT
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
		FROM timebox_releases
		WHERE %s
		ORDER BY release_date_start ASC
	`

// sqlUpdateReleaseTemplate is the sparse-UPDATE shell. %s slots: SET
// clause; $%d $%d in WHERE for (id, workspace_id).
const sqlUpdateReleaseTemplate = `
		UPDATE timebox_releases
		SET %s
		WHERE id = $%d AND workspace_id = $%d AND archived_at IS NULL
		RETURNING
			id, subscription_id, workspace_id, org_node_id,
			release_name, release_suffix, release_owner,
			release_cadence_days,
			release_date_start::text, release_date_end::text,
			release_scope, release_velocity, release_estimate,
			release_creep_by_count, release_creep_by_estimate,
			status, release_date_added, release_date_updated, archived_at
	`

// sqlArchiveRelease soft-deletes one release scoped to workspace.
const sqlArchiveRelease = `
		UPDATE timebox_releases
		SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`
