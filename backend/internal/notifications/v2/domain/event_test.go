package domain_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

func TestParseEventType(t *testing.T) {
	cases := []struct {
		in      string
		wantD   string
		wantA   string
		wantErr bool
	}{
		{"artefact.blocked", "artefact", "blocked", false},
		{"mention.created", "mention", "created", false},
		{"users.password_changed", "users", "password_changed", false},
		// Invalid forms.
		{"invalid", "", "", true},
		{"", "", "", true},
		{".action", "", "", true},
		{"domain.", "", "", true},
	}
	for _, c := range cases {
		et, err := domain.ParseEventType(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseEventType(%q): want error, got nil", c.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseEventType(%q): unexpected error: %v", c.in, err)
			continue
		}
		if et.Domain != c.wantD || et.Action != c.wantA {
			t.Errorf("ParseEventType(%q): got %+v, want {%q,%q}", c.in, et, c.wantD, c.wantA)
		}
		// Round-trip via String().
		if et.String() != c.in {
			t.Errorf("EventType.String() round-trip: got %q want %q", et.String(), c.in)
		}
	}
}

func TestEventValidate(t *testing.T) {
	subID := uuid.New()
	userID := uuid.New()
	wsID := uuid.New()
	nodeID := uuid.New()

	cases := []struct {
		name    string
		ev      domain.Event
		wantErr bool
	}{
		{
			name: "valid direct",
			ev: domain.Event{
				EventKey:        "k1",
				Priority:        domain.PriorityMedium,
				FanoutMode:      domain.FanoutDirect,
				SubscriptionID:  &subID,
				RecipientUserID: &userID,
			},
			wantErr: false,
		},
		{
			name: "direct missing recipient",
			ev: domain.Event{
				EventKey:       "k2",
				Priority:       domain.PriorityMedium,
				FanoutMode:     domain.FanoutDirect,
				SubscriptionID: &subID,
				// RecipientUserID intentionally missing
			},
			wantErr: true,
		},
		{
			name: "valid workspace",
			ev: domain.Event{
				EventKey:       "k3",
				Priority:       domain.PriorityMedium,
				FanoutMode:     domain.FanoutWorkspace,
				SubscriptionID: &subID,
				WorkspaceID:    &wsID,
			},
			wantErr: false,
		},
		{
			name: "platform with subscription set",
			ev: domain.Event{
				EventKey:       "k4",
				Priority:       domain.PriorityCritical,
				FanoutMode:     domain.FanoutPlatform,
				SubscriptionID: &subID, // must be nil for platform
			},
			wantErr: true,
		},
		{
			name: "valid platform",
			ev: domain.Event{
				EventKey:     "k5",
				Priority:     domain.PriorityCritical,
				FanoutMode:   domain.FanoutPlatform,
				SentBySystem: true,
			},
			wantErr: false,
		},
		{
			name: "topology_subtree missing node",
			ev: domain.Event{
				EventKey:       "k6",
				Priority:       domain.PriorityHigh,
				FanoutMode:     domain.FanoutTopologySubtree,
				SubscriptionID: &subID,
				// TopologyNodeID intentionally missing
			},
			wantErr: true,
		},
		{
			name: "valid topology_subtree",
			ev: domain.Event{
				EventKey:       "k7",
				Priority:       domain.PriorityHigh,
				FanoutMode:     domain.FanoutTopologySubtree,
				SubscriptionID: &subID,
				TopologyNodeID: &nodeID,
			},
			wantErr: false,
		},
		{
			name: "sent_by_system with user",
			ev: domain.Event{
				EventKey:     "k8",
				Priority:     domain.PriorityHigh,
				FanoutMode:   domain.FanoutPlatform,
				SentBySystem: true,
				SentByUserID: &userID, // mutually exclusive
			},
			wantErr: true,
		},
		{
			name: "missing event_key",
			ev: domain.Event{
				// EventKey intentionally empty
				Priority:        domain.PriorityMedium,
				FanoutMode:      domain.FanoutDirect,
				SubscriptionID:  &subID,
				RecipientUserID: &userID,
			},
			wantErr: true,
		},
		{
			name: "invalid priority",
			ev: domain.Event{
				EventKey:        "k9",
				Priority:        domain.Priority("bogus"),
				FanoutMode:      domain.FanoutDirect,
				SubscriptionID:  &subID,
				RecipientUserID: &userID,
			},
			wantErr: true,
		},
		{
			name: "valid tenant fanout",
			ev: domain.Event{
				EventKey:       "k10",
				Priority:       domain.PriorityLow,
				FanoutMode:     domain.FanoutTenant,
				SubscriptionID: &subID,
			},
			wantErr: false,
		},
		{
			name: "tenant missing subscription",
			ev: domain.Event{
				EventKey:   "k11",
				Priority:   domain.PriorityLow,
				FanoutMode: domain.FanoutTenant,
				// SubscriptionID intentionally nil
			},
			wantErr: true,
		},
		{
			name: "valid topology_node",
			ev: domain.Event{
				EventKey:       "k12",
				Priority:       domain.PriorityHigh,
				FanoutMode:     domain.FanoutTopologyNode,
				SubscriptionID: &subID,
				TopologyNodeID: &nodeID,
			},
			wantErr: false,
		},
		{
			name: "direct missing subscription",
			ev: domain.Event{
				EventKey:        "k13",
				Priority:        domain.PriorityMedium,
				FanoutMode:      domain.FanoutDirect,
				RecipientUserID: &userID,
				// SubscriptionID intentionally nil
			},
			wantErr: true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.ev.Validate()
			if c.wantErr && err == nil {
				t.Errorf("want error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
