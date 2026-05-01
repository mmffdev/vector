// Package realtime implements the WebSocket fan-out for cross-cutting
// platform notifications (rank changes, work-item writes, future
// resources). One Hub serves every connected client; subscriptions are
// keyed by a free-form topic string ("rank:<resource_type>:<scope>").
//
// Design intent:
//   - Per-tenant isolation: every connection is bound to a SubscriptionID
//     at handshake; topic strings always include subscription_id so a
//     malicious subscriber cannot snoop on another tenant.
//   - Resource-agnostic: the hub knows nothing about work items vs
//     defects vs portfolio levels — payloads are opaque JSON.
//   - Cheap fan-out: subscribers are kept in slices keyed by topic;
//     publish copies the slice under read-lock and writes outside the
//     lock to avoid head-of-line blocking.
package realtime

import (
	"sync"

	"github.com/google/uuid"
)

// Hub is the in-memory subscription registry + fan-out. Safe for
// concurrent use.
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[*Client]struct{} // topic -> set of subscribers
}

// NewHub returns an empty Hub.
func NewHub() *Hub {
	return &Hub{subs: map[string]map[*Client]struct{}{}}
}

// Subscribe registers c as a subscriber to topic. Idempotent.
func (h *Hub) Subscribe(topic string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set, ok := h.subs[topic]
	if !ok {
		set = map[*Client]struct{}{}
		h.subs[topic] = set
	}
	set[c] = struct{}{}
}

// Unsubscribe removes c from topic. Empty topic sets are pruned so
// memory doesn't grow unbounded for transient subscriptions.
func (h *Hub) Unsubscribe(topic string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set, ok := h.subs[topic]
	if !ok {
		return
	}
	delete(set, c)
	if len(set) == 0 {
		delete(h.subs, topic)
	}
}

// UnsubscribeAll removes c from every topic it was on. Called on
// connection close.
func (h *Hub) UnsubscribeAll(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for topic, set := range h.subs {
		if _, ok := set[c]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.subs, topic)
			}
		}
	}
}

// Publish copies the subscriber list under read-lock then writes to
// each subscriber's send channel. A slow subscriber that fills its
// channel is dropped silently — better to lose one client than block
// the publisher loop.
func (h *Hub) Publish(topic string, payload []byte) {
	h.mu.RLock()
	set := h.subs[topic]
	clients := make([]*Client, 0, len(set))
	for c := range set {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		select {
		case c.send <- payload:
		default:
			// Slow consumer — drop the message rather than the whole
			// publisher. The client will reconcile via refetch on
			// the next message it does receive.
		}
	}
}

// TopicForRank returns the canonical topic string for a rank-change
// notification. Format: "rank:<resource_type>:<subscription_id>:<scope>:<scope_id>".
// scope_id is "" for backlog scope (one global cohort per tenant).
func TopicForRank(resourceType string, subscriptionID uuid.UUID, scope string, scopeID *uuid.UUID) string {
	sid := ""
	if scopeID != nil {
		sid = scopeID.String()
	}
	return "rank:" + resourceType + ":" + subscriptionID.String() + ":" + scope + ":" + sid
}
