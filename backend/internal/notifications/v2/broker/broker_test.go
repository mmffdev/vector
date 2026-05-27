package broker_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/mmffdev/vector-backend/internal/notifications/v2/broker"
)

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
