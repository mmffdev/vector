// Package webhooks SQL constants.
//
// PLA-0048 / RF1.2.9 (consts) + RF1.4.2.webhooks (column-prefix rule,
// migration 055). Sole writer for webhooks_subscriptions and
// webhooks_deliveries (vector_artefacts).
package webhooks

const sqlListSubscriptionsByWorkspace = `
		SELECT webhooks_subscriptions_id,
		       webhooks_subscriptions_id_workspace,
		       webhooks_subscriptions_url,
		       webhooks_subscriptions_events,
		       webhooks_subscriptions_is_active,
		       webhooks_subscriptions_created_at,
		       webhooks_subscriptions_updated_at,
		       webhooks_subscriptions_archived_at
		FROM webhooks_subscriptions
		WHERE webhooks_subscriptions_id_workspace = $1
		  AND webhooks_subscriptions_archived_at IS NULL
		ORDER BY webhooks_subscriptions_created_at
	`

const sqlSelectSubscriptionByIDInWorkspace = `
		SELECT webhooks_subscriptions_id,
		       webhooks_subscriptions_id_workspace,
		       webhooks_subscriptions_url,
		       webhooks_subscriptions_events,
		       webhooks_subscriptions_is_active,
		       webhooks_subscriptions_created_at,
		       webhooks_subscriptions_updated_at,
		       webhooks_subscriptions_archived_at
		FROM webhooks_subscriptions
		WHERE webhooks_subscriptions_id = $1
		  AND webhooks_subscriptions_id_workspace = $2
		  AND webhooks_subscriptions_archived_at IS NULL
	`

const sqlInsertSubscription = `
		INSERT INTO webhooks_subscriptions (
			webhooks_subscriptions_id_workspace,
			webhooks_subscriptions_url,
			webhooks_subscriptions_events,
			webhooks_subscriptions_secret
		) VALUES ($1, $2, $3, $4)
		RETURNING webhooks_subscriptions_id,
		          webhooks_subscriptions_id_workspace,
		          webhooks_subscriptions_url,
		          webhooks_subscriptions_events,
		          webhooks_subscriptions_is_active,
		          webhooks_subscriptions_created_at,
		          webhooks_subscriptions_updated_at,
		          webhooks_subscriptions_archived_at
	`

// sqlUpdateSubscriptionTemplate — same shape as before. The caller
// builds the SET clause (`col = $N`) and the WHERE (`id = $M AND
// workspace_id = $M+1`) using the new column names.
const sqlUpdateSubscriptionTemplate = `UPDATE webhooks_subscriptions SET %s WHERE %s AND webhooks_subscriptions_archived_at IS NULL`

const sqlSoftDeleteSubscription = `
		UPDATE webhooks_subscriptions
		SET webhooks_subscriptions_archived_at = now()
		WHERE webhooks_subscriptions_id = $1
		  AND webhooks_subscriptions_id_workspace = $2
		  AND webhooks_subscriptions_archived_at IS NULL
	`

const sqlListActiveSubscriptionFiltersForWorkspace = `
		SELECT webhooks_subscriptions_id, webhooks_subscriptions_events
		FROM webhooks_subscriptions
		WHERE webhooks_subscriptions_id_workspace = $1
		  AND webhooks_subscriptions_is_active = TRUE
		  AND webhooks_subscriptions_archived_at IS NULL
	`

const sqlInsertDelivery = `
		INSERT INTO webhooks_deliveries (
			webhooks_deliveries_id_webhooks_subscription,
			webhooks_deliveries_event_type,
			webhooks_deliveries_payload
		) VALUES ($1, $2, $3)
	`

const sqlClaimNextDelivery = `
		SELECT d.webhooks_deliveries_id,
		       d.webhooks_deliveries_id_webhooks_subscription,
		       d.webhooks_deliveries_event_type,
		       d.webhooks_deliveries_payload,
		       d.webhooks_deliveries_attempts,
		       d.webhooks_deliveries_max_attempts,
		       s.webhooks_subscriptions_secret,
		       s.webhooks_subscriptions_url
		FROM webhooks_deliveries d
		JOIN webhooks_subscriptions s
		  ON s.webhooks_subscriptions_id = d.webhooks_deliveries_id_webhooks_subscription
		WHERE d.webhooks_deliveries_claimed_at IS NULL
		  AND d.webhooks_deliveries_attempts < d.webhooks_deliveries_max_attempts
		  AND d.webhooks_deliveries_next_attempt_at <= now()
		  AND s.webhooks_subscriptions_is_active = TRUE
		  AND s.webhooks_subscriptions_archived_at IS NULL
		ORDER BY d.webhooks_deliveries_next_attempt_at
		LIMIT 1
		FOR UPDATE OF d SKIP LOCKED
	`

const sqlMarkDeliveryClaimed = `
		UPDATE webhooks_deliveries
		SET webhooks_deliveries_claimed_at = now()
		WHERE webhooks_deliveries_id = $1
	`

const sqlDeleteDelivery = `DELETE FROM webhooks_deliveries WHERE webhooks_deliveries_id = $1`

const sqlRecordDeliveryFailure = `
		UPDATE webhooks_deliveries
		SET webhooks_deliveries_attempts = $2,
		    webhooks_deliveries_claimed_at = NULL,
		    webhooks_deliveries_next_attempt_at = $3,
		    webhooks_deliveries_last_error = $4
		WHERE webhooks_deliveries_id = $1
	`
