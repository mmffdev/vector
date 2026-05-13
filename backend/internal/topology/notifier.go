package topology

import (
	"encoding/json"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/realtime"
)

// TopicForHandoff returns the per-user realtime topic for Topology
// handoff events. Format: "topology:handoff:<user_id>". The frontend
// useTopologyHandoffs hook subscribes to this topic on login so a
// fresh grant arrives without a refetch.
//
// Topic includes user_id (not subscription_id) because the handoff
// is targeted at exactly one human; cross-tenant federations still
// resolve to one user-row per acting account so this remains
// correct even for cross-team grants.
func TopicForHandoff(userID uuid.UUID) string {
	return "topology:handoff:" + userID.String()
}

// HubNotifier adapts realtime.Hub to the GrantNotifier interface so
// the Service can publish handoff notifications without taking a
// direct dependency on the realtime package's wire shape. Instances
// are cheap; one per process is plenty.
type HubNotifier struct {
	Hub *realtime.Hub
}

// NotifyGrant marshals the GrantNotification to JSON and publishes
// it on the per-user handoff topic. JSON-marshal failures are
// silently dropped — a notification is best-effort and a stuck
// grant should never block the writing transaction.
func (h HubNotifier) NotifyGrant(userID uuid.UUID, payload GrantNotification) {
	if h.Hub == nil {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.Hub.Publish(TopicForHandoff(userID), body)
}
