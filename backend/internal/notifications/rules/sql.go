// Package rules SQL constants. Sole writer for users_notification_rules.
package rules

// Hydration column list — single source of truth so the SELECTs and
// scanRule() stay aligned. Tx: also matches RETURNING blocks below.
const ruleCols = `
	users_notification_rules_id,
	users_notification_rules_id_subscription,
	users_notification_rules_id_user,
	users_notification_rules_id_workspace,
	users_notification_rules_name,
	users_notification_rules_type,
	users_notification_rules_target,
	users_notification_rules_conditions,
	users_notification_rules_enabled,
	users_notification_rules_created_at,
	users_notification_rules_updated_at
`

const sqlInsertRule = `
	INSERT INTO users_notification_rules (
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions
	) VALUES ($1,$2,$3,$4,$5,$6,$7)
	RETURNING
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
`

const sqlSelectRulesByUser = `
	SELECT
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
	FROM users_notification_rules
	WHERE users_notification_rules_id_user = $1
	  AND users_notification_rules_id_subscription = $2
	ORDER BY users_notification_rules_updated_at DESC
`

const sqlSelectRuleByID = `
	SELECT
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
	FROM users_notification_rules
	WHERE users_notification_rules_id = $1
	  AND users_notification_rules_id_user = $2
`

// sqlUpdateRuleTemplate uses a sparse-set pattern keyed off whichever
// UpdateInput fields are non-nil. Builder in service.go.
const sqlUpdateRuleTemplate = `
	UPDATE users_notification_rules
	SET %s,
	    users_notification_rules_updated_at = now()
	WHERE users_notification_rules_id = $%d
	  AND users_notification_rules_id_user = $%d
	RETURNING
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
`

const sqlDeleteRule = `
	DELETE FROM users_notification_rules
	WHERE users_notification_rules_id = $1
	  AND users_notification_rules_id_user = $2
`

// ── evaluator.go ──────────────────────────────────────────────

// sqlSelectActiveRulesForTarget — the evaluator's hot path. Hits
// the (subscription_id, workspace_id, type, target) partial index
// added by migration 237. Returns every candidate rule regardless of
// user — the caller fans out per-user matches.
const sqlSelectActiveRulesForTarget = `
	SELECT
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_id_workspace,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
	FROM users_notification_rules
	WHERE users_notification_rules_id_subscription = $1
	  AND users_notification_rules_id_workspace = $2
	  AND users_notification_rules_type = $3
	  AND users_notification_rules_target = $4
	  AND users_notification_rules_enabled = TRUE
`

// ── schema.go (vaPool — vector_artefacts) ──────────────────────

// sqlSelectArtefactTypesByWorkspace returns the distinct type NAMES
// in a single workspace. Drives the "target" dropdown after the user
// picks a workspace. DISTINCT defends against any future situation
// where one workspace has multiple rows for the same type name.
const sqlSelectArtefactTypesByWorkspace = `
	SELECT DISTINCT artefacts_types_name
	FROM artefacts_types
	WHERE artefacts_types_id_subscription = $1
	  AND artefacts_types_id_workspace    = $2
	  AND artefacts_types_archived_at IS NULL
	  AND artefacts_types_is_placeholder  = FALSE
	ORDER BY artefacts_types_name ASC
`

// sqlSelectArtefactTypeFieldsByName returns the distinct fields bound
// to type-name X within workspace Y. DISTINCT collapses cases where
// the same field_name is bound to multiple type rows under the same
// name (rare but possible). Renamed labels + options_json are picked
// from whichever binding came first (deterministic via field_name
// alpha-order tie-break).
const sqlSelectArtefactTypeFieldsByName = `
	SELECT
		fl.field_name,
		COALESCE(fl.label, fl.field_name) AS label,
		fl.field_type,
		fl.options_json
	FROM artefacts_types_fields tf
	JOIN artefacts_fields_library fl ON fl.id = tf.field_library_id
	JOIN artefacts_types at ON at.artefacts_types_id = tf.artefact_type_id
	WHERE at.artefacts_types_id_subscription = $1
	  AND at.artefacts_types_id_workspace    = $2
	  AND at.artefacts_types_name            = $3
	  AND at.artefacts_types_archived_at IS NULL
	  AND fl.archived_at IS NULL
	ORDER BY fl.field_name ASC, tf.position ASC
`
