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

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// Hub is the in-memory subscription registry + fan-out. Safe for
// concurrent use.
//
// B16.8.12 added the session registry alongside the topic-subscription
// map. The registry is conceptually part of the hub's lifecycle: every
// connection the hub fans out to is also a connection the sweeper must
// be able to evict. Keeping them together means ServeWS imports one
// package and main.go wires one object.
type Hub struct {
	mu       sync.RWMutex
	subs     map[string]map[*Client]struct{} // topic -> set of subscribers
	registry *SessionRegistry
}

// NewHub returns an empty Hub with a fresh SessionRegistry. Production
// callers use this; tests can also use it because the registry is
// harmless when no sweeper is started.
func NewHub() *Hub {
	return NewHubWithRegistry(NewSessionRegistry())
}

// NewHubWithRegistry lets the caller inject a pre-built SessionRegistry.
// Used by main.go to share one registry between the hub and the
// sweeper goroutine; also used by integration tests that need a
// handle on the registry to assert against.
func NewHubWithRegistry(registry *SessionRegistry) *Hub {
	return &Hub{
		subs:     map[string]map[*Client]struct{}{},
		registry: registry,
	}
}

// Registry returns the SessionRegistry the hub registers connections
// with. Exposed so ServeWS can call Register/Deregister; the future
// B16.8.10 revoke endpoint should prefer the higher-level CloseSession
// wrapper below.
func (h *Hub) Registry() *SessionRegistry {
	return h.registry
}

// CloseSession is the immediate-close surface the future B16.8.10
// revoke endpoint calls right after the SQL UPDATE commits — fires the
// matching socket's close hook synchronously so the user does not wait
// up to WS_SESSION_CHECK_INTERVAL for the sweeper to notice. Thin
// passthrough to the registry; kept on Hub so handlers can wire a
// single dependency.
func (h *Hub) CloseSession(sid uuid.UUID, code websocket.StatusCode, reason string) {
	if h.registry == nil {
		return
	}
	h.registry.CloseSession(sid, code, reason)
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
