package realtime

import (
	"testing"

	"github.com/google/uuid"
)

// Hub tests cover the in-memory fan-out contract: subscribers receive
// messages on their topic, do not receive messages on topics they did
// not subscribe to, slow consumers don't stall the publisher, and
// topicAllowed enforces per-tenant isolation by rejecting any subscribe
// whose subscription_id segment doesn't match the connection's bound
// subscription_id.
//
// We construct Clients directly (zero value + pre-sized send chan)
// because the WebSocket handshake is irrelevant to the hub semantics.

func newTestClient(subID uuid.UUID, capacity int) *Client {
	return &Client{
		subscriptionID: subID,
		send:           make(chan []byte, capacity),
	}
}

func TestHub_Subscribe_DeliversToTopicSubscribers(t *testing.T) {
	hub := NewHub()
	subA := uuid.New()
	a := newTestClient(subA, 8)
	b := newTestClient(subA, 8)

	topic := TopicForRank("work_item", subA, "backlog", nil)
	hub.Subscribe(topic, a)
	hub.Subscribe(topic, b)

	hub.Publish(topic, []byte(`{"hello":"world"}`))

	for i, c := range []*Client{a, b} {
		select {
		case msg := <-c.send:
			if string(msg) != `{"hello":"world"}` {
				t.Fatalf("client %d got %q", i, msg)
			}
		default:
			t.Fatalf("client %d received no message", i)
		}
	}
}

func TestHub_Publish_DoesNotLeakAcrossTopics(t *testing.T) {
	hub := NewHub()
	subA := uuid.New()
	a := newTestClient(subA, 8)
	b := newTestClient(subA, 8)

	scopeA := uuid.New()
	scopeB := uuid.New()
	topicA := TopicForRank("work_item", subA, "sprint", &scopeA)
	topicB := TopicForRank("work_item", subA, "sprint", &scopeB)

	hub.Subscribe(topicA, a)
	hub.Subscribe(topicB, b)

	hub.Publish(topicA, []byte("for-A"))
	hub.Publish(topicB, []byte("for-B"))

	if got := <-a.send; string(got) != "for-A" {
		t.Fatalf("a got %q want for-A", got)
	}
	if got := <-b.send; string(got) != "for-B" {
		t.Fatalf("b got %q want for-B", got)
	}
	// Neither client should have a second message.
	select {
	case msg := <-a.send:
		t.Fatalf("a leaked: %q", msg)
	default:
	}
	select {
	case msg := <-b.send:
		t.Fatalf("b leaked: %q", msg)
	default:
	}
}

func TestHub_Publish_DropsSlowConsumer(t *testing.T) {
	hub := NewHub()
	subA := uuid.New()
	slow := newTestClient(subA, 1) // cap 1 so the second send blocks
	topic := TopicForRank("work_item", subA, "backlog", nil)
	hub.Subscribe(topic, slow)

	hub.Publish(topic, []byte("first"))
	// This second publish would block forever on a naive
	// implementation. The hub must drop it instead.
	hub.Publish(topic, []byte("second"))

	if got := <-slow.send; string(got) != "first" {
		t.Fatalf("got %q want first", got)
	}
	select {
	case msg := <-slow.send:
		t.Fatalf("slow client should not have got %q (publisher must drop)", msg)
	default:
	}
}

func TestHub_UnsubscribeAll_RemovesFromEveryTopic(t *testing.T) {
	hub := NewHub()
	subA := uuid.New()
	c := newTestClient(subA, 8)

	t1 := TopicForRank("work_item", subA, "backlog", nil)
	scope := uuid.New()
	t2 := TopicForRank("work_item", subA, "sprint", &scope)
	hub.Subscribe(t1, c)
	hub.Subscribe(t2, c)
	hub.UnsubscribeAll(c)

	hub.Publish(t1, []byte("one"))
	hub.Publish(t2, []byte("two"))
	select {
	case msg := <-c.send:
		t.Fatalf("got %q after UnsubscribeAll", msg)
	default:
	}
}

// topicAllowed enforces tenant isolation. A client bound to
// subscription A must not be allowed to subscribe to a topic whose
// third colon-separated segment is some other subscription's id.
func TestClient_TopicAllowed_RejectsCrossTenant(t *testing.T) {
	subA := uuid.New()
	subB := uuid.New()
	c := newTestClient(subA, 8)

	own := TopicForRank("work_item", subA, "backlog", nil)
	other := TopicForRank("work_item", subB, "backlog", nil)

	if !c.topicAllowed(own) {
		t.Fatalf("client should be allowed on own topic %q", own)
	}
	if c.topicAllowed(other) {
		t.Fatalf("client must NOT be allowed on cross-tenant topic %q", other)
	}
	if c.topicAllowed("garbage") {
		t.Fatalf("malformed topic must be rejected")
	}
}
