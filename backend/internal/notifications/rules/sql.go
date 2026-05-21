// Package rules SQL constants. Sole writer for users_notification_rules.
package rules

const sqlInsertRule = `
	INSERT INTO users_notification_rules (
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions
	) VALUES ($1,$2,$3,$4,$5,$6)
	RETURNING
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
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

// sqlSelectActiveRulesForTarget — the evaluator's hot path.
// Hits the (subscription_id, type, target) WHERE enabled partial
// index added by migration 236. Returns every candidate rule
// regardless of user — the caller fans out per-user matches.
const sqlSelectActiveRulesForTarget = `
	SELECT
		users_notification_rules_id,
		users_notification_rules_id_subscription,
		users_notification_rules_id_user,
		users_notification_rules_name,
		users_notification_rules_type,
		users_notification_rules_target,
		users_notification_rules_conditions,
		users_notification_rules_enabled,
		users_notification_rules_created_at,
		users_notification_rules_updated_at
	FROM users_notification_rules
	WHERE users_notification_rules_id_subscription = $1
	  AND users_notification_rules_type = $2
	  AND users_notification_rules_target = $3
	  AND users_notification_rules_enabled = TRUE
`

// ── schema.go (vaPool — vector_artefacts) ──────────────────────

// sqlSelectArtefactTypes returns the tenant's artefact_types — feeds
// the "target" dropdown in the rule builder.
const sqlSelectArtefactTypes = `
	SELECT artefacts_types_id::text, artefacts_types_name
	FROM artefacts_types
	WHERE artefacts_types_id_subscription = $1
	  AND artefacts_types_archived_at IS NULL
	  AND artefacts_types_is_placeholder = FALSE
	ORDER BY artefacts_types_sort_order ASC, artefacts_types_name ASC
`

// sqlSelectArtefactTypeFields returns the fields the tenant has
// bound to one artefact_type. JOINs the link table to the field
// library so renamed labels + options_json land in one round-trip.
const sqlSelectArtefactTypeFields = `
	SELECT
		fl.field_name,
		COALESCE(fl.label, fl.field_name) AS label,
		fl.field_type,
		fl.options_json
	FROM artefacts_types_fields tf
	JOIN artefacts_fields_library fl ON fl.id = tf.field_library_id
	JOIN artefacts_types at ON at.artefacts_types_id = tf.artefact_type_id
	WHERE at.artefacts_types_id_subscription = $1
	  AND at.artefacts_types_id = $2
	  AND at.artefacts_types_archived_at IS NULL
	  AND fl.archived_at IS NULL
	ORDER BY tf.position ASC, fl.label ASC
`
