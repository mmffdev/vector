//go:build integration

package broker_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broker"
)

// rabbitURL pulls AMQP_URL from env. If unset, the test SKIPS (not fails) —
// per spec, integration tests gracefully no-op when infra isn't available.
func rabbitURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("AMQP_URL")
	if url == "" {
		t.Skip("AMQP_URL not set — skipping real-rabbit integration test")
	}
	return url
}

func TestRabbitBroker_PublishConsumeRoundtrip(t *testing.T) {
	url := rabbitURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	b, err := broker.NewRabbitBroker(ctx, url, nil)
	if err != nil {
		t.Fatalf("NewRabbitBroker: %v", err)
	}
	defer b.Close()

	// Random message ID so we don't conflict with other test runs.
	msgID := "test-" + uuid.NewString()
	payload, _ := json.Marshal(map[string]string{"hello": msgID})
	env := broker.Envelope{
		MessageID:  msgID,
		RoutingKey: broker.RoutingKey("test", "roundtrip", broker.ChannelInApp),
		Payload:    payload,
	}

	// Start consumer in a goroutine BEFORE publish so we don't race the
	// first message into a queue with no listener (durable queue would
	// buffer it; explicit ordering removes ambiguity).
	received := make(chan broker.Envelope, 1)
	var consumeErr error
	var wg sync.WaitGroup
	wg.Add(1)
	consumeCtx, consumeCancel := context.WithCancel(ctx)
	go func() {
		defer wg.Done()
		consumeErr = b.Consume(consumeCtx, broker.QueueName(broker.ChannelInApp),
			broker.BindingPattern(broker.ChannelInApp),
			func(_ context.Context, e broker.Envelope) error {
				if e.MessageID == msgID {
					received <- e
				}
				// Ack everything — drains any stale messages from previous
				// test runs cleanly.
				return nil
			})
	}()

	// Give consumer a beat to start.
	time.Sleep(200 * time.Millisecond)

	if err := b.Publish(ctx, env); err != nil {
		consumeCancel()
		t.Fatalf("Publish: %v", err)
	}

	select {
	case got := <-received:
		if got.MessageID != msgID {
			t.Errorf("MessageID mismatch: got %q want %q", got.MessageID, msgID)
		}
		if string(got.Payload) != string(payload) {
			t.Errorf("Payload mismatch: got %q want %q", got.Payload, payload)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for message round-trip")
	}

	consumeCancel()
	wg.Wait()
	if consumeErr != nil && consumeErr != context.Canceled {
		t.Errorf("consume returned unexpected error: %v", consumeErr)
	}
}

func TestNoopBroker_PublishReturnsUnavailable(t *testing.T) {
	b := broker.NewNoopBroker(nil)
	err := b.Publish(context.Background(), broker.Envelope{
		MessageID:  "x",
		RoutingKey: "x.x.x",
		Payload:    []byte("{}"),
	})
	if err != broker.ErrBrokerUnavailable {
		t.Errorf("expected ErrBrokerUnavailable, got %v", err)
	}
}

func TestTopologyHelpers(t *testing.T) {
	cases := []struct {
		channel  string
		wantQ    string
		wantBind string
	}{
		{broker.ChannelInApp, "notifications.v2.in_app", "*.*.in_app"},
		{broker.ChannelSSE, "notifications.v2.sse", "*.*.sse"},
		{broker.ChannelEmail, "notifications.v2.email", "*.*.email"},
		{broker.ChannelPush, "notifications.v2.push", "*.*.push"},
		{broker.ChannelSlack, "notifications.v2.slack", "*.*.slack"},
		{broker.ChannelSMS, "notifications.v2.sms", "*.*.sms"},
	}
	for _, c := range cases {
		if got := broker.QueueName(c.channel); got != c.wantQ {
			t.Errorf("QueueName(%q): got %q want %q", c.channel, got, c.wantQ)
		}
		if got := broker.BindingPattern(c.channel); got != c.wantBind {
			t.Errorf("BindingPattern(%q): got %q want %q", c.channel, got, c.wantBind)
		}
	}

	if got := broker.RoutingKey("artefact", "blocked", broker.ChannelEmail); got != "artefact.blocked.email" {
		t.Errorf("RoutingKey: got %q want %q", got, "artefact.blocked.email")
	}
	_ = fmt.Sprint(broker.AllChannels)
}
