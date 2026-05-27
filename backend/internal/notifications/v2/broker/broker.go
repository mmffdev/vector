package broker

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrBrokerUnavailable is returned by NoopBroker for any operation
// the caller would have expected to succeed. Callers can sentinel-
// check this to differentiate "broker is intentionally off" from
// "broker is configured but failing".
var ErrBrokerUnavailable = errors.New("v2 broker unavailable (AMQP_URL not set)")

// Envelope is the wire-level structure that wraps every event v2
// publishes. Payload is the producer's raw event marshalled to JSON;
// the headers outside it (MessageID + RoutingKey + OutboxID) are
// what dispatchers route on.
type Envelope struct {
	MessageID  string          `json:"message_id"`
	RoutingKey string          `json:"routing_key"`
	OutboxID   string          `json:"outbox_id,omitempty"`
	Payload    json.RawMessage `json:"payload"`
}

// Handler is the dispatcher callback. Return nil to ack (broker
// considers it delivered); return non-nil to nack (broker re-queues
// or dead-letters per its policy).
type Handler func(ctx context.Context, env Envelope) error

// Broker is the v2 surface dispatchers + relay talk to. All methods
// are safe for concurrent use.
type Broker interface {
	// Publish sends one envelope. Returns ErrBrokerUnavailable when
	// the impl is the noop fallback so the relay can log + retry.
	Publish(ctx context.Context, env Envelope) error

	// Consume binds a queue to the given routing-key pattern and
	// invokes handler for each delivered envelope. Blocks until ctx
	// is cancelled. Each consumer should run in its own goroutine.
	Consume(ctx context.Context, queueName, routingKeyPattern string, handler Handler) error

	// Close shuts the underlying transport down cleanly. Called once
	// at server shutdown.
	Close() error
}
