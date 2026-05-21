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
