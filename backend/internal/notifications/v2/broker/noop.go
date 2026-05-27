package broker

import (
	"context"
	"log/slog"
)

// NoopBroker is the fallback used when AMQP_URL is empty. Returns
// ErrBrokerUnavailable from Publish so the relay can log + park
// rows for later retry. Consume blocks on ctx but never calls the
// handler — useful for letting the server boot in test rigs and CI
// environments that don't have RabbitMQ available.
type NoopBroker struct {
	logger *slog.Logger
}

// NewNoopBroker constructs a NoopBroker. logger may be nil; if nil,
// slog.Default() is used.
func NewNoopBroker(logger *slog.Logger) *NoopBroker {
	if logger == nil {
		logger = slog.Default()
	}
	return &NoopBroker{logger: logger}
}

func (n *NoopBroker) Publish(ctx context.Context, env Envelope) error {
	n.logger.Debug("v2 noop broker: publish dropped",
		"routing_key", env.RoutingKey,
		"message_id", env.MessageID,
	)
	return ErrBrokerUnavailable
}

func (n *NoopBroker) Consume(ctx context.Context, queueName, pattern string, handler Handler) error {
	n.logger.Warn("v2 noop broker: consume disabled — AMQP_URL not set",
		"queue", queueName,
		"pattern", pattern,
	)
	<-ctx.Done()
	return ctx.Err()
}

func (n *NoopBroker) Close() error {
	return nil
}
