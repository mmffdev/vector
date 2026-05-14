// Package webhooks SQL constants.
//
// PLA-0048 / RF1.2.9. Every SQL string literal used by the webhooks
// package lives here as a named constant. service.go (CRUD + enqueue)
// and worker.go (claim/deliver loop) reference these constants; they
// DO NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlListSubscriptions, sqlInsertSubscription,
// sqlClaimNextDelivery, etc. The sparse UPDATE in service.Update uses
// a `*Template` const with two `%s` placeholders (SET clause + WHERE
// bind indexes) combined via fmt.Sprintf.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// Single DB: vector_artefacts via s.pool — webhook_subscriptions and
// webhook_deliveries both live there. Webhooks is the sole writer for
// both tables.
package webhooks

// ── service.go: subscription CRUD ──────────────────────────────────────────

// sqlListSubscriptionsByWorkspace returns every live subscription for
// a workspace ordered by created_at (insertion order is the natural
// admin list order).
const sqlListSubscriptionsByWorkspace = `
		SELECT id, workspace_id, url, events, is_active, created_at, updated_at, archived_at
		FROM webhook_subscriptions
		WHERE workspace_id = $1 AND archived_at IS NULL
		ORDER BY created_at
	`

// sqlSelectSubscriptionByIDInWorkspace returns one live subscription
// gated on (id, workspace_id). pgx.ErrNoRows → ErrNotFound at the caller.
const sqlSelectSubscriptionByIDInWorkspace = `
		SELECT id, workspace_id, url, events, is_active, created_at, updated_at, archived_at
		FROM webhook_subscriptions
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`

// sqlInsertSubscription registers a new webhook subscription. Returns
// the hydrated row so the caller can echo it back to the admin UI
// without a follow-up read.
const sqlInsertSubscription = `
		INSERT INTO webhook_subscriptions (workspace_id, url, events, secret)
		VALUES ($1, $2, $3, $4)
		RETURNING id, workspace_id, url, events, is_active, created_at, updated_at, archived_at
	`

// sqlUpdateSubscriptionTemplate is the sparse-update shell used by
// Update. First %s holds the comma-separated `col = $N` SET clause
// built from non-nil UpdateInput fields; second %s holds the `$M`
// placeholders for the WHERE (id, workspace_id) binds (formatted as
// "$M AND workspace_id = $M+1" by the caller). archived_at IS NULL
// gate stays inside the const since it's not parameterised.
const sqlUpdateSubscriptionTemplate = `UPDATE webhook_subscriptions SET %s WHERE %s AND archived_at IS NULL`

// sqlSoftDeleteSubscription stamps archived_at = NOW() on a live
// subscription scoped to (id, workspace_id). RowsAffected = 0 →
// ErrNotFound (the soft-delete is idempotent: re-deleting an already-
// archived row is a no-op, not an error, from the caller's POV).
const sqlSoftDeleteSubscription = `
		UPDATE webhook_subscriptions SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL
	`

// ── service.go: enqueue fan-out ────────────────────────────────────────────

// sqlListActiveSubscriptionFiltersForWorkspace returns id + events
// filter for every active subscription in a workspace. Enqueue scans
// the result in Go and inserts one webhook_deliveries row per match.
// Two columns only — payload + workspace + event_type all come from
// the caller, not the row.
const sqlListActiveSubscriptionFiltersForWorkspace = `
		SELECT id, events FROM webhook_subscriptions
		WHERE workspace_id = $1 AND is_active = TRUE AND archived_at IS NULL
	`

// sqlInsertDelivery queues one webhook_deliveries row. attempts +
// next_attempt_at + claimed_at default to (0, now(), NULL) per the
// table's DEFAULTs; the worker picks them up on its next poll.
const sqlInsertDelivery = `
		INSERT INTO webhook_deliveries (subscription_id, event_type, payload)
		VALUES ($1, $2, $3)
	`

// ── worker.go: delivery worker loop ────────────────────────────────────────

// sqlClaimNextDelivery is the FOR UPDATE SKIP LOCKED claim that drives
// at-least-once delivery. Joins to webhook_subscriptions so the worker
// has the URL + secret in one round-trip; filters out claimed,
// exhausted, future-due, deactivated, and archived rows. ORDER BY
// next_attempt_at makes the queue FIFO within ready rows.
const sqlClaimNextDelivery = `
		SELECT d.id, d.subscription_id, d.event_type, d.payload, d.attempts, d.max_attempts,
		       s.secret, s.url
		FROM webhook_deliveries d
		JOIN webhook_subscriptions s ON s.id = d.subscription_id
		WHERE d.claimed_at IS NULL
		  AND d.attempts < d.max_attempts
		  AND d.next_attempt_at <= now()
		  AND s.is_active = TRUE
		  AND s.archived_at IS NULL
		ORDER BY d.next_attempt_at
		LIMIT 1
		FOR UPDATE OF d SKIP LOCKED
	`

// sqlMarkDeliveryClaimed stamps claimed_at = NOW() inside the claim
// tx so a parallel worker won't re-pick the same row after this tx
// commits.
const sqlMarkDeliveryClaimed = `
		UPDATE webhook_deliveries SET claimed_at = now() WHERE id = $1
	`

// sqlDeleteDelivery removes a delivery row after a successful POST.
// Hard delete — the table has no "succeeded" lifecycle state; success
// = absence.
const sqlDeleteDelivery = `DELETE FROM webhook_deliveries WHERE id = $1`

// sqlRecordDeliveryFailure rolls a failed attempt: bumps attempts,
// clears claimed_at so the row becomes eligible again at
// next_attempt_at, and stores last_error for ops.
const sqlRecordDeliveryFailure = `
		UPDATE webhook_deliveries
		SET attempts = $2, claimed_at = NULL, next_attempt_at = $3, last_error = $4
		WHERE id = $1
	`
