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

// RabbitBroker is the production AMQP transport for v2. It shares the
// topic exchange "notifications" with v1 (idempotent re-declare) but
// owns its own set of durable queues under "notifications.v2.<channel>".
//
// Connection recovery mirrors v1's pattern: a single underlying
// connection is held; every Publish or Consume call opens a fresh
// channel, so a channel-level error (e.g. precondition-failed) does
// not poison the connection. The connection itself is reconnected on
// demand.
type RabbitBroker struct {
	url    string
	logger *slog.Logger

	mu   sync.Mutex
	conn *amqp.Connection
}

// NewRabbitBroker dials the AMQP URL, declares the topic exchange
// "notifications", and declares + binds all six v2 channel queues.
// If the dial or any declaration fails, an error is returned — the
// caller should fall back to NoopBroker.
func NewRabbitBroker(ctx context.Context, url string, logger *slog.Logger) (*RabbitBroker, error) {
	if logger == nil {
		logger = slog.Default()
	}
	rb := &RabbitBroker{url: url, logger: logger}
	if err := rb.connect(ctx); err != nil {
		return nil, fmt.Errorf("v2 broker amqp dial: %w", err)
	}
	if err := rb.declareTopology(); err != nil {
		_ = rb.Close()
		return nil, fmt.Errorf("v2 broker declare topology: %w", err)
	}
	logger.Info("notifications.v2.broker: rabbit connected",
		"exchange", ExchangeName,
		"queues", len(AllChannels),
	)
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

// declareTopology declares the exchange and all six v2 channel queues
// with their bindings. Called once at construction; safe to call
// concurrently via the per-call channel pattern.
func (r *RabbitBroker) declareTopology() error {
	ch, err := r.channel()
	if err != nil {
		return err
	}
	defer ch.Close()

	// Declare the shared topic exchange. Re-declaring with identical
	// properties is a no-op in RabbitMQ — v1 may have already created it.
	if err := ch.ExchangeDeclare(
		ExchangeName,
		"topic",
		true,  // durable — survives broker restart
		false, // not auto-deleted
		false, // not internal
		false, // wait
		nil,
	); err != nil {
		return fmt.Errorf("declare exchange %q: %w", ExchangeName, err)
	}

	// Declare all six v2 queues and bind them.
	for _, channel := range AllChannels {
		qName := QueueName(channel)
		pattern := BindingPattern(channel)

		if _, err := ch.QueueDeclare(
			qName,
			true,  // durable
			false, // not auto-deleted
			false, // not exclusive
			false, // wait
			nil,
		); err != nil {
			return fmt.Errorf("declare queue %q: %w", qName, err)
		}

		if err := ch.QueueBind(qName, pattern, ExchangeName, false, nil); err != nil {
			return fmt.Errorf("bind queue %q to pattern %q: %w", qName, pattern, err)
		}
	}
	return nil
}

// Publish sends one envelope. The envelope is JSON-marshalled into
// the AMQP body; the routing key is taken from env.RoutingKey.
// A fresh channel is opened per Publish — this is safe and mirrors
// v1's pattern.
func (r *RabbitBroker) Publish(ctx context.Context, env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}
	ch, err := r.channel()
	if err != nil {
		return fmt.Errorf("open publish channel: %w", err)
	}
	defer ch.Close()
	return ch.PublishWithContext(
		ctx,
		ExchangeName,
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

// Consume opens a dedicated channel for the given queue, sets QoS
// prefetch, and dispatches each incoming message to handler. Blocks
// until ctx is cancelled.
//
// The handler runs synchronously per delivery. For concurrency, run
// multiple goroutines each calling Consume with the same queueName —
// RabbitMQ load-balances across consumers on the same queue.
func (r *RabbitBroker) Consume(ctx context.Context, queueName, routingKeyPattern string, handler Handler) error {
	ch, err := r.channel()
	if err != nil {
		return fmt.Errorf("open consume channel: %w", err)
	}
	defer ch.Close()

	// Prefetch 16 — matches v1's value; keeps latency low without
	// flooding any one consumer.
	if err := ch.Qos(16, 0, false); err != nil {
		return fmt.Errorf("set qos: %w", err)
	}

	deliveries, err := ch.Consume(
		queueName,
		"",    // auto-generate consumer tag
		false, // manual ack — handler decides per message
		false, // not exclusive
		false, // no-local (unused on rabbit)
		false, // wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("start consume on %q: %w", queueName, err)
	}

	r.logger.Info("notifications.v2.broker: consuming",
		"queue", queueName, "pattern", routingKeyPattern)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("delivery channel closed for queue %q", queueName)
			}
			var env Envelope
			if err := json.Unmarshal(d.Body, &env); err != nil {
				r.logger.Error("notifications.v2.broker: bad envelope — dropping",
					"queue", queueName, "err", err)
				_ = d.Nack(false, false) // drop — bad payload, no requeue
				continue
			}
			if err := handler(ctx, env); err != nil {
				r.logger.Warn("notifications.v2.broker: handler error, nacking",
					"queue", queueName, "routing_key", env.RoutingKey, "err", err)
				_ = d.Nack(false, true) // requeue — transient failure
				continue
			}
			_ = d.Ack(false)
		}
	}
}

// Close shuts the AMQP connection cleanly. Called once at server shutdown.
func (r *RabbitBroker) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conn == nil || r.conn.IsClosed() {
		return nil
	}
	return r.conn.Close()
}
