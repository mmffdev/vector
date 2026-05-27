package pipeline

import (
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

func TestEnrichEvent_NilDataInitialised(t *testing.T) {
	sub := uuid.New()
	event := domain.Event{
		ID:             uuid.New(),
		Type:           domain.EventType{Domain: "artefact", Action: "created"},
		Priority:       domain.PriorityMedium,
		FanoutMode:     domain.FanoutDirect,
		SubscriptionID: &sub,
		Data:           nil, // intentionally nil
	}

	out := enrichEvent(event)

	if out.Data == nil {
		t.Fatal("enrichEvent: Data must not be nil after enrichment")
	}
	if out.Data["event_id"] == nil {
		t.Error("event_id must be set")
	}
	if out.Data["event_type"] != "artefact.created" {
		t.Errorf("event_type: want artefact.created, got %v", out.Data["event_type"])
	}
	if out.Data["priority"] != "medium" {
		t.Errorf("priority: want medium, got %v", out.Data["priority"])
	}
	if out.Data["subscription_id"] != sub.String() {
		t.Errorf("subscription_id: want %s, got %v", sub, out.Data["subscription_id"])
	}
	if v, ok := out.Data["sent_by_system"]; !ok || v != false {
		t.Errorf("sent_by_system: want false, got %v", v)
	}
}

func TestEnrichEvent_PrefilledDataNotOverwritten(t *testing.T) {
	sub := uuid.New()
	customID := "custom-event-id"
	event := domain.Event{
		ID:             uuid.New(),
		Type:           domain.EventType{Domain: "artefact", Action: "updated"},
		Priority:       domain.PriorityHigh,
		FanoutMode:     domain.FanoutTenant,
		SubscriptionID: &sub,
		Data: map[string]any{
			"event_id":   customID, // producer-supplied; must not be overwritten
			"custom_key": "custom_value",
		},
	}

	out := enrichEvent(event)

	if out.Data["event_id"] != customID {
		t.Errorf("event_id: producer value must not be overwritten; want %s, got %v", customID, out.Data["event_id"])
	}
	if out.Data["custom_key"] != "custom_value" {
		t.Error("custom_key: must be preserved")
	}
	// Non-prefilled fields must still be injected.
	if out.Data["event_type"] != "artefact.updated" {
		t.Errorf("event_type must be injected; got %v", out.Data["event_type"])
	}
}

func TestEnrichEvent_OptionalUUIDsHandled(t *testing.T) {
	// Platform event: SubscriptionID nil, WorkspaceID nil, TopologyNodeID nil.
	event := domain.Event{
		ID:           uuid.New(),
		Type:         domain.EventType{Domain: "platform", Action: "broadcast"},
		Priority:     domain.PriorityCritical,
		FanoutMode:   domain.FanoutPlatform,
		SentBySystem: true,
		Data:         nil,
	}

	out := enrichEvent(event)

	// Nil UUIDs must NOT inject a nil or zero-string key.
	if _, ok := out.Data["subscription_id"]; ok {
		t.Errorf("subscription_id must not be set for platform events, got %v", out.Data["subscription_id"])
	}
	if _, ok := out.Data["workspace_id"]; ok {
		t.Errorf("workspace_id must not be set when nil, got %v", out.Data["workspace_id"])
	}
	if _, ok := out.Data["topology_node_id"]; ok {
		t.Errorf("topology_node_id must not be set when nil, got %v", out.Data["topology_node_id"])
	}
	if _, ok := out.Data["sent_by_user_id"]; ok {
		t.Errorf("sent_by_user_id must not be set when nil, got %v", out.Data["sent_by_user_id"])
	}
	if out.Data["sent_by_system"] != true {
		t.Errorf("sent_by_system: want true, got %v", out.Data["sent_by_system"])
	}
}

func TestEnrichEvent_AllOptionalFieldsSet(t *testing.T) {
	sub := uuid.New()
	ws := uuid.New()
	node := uuid.New()
	sender := uuid.New()

	event := domain.Event{
		ID:              uuid.New(),
		Type:            domain.EventType{Domain: "risk", Action: "created"},
		Priority:        domain.PriorityHigh,
		FanoutMode:      domain.FanoutTopologySubtree,
		SubscriptionID:  &sub,
		WorkspaceID:     &ws,
		TopologyNodeID:  &node,
		SentByUserID:    &sender,
		SentBySystem:    false,
		Data:            nil,
	}

	out := enrichEvent(event)

	if out.Data["workspace_id"] != ws.String() {
		t.Errorf("workspace_id: want %s, got %v", ws, out.Data["workspace_id"])
	}
	if out.Data["topology_node_id"] != node.String() {
		t.Errorf("topology_node_id: want %s, got %v", node, out.Data["topology_node_id"])
	}
	if out.Data["sent_by_user_id"] != sender.String() {
		t.Errorf("sent_by_user_id: want %s, got %v", sender, out.Data["sent_by_user_id"])
	}
}
