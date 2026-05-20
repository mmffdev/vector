// Package mentions SQL constants. Sole writer for users_mentions
// (mmff_vector). Column names follow the project-wide prefix rule —
// every column on users_mentions starts with `users_mentions_`.
package mentions

// sqlInsertMention writes one fan-out row. Snippet + label are
// computed/sanitised in the service layer; the SQL just persists.
const sqlInsertMention = `
		INSERT INTO users_mentions (
			users_mentions_id_subscription,
			users_mentions_id_workspace,
			users_mentions_id_user_author,
			users_mentions_id_user_mentioned,
			users_mentions_context_kind,
			users_mentions_context_id,
			users_mentions_context_label,
			users_mentions_snippet
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING
			users_mentions_id,
			users_mentions_id_subscription,
			users_mentions_id_workspace,
			users_mentions_id_user_author,
			users_mentions_id_user_mentioned,
			users_mentions_context_kind,
			users_mentions_context_id,
			users_mentions_context_label,
			users_mentions_snippet,
			users_mentions_created_at,
			users_mentions_read_at
	`

// sqlListInboxTemplate — %s holds the composed WHERE clause.
const sqlListInboxTemplate = `
		SELECT
			users_mentions_id,
			users_mentions_id_subscription,
			users_mentions_id_workspace,
			users_mentions_id_user_author,
			users_mentions_id_user_mentioned,
			users_mentions_context_kind,
			users_mentions_context_id,
			users_mentions_context_label,
			users_mentions_snippet,
			users_mentions_created_at,
			users_mentions_read_at
		FROM users_mentions
		WHERE %s
		ORDER BY users_mentions_created_at DESC
		LIMIT $%d
	`

// sqlMarkRead flips read_at iff the mention belongs to the caller and
// was previously unread. RowsAffected = 0 means not-found-or-not-owned.
const sqlMarkRead = `
		UPDATE users_mentions
		SET users_mentions_read_at = now()
		WHERE users_mentions_id = $1
		  AND users_mentions_id_user_mentioned = $2
		  AND users_mentions_read_at IS NULL
	`

// sqlSearchMentionablesTenant returns matching users across the
// caller's subscription. ILIKE on a single concatenated string keeps
// the prefix-match generous: matches first/last/display/email.
//
// Tenant isolation: users.subscription_id = $1 is non-negotiable.
const sqlSearchMentionablesTenant = `
		SELECT
			id,
			email,
			COALESCE(display_name, CONCAT_WS(' ', first_name, last_name), email) AS display_name,
			first_name,
			last_name
		FROM users
		WHERE subscription_id = $1
		  AND is_active = TRUE
		  AND (
			email ILIKE $2
			OR COALESCE(first_name, '') ILIKE $2
			OR COALESCE(last_name, '') ILIKE $2
			OR COALESCE(display_name, '') ILIKE $2
		  )
		ORDER BY display_name ASC
		LIMIT $3
	`

// sqlSearchMentionablesTeam — same shape, narrowed to users on the
// caller's team(s). The join uses users_teams + users_teams_members.
// When the caller belongs to no team, this returns zero rows.
const sqlSearchMentionablesTeam = `
		SELECT DISTINCT
			u.id,
			u.email,
			COALESCE(u.display_name, CONCAT_WS(' ', u.first_name, u.last_name), u.email) AS display_name,
			u.first_name,
			u.last_name
		FROM users u
		JOIN users_teams_members peer ON peer.user_id = u.id
		WHERE u.subscription_id = $1
		  AND u.is_active = TRUE
		  AND peer.team_id IN (
			SELECT team_id FROM users_teams_members WHERE user_id = $4
		  )
		  AND (
			u.email ILIKE $2
			OR COALESCE(u.first_name, '') ILIKE $2
			OR COALESCE(u.last_name, '') ILIKE $2
			OR COALESCE(u.display_name, '') ILIKE $2
		  )
		ORDER BY display_name ASC
		LIMIT $3
	`

// sqlGetMentionsScopeSetting reads the per-subscription scope toggle
// from master_record_tenants. Default = 'tenant' when row missing or
// column NULL — handled in the service.
const sqlGetMentionsScopeSetting = `
		SELECT COALESCE(master_record_tenants_mentions_scope, 'tenant')
		FROM master_record_tenants
		WHERE master_record_tenants_id_subscription = $1
		LIMIT 1
	`
