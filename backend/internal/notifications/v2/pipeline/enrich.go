package pipeline

import (
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// enrichEvent guarantees that event.Data is non-nil and contains the
// canonical metadata fields that all downstream template interpolations
// and rule conditions can rely on.
//
// Fields already set by the producer are NOT overwritten; this function
// only fills in gaps.
//
// The brief (Task 4.3) restricts S06 to cheap metadata that is available
// directly on the Event struct. Broad domain hydration (rich labels from
// FKs, user display names, etc.) is a producer responsibility or a future
// enrichment story.
func enrichEvent(event domain.Event) domain.Event {
	if event.Data == nil {
		event.Data = make(map[string]any)
	}

	// setIfMissing only writes the key when it is absent or nil.
	setIfMissing := func(key string, val any) {
		if v, exists := event.Data[key]; !exists || v == nil {
			event.Data[key] = val
		}
	}

	// event_id — always the canonical UUID string.
	setIfMissing("event_id", event.ID.String())

	// event_type — canonical "<domain>.<action>" string.
	setIfMissing("event_type", event.Type.String())

	// priority — string value.
	setIfMissing("priority", string(event.Priority))

	// subscription_id — may be nil for platform events.
	if event.SubscriptionID != nil {
		setIfMissing("subscription_id", event.SubscriptionID.String())
	}

	// workspace_id — optional; only set when present on the event.
	if event.WorkspaceID != nil {
		setIfMissing("workspace_id", event.WorkspaceID.String())
	}

	// topology_node_id — optional.
	if event.TopologyNodeID != nil {
		setIfMissing("topology_node_id", event.TopologyNodeID.String())
	}

	// sent_by_user_id — optional (nil when sent_by_system=true).
	if event.SentByUserID != nil {
		setIfMissing("sent_by_user_id", event.SentByUserID.String())
	}

	// sent_by_system — always written (false is still meaningful).
	setIfMissing("sent_by_system", event.SentBySystem)

	return event
}
