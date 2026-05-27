//go:build integration

package broker_test

import (
	"context"
	"encoding/json"
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

	msgID := "test-" + uuid.NewString()
	payload, _ := json.Marshal(map[string]string{"hello": msgID})
	env := broker.Envelope{
		MessageID:  msgID,
		RoutingKey: broker.RoutingKey("test", "roundtrip", broker.ChannelInApp),
		Payload:    payload,
	}

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
				return nil
			})
	}()

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
