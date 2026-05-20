package broker

import (
	"context"
	"log/slog"
)

// NoopBroker is the fallback used when AMQP_URL is unset. Publish
// returns ErrBrokerUnavailable so the relay can log and retry; the
// outbox row stays unclaimed-or-undelivered, which is exactly the
// behaviour we want for "broker not configured yet". Consume blocks
// forever (waiting on ctx) so a dispatcher started against the
// no-op broker doesn't busy-loop.
type NoopBroker struct {
	Logger *slog.Logger
}

func NewNoop(logger *slog.Logger) *NoopBroker {
	return &NoopBroker{Logger: logger}
}

func (n *NoopBroker) Publish(ctx context.Context, env Envelope) error {
	if n.Logger != nil {
		n.Logger.Debug("notifications.broker: publish (noop)",
			"routing_key", env.RoutingKey,
			"message_id", env.MessageID,
		)
	}
	return ErrBrokerUnavailable
}

func (n *NoopBroker) Consume(ctx context.Context, queueName, routingKeyPattern string, handler Handler) error {
	if n.Logger != nil {
		n.Logger.Info("notifications.broker: consume blocked (noop)",
			"queue", queueName, "pattern", routingKeyPattern)
	}
	<-ctx.Done()
	return ctx.Err()
}

func (n *NoopBroker) Close() error { return nil }
