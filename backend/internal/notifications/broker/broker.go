// Package broker is the message-broker seam for the notifications
// system. Producers (the outbox relay) call Broker.Publish; consumers
// (in-app / email / sse dispatchers) call Broker.Consume.
//
// Two implementations:
//
//   - RabbitBroker (rabbit.go) — production transport, used when
//     AMQP_URL is set.
//   - NoopBroker  (noop.go)   — drop-on-the-floor impl used when the
//     env is unset; lets the rest of the backend boot in environments
//     without RMQ (CI, ephemeral test rigs, dev machines that haven't
//     pulled the broker yet).
//
// The interface is deliberately broker-agnostic — it talks in
// "routing key" and "payload", not "exchange" or "queue". Swapping
// in Kafka or NATS later is a same-day refactor.
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
var ErrBrokerUnavailable = errors.New("broker unavailable (AMQP_URL not set)")

// Envelope is the wire-level structure that wraps every event the
// notifications system publishes. The Payload is the producer's
// raw event (notifications.Event marshalled to JSON); the headers
// outside it (MessageID + RoutingKey) are what dispatchers route on.
type Envelope struct {
	MessageID   string          `json:"message_id"`
	RoutingKey  string          `json:"routing_key"`
	OutboxID    string          `json:"outbox_id,omitempty"`
	Payload     json.RawMessage `json:"payload"`
}

// Handler is the dispatcher callback. Return nil to ack the message
// (broker considers it delivered); return non-nil to nack (broker
// re-queues or dead-letters per its policy).
type Handler func(ctx context.Context, env Envelope) error

// Broker is the surface the rest of the notifications package talks
// to. All methods are safe to call concurrently.
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
