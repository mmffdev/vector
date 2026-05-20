// Package notifications SQL constants. Sole writer for the
// notifications_* tables in mmff_vector (migration 230).
package notifications

// sqlInsertOutbox writes one row to notifications_outbox. Producer
// (mentions, future watchers) calls this either directly via the
// notifier's pool (Enqueue) or inside their own tx (EnqueueTx).
const sqlInsertOutbox = `
	INSERT INTO notifications_outbox (
		notifications_outbox_id_subscription,
		notifications_outbox_id_user_recipient,
		notifications_outbox_kind,
		notifications_outbox_payload
	) VALUES ($1, $2, $3, $4)
`

// sqlClaimOutboxBatch atomically claims up to N unclaimed rows by
// setting claimed_at = now() and returns the claimed rows. The SKIP
// LOCKED + UPDATE ... RETURNING combo is the canonical single-process
// (or multi-process) safe outbox-claim pattern.
const sqlClaimOutboxBatch = `
	WITH claimed AS (
		SELECT notifications_outbox_id
		FROM notifications_outbox
		WHERE notifications_outbox_claimed_at IS NULL
		  AND notifications_outbox_attempts < 5
		ORDER BY notifications_outbox_created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	)
	UPDATE notifications_outbox o
	SET notifications_outbox_claimed_at = now()
	FROM claimed
	WHERE o.notifications_outbox_id = claimed.notifications_outbox_id
	RETURNING
		o.notifications_outbox_id,
		o.notifications_outbox_id_subscription,
		o.notifications_outbox_id_user_recipient,
		o.notifications_outbox_kind,
		o.notifications_outbox_payload,
		o.notifications_outbox_attempts
`

// sqlMarkOutboxDelivered flips delivered_at + clears last_error on a
// successful publish. Called by the relay after the broker ack.
const sqlMarkOutboxDelivered = `
	UPDATE notifications_outbox
	SET notifications_outbox_delivered_at = now(),
	    notifications_outbox_last_error   = NULL
	WHERE notifications_outbox_id = $1
`

// sqlMarkOutboxFailed bumps attempts + records the error, and
// un-claims the row so it's eligible for retry on the next drain.
// When attempts reach 5 the partial index in 230_notifications.sql
// stops including the row, so it parks instead of busy-looping.
const sqlMarkOutboxFailed = `
	UPDATE notifications_outbox
	SET notifications_outbox_attempts   = notifications_outbox_attempts + 1,
	    notifications_outbox_last_error = $2,
	    notifications_outbox_claimed_at = NULL
	WHERE notifications_outbox_id = $1
`

// SqlSelectUserEmail looks up an active user's email by ID. Used by
// the email dispatcher to resolve the recipient address.
const SqlSelectUserEmail = `
	SELECT email
	FROM users
	WHERE id = $1
	  AND is_active = TRUE
`

// SqlInsertUserNotificationFromEvent writes one row to the in-app
// read model (users_notifications) — called by the in-app dispatcher.
// Exported so the `dispatchers` sub-package can use it; in-package
// callers should still use this constant rather than re-defining.
const SqlInsertUserNotificationFromEvent = `
	INSERT INTO users_notifications (
		users_notifications_id_subscription,
		users_notifications_id_user,
		users_notifications_kind,
		users_notifications_title,
		users_notifications_body,
		users_notifications_context_kind,
		users_notifications_context_id,
		users_notifications_context_label,
		users_notifications_id_outbox
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`

// sqlListUserNotificationsTemplate — %s holds the composed WHERE; %d
// is the limit placeholder index. The handler builds the WHERE so it
// can pin (subscription_id, user_id) and optionally only_unread.
const sqlListUserNotificationsTemplate = `
	SELECT
		users_notifications_id,
		users_notifications_id_subscription,
		users_notifications_id_user,
		users_notifications_kind,
		users_notifications_title,
		users_notifications_body,
		users_notifications_context_kind,
		users_notifications_context_id,
		users_notifications_context_label,
		users_notifications_created_at,
		users_notifications_read_at
	FROM users_notifications
	WHERE %s
	ORDER BY users_notifications_created_at DESC
	LIMIT $%d
`

const sqlCountUnreadUserNotifications = `
	SELECT COUNT(*)
	FROM users_notifications
	WHERE users_notifications_id_subscription = $1
	  AND users_notifications_id_user         = $2
	  AND users_notifications_read_at IS NULL
`

const sqlMarkUserNotificationRead = `
	UPDATE users_notifications
	SET users_notifications_read_at = now()
	WHERE users_notifications_id            = $1
	  AND users_notifications_id_user       = $2
	  AND users_notifications_read_at IS NULL
`

const sqlMarkAllUserNotificationsRead = `
	UPDATE users_notifications
	SET users_notifications_read_at = now()
	WHERE users_notifications_id_subscription = $1
	  AND users_notifications_id_user         = $2
	  AND users_notifications_read_at IS NULL
`

// sqlListUserNotificationsPrefs returns the explicit prefs for one
// user. Empty result = use defaults (handled in the service).
const sqlListUserNotificationsPrefs = `
	SELECT
		users_notifications_prefs_kind,
		users_notifications_prefs_channel,
		users_notifications_prefs_enabled
	FROM users_notifications_prefs
	WHERE users_notifications_prefs_id_user = $1
`

// sqlUpsertUserNotificationsPref writes one (kind, channel, enabled)
// row. The bell settings page calls this once per toggle.
const sqlUpsertUserNotificationsPref = `
	INSERT INTO users_notifications_prefs (
		users_notifications_prefs_id_user,
		users_notifications_prefs_kind,
		users_notifications_prefs_channel,
		users_notifications_prefs_enabled
	) VALUES ($1, $2, $3, $4)
	ON CONFLICT (
		users_notifications_prefs_id_user,
		users_notifications_prefs_kind,
		users_notifications_prefs_channel
	) DO UPDATE SET
		users_notifications_prefs_enabled   = EXCLUDED.users_notifications_prefs_enabled,
		users_notifications_prefs_updated_at = now()
`
