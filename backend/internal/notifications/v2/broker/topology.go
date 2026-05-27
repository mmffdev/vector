// Package broker is the v2 message-broker seam for the notifications
// system. v2 is intentionally namespaced separately from v1's broker
// (no shared imports) so the strangler-fig cutover can flip without
// any code coupling between versions.
//
// Exchange is shared with v1 (RabbitMQ exchange "notifications") but
// routing-key patterns and queue names are versioned. v1 uses
// "<kind>.<channel>"; v2 uses "<domain>.<action>.<channel>". The
// three-segment v2 pattern cannot collide with v1's two-segment
// pattern because "*" wildcards bind to exactly one segment.
package broker

// ExchangeName is the single topic exchange both v1 and v2 publish to.
// Shared intentionally — declaring an exchange with identical properties
// is idempotent in RabbitMQ. v1 and v2 messages are separated by
// routing-key segment count, not by exchange name.
const ExchangeName = "notifications"

// Channel identifiers. These are the queue suffixes and the third
// segment of every v2 routing key.
const (
	ChannelInApp = "in_app"
	ChannelSSE   = "sse"
	ChannelEmail = "email"
	ChannelPush  = "push"
	ChannelSlack = "slack"
	ChannelSMS   = "sms"
)

// AllChannels is the canonical v2 channel inventory. Every queue in v2
// corresponds to one entry here; every dispatcher binds against one of
// these. Push, Slack, and SMS are declared but unconsumed in v1 of this
// PLA — the queues exist so future dispatchers need no broker change to
// start consuming.
var AllChannels = []string{
	ChannelInApp,
	ChannelSSE,
	ChannelEmail,
	ChannelPush,
	ChannelSlack,
	ChannelSMS,
}

// QueueName builds the v2 queue name for a channel. Pattern is
// "notifications.v2.<channel>", namespacing v2 traffic apart from v1.
func QueueName(channel string) string {
	return "notifications.v2." + channel
}

// BindingPattern is the routing-key pattern a consumer for the given
// channel must use. v2 routing keys are "<domain>.<action>.<channel>",
// so each consumer binds "*.*.<channel>" to catch every event for its
// channel regardless of domain/action.
func BindingPattern(channel string) string {
	return "*.*." + channel
}

// RoutingKey builds a v2 routing key. Producers (the relay) call this
// when publishing an outbox row.
func RoutingKey(domain, action, channel string) string {
	return domain + "." + action + "." + channel
}
