package broker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// exchangeName is the single topic exchange the notifications system
// publishes to. Routing keys are `<kind>.<channel>` (e.g.
// "mention.in_app", "mention.email"). Consumers bind queues with
// patterns like "mention.*" or "*.in_app" to slice the stream.
const exchangeName = "notifications"

// RabbitBroker is the production AMQP transport. Survives connection
// drops via the channel-recovery loop in newAMQPChannel: every
// Publish or Consume call gets a fresh channel if the previous one
// went bad. The underlying connection is reconnected on demand by
// the dialer goroutine.
type RabbitBroker struct {
	url    string
	logger *slog.Logger

	mu   sync.Mutex
	conn *amqp.Connection
}

// New dials the broker and declares the notifications topic
// exchange. Returns an error if the dial fails — the caller (main.go)
// should fall back to NoopBroker in that case.
func New(ctx context.Context, url string, logger *slog.Logger) (*RabbitBroker, error) {
	if logger == nil {
		logger = slog.Default()
	}
	rb := &RabbitBroker{url: url, logger: logger}
	if err := rb.connect(ctx); err != nil {
		return nil, fmt.Errorf("amqp dial: %w", err)
	}
	if err := rb.declareExchange(); err != nil {
		_ = rb.Close()
		return nil, fmt.Errorf("declare exchange: %w", err)
	}
	logger.Info("notifications.broker: rabbit connected", "exchange", exchangeName)
	return rb, nil
}

func (r *RabbitBroker) connect(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn != nil && !r.conn.IsClosed() {
		return nil
	}
	dialer := amqp.Config{
		Heartbeat: 10 * time.Second,
		Locale:    "en_US",
	}
	conn, err := amqp.DialConfig(r.url, dialer)
	if err != nil {
		return err
	}
	r.conn = conn
	return nil
}

func (r *RabbitBroker) channel() (*amqp.Channel, error) {
	r.mu.Lock()
	conn := r.conn
	r.mu.Unlock()
	if conn == nil || conn.IsClosed() {
		if err := r.connect(context.Background()); err != nil {
			return nil, err
		}
		r.mu.Lock()
		conn = r.conn
		r.mu.Unlock()
	}
	return conn.Channel()
}

func (r *RabbitBroker) declareExchange() error {
	ch, err := r.channel()
	if err != nil {
		return err
	}
	defer ch.Close()
	return ch.ExchangeDeclare(
		exchangeName,
		"topic",
		true,  // durable — survives broker restart
		false, // not auto-deleted
		false, // not internal
		false, // wait
		nil,
	)
}

// Publish sends one envelope. The envelope is JSON-marshalled into
// the AMQP body; the routing key is taken from env.RoutingKey.
func (r *RabbitBroker) Publish(ctx context.Context, env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}
	ch, err := r.channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	defer ch.Close()
	return ch.PublishWithContext(
		ctx,
		exchangeName,
		env.RoutingKey,
		false, // not mandatory — undeliverable messages drop silently
		false, // not immediate (deprecated in modern AMQP)
		amqp.Publishing{
			ContentType:  "application/json",
			Body:         body,
			DeliveryMode: amqp.Persistent, // survives broker restart
			MessageId:    env.MessageID,
			Timestamp:    time.Now(),
		},
	)
}

// Consume declares a durable queue, binds it to the topic exchange
// with the given routing-key pattern, and dispatches each incoming
// message to handler. Returns when ctx is cancelled.
//
// The handler runs synchronously per delivery — if you need
// concurrency, run multiple goroutines, each calling Consume with
// the same queueName (RMQ load-balances across consumers).
func (r *RabbitBroker) Consume(ctx context.Context, queueName, routingKeyPattern string, handler Handler) error {
	ch, err := r.channel()
	if err != nil {
		return fmt.Errorf("open consume channel: %w", err)
	}
	defer ch.Close()

	q, err := ch.QueueDeclare(
		queueName,
		true,  // durable
		false, // not auto-deleted
		false, // not exclusive
		false, // wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("declare queue %q: %w", queueName, err)
	}
	if err := ch.QueueBind(q.Name, routingKeyPattern, exchangeName, false, nil); err != nil {
		return fmt.Errorf("bind queue %q to pattern %q: %w", queueName, routingKeyPattern, err)
	}
	// Prefetch 16 — keeps latency low without flooding any one consumer.
	if err := ch.Qos(16, 0, false); err != nil {
		return fmt.Errorf("set qos: %w", err)
	}

	deliveries, err := ch.Consume(
		q.Name,
		"",    // auto-generate consumer tag
		false, // manual ack — handler decides per message
		false, // not exclusive
		false, // no-local (unused on rabbit)
		false, // wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("start consume: %w", err)
	}

	r.logger.Info("notifications.broker: consuming",
		"queue", q.Name, "pattern", routingKeyPattern)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("delivery channel closed")
			}
			var env Envelope
			if err := json.Unmarshal(d.Body, &env); err != nil {
				r.logger.Error("notifications.broker: bad envelope",
					"queue", q.Name, "err", err)
				_ = d.Nack(false, false) // drop — bad payload, no requeue
				continue
			}
			if err := handler(ctx, env); err != nil {
				r.logger.Warn("notifications.broker: handler error, nacking",
					"queue", q.Name, "routing_key", env.RoutingKey, "err", err)
				_ = d.Nack(false, true) // requeue — transient failure
				continue
			}
			_ = d.Ack(false)
		}
	}
}

// Close shuts the broker connection. Called once at server shutdown.
func (r *RabbitBroker) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn == nil || r.conn.IsClosed() {
		return nil
	}
	return r.conn.Close()
}
