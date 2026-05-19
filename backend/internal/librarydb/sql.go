// Package librarydb SQL constants.
//
// PLA-0048 / RF1.2.17. Read pool is libRO (mmff_library) for the
// canonical content; the per-subscription ack pool is acksPool
// (vector_artefacts post-PLA-0023-P1).
//
// fetch.go and releases.go previously composed their SELECTs from a
// `modelCols` / `releaseCols` constant; those column-list constants
// are absorbed into the full-shot SELECT consts below so SQL never
// crosses the const boundary.
package librarydb

// ── fetch.go ───────────────────────────────────────────────────────────────

// sqlSelectTemplateByID fetches the portfolio_templates row used by
// FetchTemplateByID. Layers come as raw JSONB so the caller can
// resolve TemplateLayer in Go.
const sqlSelectTemplateByID = `
		SELECT name, description, layers FROM portfolio_templates WHERE id = $1
	`

// sqlListTagDefinitions returns the (tag, description) lookup for
// portfolio_template_layer_definitions, used as the canonical layer
// description source.
const sqlListTagDefinitions = `SELECT tag, description FROM portfolio_template_layer_definitions`

// ── list.go ────────────────────────────────────────────────────────────────

// sqlListPublishedModels returns portfolio_templates ordered with the
// Vector Standard template first.
const sqlListPublishedModels = `
		SELECT id, name, description, layers
		FROM portfolio_templates
		ORDER BY CASE WHEN id = '00000000-0000-0000-0000-00000000aa01' THEN 0 ELSE 1 END,
			name
	`

// ── releases.go ────────────────────────────────────────────────────────────

// sqlListActiveReleasesForAudience returns active, in-audience
// library_releases for a (subscription, tier) pair. Visibility rules
// per plan §12.5.
const sqlListActiveReleasesForAudience = `
		SELECT library_releases_id,
		       library_releases_library_version,
		       library_releases_title,
		       library_releases_summary_md,
		       library_releases_body_md,
		       library_releases_severity,
		       library_releases_audience_tier,
		       library_releases_audience_subscription_ids,
		       library_releases_id_model_family,
		       library_releases_released_at,
		       library_releases_expires_at,
		       library_releases_archived_at,
		       library_releases_created_at,
		       library_releases_updated_at
		FROM library_releases
		WHERE library_releases_archived_at IS NULL
		  AND (library_releases_expires_at IS NULL OR library_releases_expires_at > NOW())
		  AND (library_releases_audience_tier IS NULL OR $1 = ANY(library_releases_audience_tier))
		  AND (library_releases_audience_subscription_ids IS NULL OR $2 = ANY(library_releases_audience_subscription_ids))
		ORDER BY library_releases_released_at DESC, library_releases_id
	`

// sqlListActionsForReleases returns library_release_actions for a
// batch of release ids, ordered for stable rendering.
const sqlListActionsForReleases = `
		SELECT library_releases_actions_id,
		       library_releases_actions_id_library_release,
		       library_releases_actions_action_key,
		       library_releases_actions_label,
		       library_releases_actions_payload,
		       library_releases_actions_sort_order,
		       library_releases_actions_created_at,
		       library_releases_actions_updated_at
		FROM library_releases_actions
		WHERE library_releases_actions_id_library_release = ANY($1)
		ORDER BY library_releases_actions_id_library_release,
		         library_releases_actions_sort_order,
		         library_releases_actions_action_key
	`

// sqlListAckedReleaseIDs returns the release_ids the caller has
// already acknowledged from the supplied candidate set.
const sqlListAckedReleaseIDs = `
		SELECT library_releases_acknowledgements_id_library_release
		FROM library_releases_acknowledgements
		WHERE library_releases_acknowledgements_id_subscription = $1
		  AND library_releases_acknowledgements_id_library_release = ANY($2)
	`

// sqlInsertReleaseAck idempotently records one acknowledgement.
const sqlInsertReleaseAck = `
		INSERT INTO library_releases_acknowledgements (
		    library_releases_acknowledgements_id_subscription,
		    library_releases_acknowledgements_id_library_release,
		    library_releases_acknowledgements_id_user_acknowledger,
		    library_releases_acknowledgements_action_taken
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (
		    library_releases_acknowledgements_id_subscription,
		    library_releases_acknowledgements_id_library_release
		) DO NOTHING
	`

// sqlSelectReleaseByID loads one library_releases row by id; archived
// rows return ErrReleaseNotFound.
const sqlSelectReleaseByID = `
		SELECT library_releases_id,
		       library_releases_library_version,
		       library_releases_title,
		       library_releases_summary_md,
		       library_releases_body_md,
		       library_releases_severity,
		       library_releases_audience_tier,
		       library_releases_audience_subscription_ids,
		       library_releases_id_model_family,
		       library_releases_released_at,
		       library_releases_expires_at,
		       library_releases_archived_at,
		       library_releases_created_at,
		       library_releases_updated_at
		FROM library_releases
		WHERE library_releases_id = $1 AND library_releases_archived_at IS NULL
	`
