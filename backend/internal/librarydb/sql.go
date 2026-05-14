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

// sqlSelectModelByID returns one portfolio_models row. The column
// list is duplicated in sqlSelectLatestModelByFamily to keep both
// queries as full SQL strings rather than concatenated fragments.
const sqlSelectModelByID = `
		SELECT id, model_family_id, key, name, description, instructions_md,
		       scope, owner_subscription_id, visibility, feature_flags, default_view, icon,
		       version, library_version, archived_at, created_at, updated_at
		  FROM portfolio_models WHERE id = $1
	`

// sqlSelectLatestModelByFamily returns the highest non-archived
// version for a model family.
const sqlSelectLatestModelByFamily = `
		SELECT id, model_family_id, key, name, description, instructions_md,
		       scope, owner_subscription_id, visibility, feature_flags, default_view, icon,
		       version, library_version, archived_at, created_at, updated_at
		FROM portfolio_models
		WHERE model_family_id = $1 AND archived_at IS NULL
		ORDER BY version DESC
		LIMIT 1
	`

// sqlListLayersForModel returns every portfolio_model_layers row
// for one model id ordered by sort_order then name.
const sqlListLayersForModel = `
		SELECT id, model_id, name, tag, sort_order, parent_layer_id, icon, colour,
		       description_md, help_md, allows_children, is_leaf,
		       archived_at, created_at, updated_at
		FROM portfolio_model_layers
		WHERE model_id = $1
		ORDER BY sort_order, name
	`

// sqlListWorkflowsForModel returns portfolio_model_workflows rows for
// one model id ordered by (layer, sort_order, state_key).
const sqlListWorkflowsForModel = `
		SELECT id, model_id, layer_id, state_key, state_label, sort_order,
		       is_initial, is_terminal, colour,
		       archived_at, created_at, updated_at
		FROM portfolio_model_workflows
		WHERE model_id = $1
		ORDER BY layer_id, sort_order, state_key
	`

// sqlListTransitionsForModel returns portfolio_model_workflow_transitions
// rows for one model id ordered by (from, to).
const sqlListTransitionsForModel = `
		SELECT id, model_id, from_state_id, to_state_id,
		       archived_at, created_at, updated_at
		FROM portfolio_model_workflow_transitions
		WHERE model_id = $1
		ORDER BY from_state_id, to_state_id
	`

// sqlListArtifactsForModel returns portfolio_model_artifacts rows for
// one model id ordered by artefact_key.
const sqlListArtifactsForModel = `
		SELECT id, model_id, artifact_key, enabled, config,
		       archived_at, created_at, updated_at
		FROM portfolio_model_artifacts
		WHERE model_id = $1
		ORDER BY artifact_key
	`

// sqlListTerminologyForModel returns portfolio_model_terminology rows
// for one model id ordered by key.
const sqlListTerminologyForModel = `
		SELECT id, model_id, key, value,
		       archived_at, created_at, updated_at
		FROM portfolio_model_terminology
		WHERE model_id = $1
		ORDER BY key
	`

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
		SELECT id, library_version, title, summary_md, body_md, severity,
		       audience_tier, audience_subscription_ids, affects_model_family_id,
		       released_at, expires_at, archived_at, created_at, updated_at
		FROM library_releases
		WHERE archived_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND (audience_tier IS NULL OR $1 = ANY(audience_tier))
		  AND (audience_subscription_ids IS NULL OR $2 = ANY(audience_subscription_ids))
		ORDER BY released_at DESC, id
	`

// sqlListActionsForReleases returns library_release_actions for a
// batch of release ids, ordered for stable rendering.
const sqlListActionsForReleases = `
		SELECT id, release_id, action_key, label, payload, sort_order, created_at, updated_at
		FROM library_release_actions
		WHERE release_id = ANY($1)
		ORDER BY release_id, sort_order, action_key
	`

// sqlListAckedReleaseIDs returns the release_ids the caller has
// already acknowledged from the supplied candidate set.
const sqlListAckedReleaseIDs = `
		SELECT release_id
		FROM library_acknowledgements
		WHERE subscription_id = $1 AND release_id = ANY($2)
	`

// sqlInsertReleaseAck idempotently records one acknowledgement.
const sqlInsertReleaseAck = `
		INSERT INTO library_acknowledgements (
		    subscription_id, release_id, acknowledged_by_user_id, action_taken
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (subscription_id, release_id) DO NOTHING
	`

// sqlSelectReleaseByID loads one library_releases row by id; archived
// rows return ErrReleaseNotFound.
const sqlSelectReleaseByID = `
		SELECT id, library_version, title, summary_md, body_md, severity,
		       audience_tier, audience_subscription_ids, affects_model_family_id,
		       released_at, expires_at, archived_at, created_at, updated_at
		FROM library_releases
		WHERE id = $1 AND archived_at IS NULL
	`
