package domain

import "github.com/google/uuid"

// DeliveryStatus models the outcome of a single delivery attempt.
// The six values match the CHECK constraint on
// notifications_delivery_attempts.notifications_delivery_attempts_status
// (migration 123).
type DeliveryStatus string

const (
	// DeliveryQueued means the outbox row exists but no attempt has been made yet.
	DeliveryQueued DeliveryStatus = "queued"
	// DeliverySent means the payload was handed to the provider.
	DeliverySent DeliveryStatus = "sent"
	// DeliveryDelivered means the provider confirmed delivery to the recipient.
	DeliveryDelivered DeliveryStatus = "delivered"
	// DeliveryBounced means the provider reported a permanent delivery failure.
	DeliveryBounced DeliveryStatus = "bounced"
	// DeliveryFailed means the attempt failed (transient — may be retried).
	DeliveryFailed DeliveryStatus = "failed"
	// DeliverySuppressed means the event was not delivered by policy (prefs,
	// quiet hours, platform kill switch, etc). An attempt row is always written
	// for suppressions so the audit trail is complete.
	DeliverySuppressed DeliveryStatus = "suppressed"
)

// DeliveryInput is what a Dispatcher receives for each outbox row.
// The relay hydrates this from the outbox + event rows before publishing
// to the broker.
type DeliveryInput struct {
	EventID         uuid.UUID
	OutboxID        uuid.UUID
	RecipientUserID uuid.UUID
	Channel         Channel
	Title           string
	Body            string
	Priority        Priority
	Data            map[string]any
	AttemptNumber   int
}

// DeliveryReceipt is what a Dispatcher returns after each delivery attempt.
// The audit writer stores this in notifications_delivery_attempts.
type DeliveryReceipt struct {
	Status            DeliveryStatus
	ProviderMessageID string
	ProviderResponse  map[string]any
	LatencyMS         int
	// ErrorClass is one of the standard error-class values from the spec
	// (timeout, auth, bounce, provider_5xx, template_missing,
	// recipient_gone, channel_disabled_platform, dev_allowlist_blocked, unknown).
	// Empty when Status is sent or delivered.
	ErrorClass string
}
