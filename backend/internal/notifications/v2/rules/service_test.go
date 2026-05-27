//go:build integration

package rules_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
)

func TestService_CreateAndGet(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	subID := realSubscriptionID(t, pool)
	suffix := uuid.New().String()[:8]

	input := rules.CreateInput{
		SubscriptionID: subID,
		Name:           "test rule " + suffix,
		EventType:      "artefact.created",
		LogicalOp:      rules.LogicalOpAND,
		Conditions: []rules.Condition{
			{Field: "actor.role", Operator: rules.OperatorEq, Value: "gadmin"},
		},
		Channels: []domain.Channel{domain.ChannelInApp, domain.ChannelEmail},
		Schedule: rules.ScheduleImmediate,
		Enabled:  true,
	}

	created, err := svc.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { _ = svc.Delete(context.Background(), created.ID) })

	if created.ID == uuid.Nil {
		t.Error("Create: got zero ID")
	}
	if created.Name != input.Name {
		t.Errorf("Create: Name = %q, want %q", created.Name, input.Name)
	}
	if created.LogicalOp != rules.LogicalOpAND {
		t.Errorf("Create: LogicalOp = %q, want AND", created.LogicalOp)
	}
	if len(created.Conditions) != 1 {
		t.Errorf("Create: Conditions count = %d, want 1", len(created.Conditions))
	}
	if len(created.Channels) != 2 {
		t.Errorf("Create: Channels count = %d, want 2", len(created.Channels))
	}

	// Get round-trip.
	fetched, err := svc.Get(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if fetched.ID != created.ID {
		t.Errorf("Get: ID mismatch %v != %v", fetched.ID, created.ID)
	}
}

func TestService_Get_NotFound(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)

	_, err := svc.Get(context.Background(), uuid.New())
	if err != rules.ErrRuleNotFound {
		t.Errorf("Get missing: want ErrRuleNotFound, got %v", err)
	}
}

func TestService_Update(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	subID := realSubscriptionID(t, pool)
	suffix := uuid.New().String()[:8]

	created, err := svc.Create(context.Background(), rules.CreateInput{
		SubscriptionID: subID,
		Name:           "original " + suffix,
		EventType:      "artefact.updated",
		LogicalOp:      rules.LogicalOpAND,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{domain.ChannelInApp},
		Schedule:       rules.ScheduleImmediate,
		Enabled:        true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() { _ = svc.Delete(context.Background(), created.ID) })

	newName := "updated name " + suffix
	newEnabled := false
	updated, err := svc.Update(context.Background(), created.ID, rules.UpdateInput{
		Name:    &newName,
		Enabled: &newEnabled,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != newName {
		t.Errorf("Update: Name = %q, want %q", updated.Name, newName)
	}
	if updated.Enabled {
		t.Error("Update: Enabled should be false after update")
	}
	// Unmodified field preserved.
	if updated.EventType != "artefact.updated" {
		t.Errorf("Update: EventType changed unexpectedly: %q", updated.EventType)
	}
}

func TestService_Update_NotFound(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)

	name := "new name"
	_, err := svc.Update(context.Background(), uuid.New(), rules.UpdateInput{
		Name: &name,
	})
	if err != rules.ErrRuleNotFound {
		t.Errorf("Update missing: want ErrRuleNotFound, got %v", err)
	}
}

func TestService_Delete(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	subID := realSubscriptionID(t, pool)
	suffix := uuid.New().String()[:8]

	created, err := svc.Create(context.Background(), rules.CreateInput{
		SubscriptionID: subID,
		Name:           "to delete " + suffix,
		EventType:      "artefact.deleted",
		LogicalOp:      rules.LogicalOpAND,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{},
		Schedule:       rules.ScheduleImmediate,
		Enabled:        true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := svc.Delete(context.Background(), created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	_, err = svc.Get(context.Background(), created.ID)
	if err != rules.ErrRuleNotFound {
		t.Errorf("Get after Delete: want ErrRuleNotFound, got %v", err)
	}
}

func TestService_Delete_NotFound(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)

	err := svc.Delete(context.Background(), uuid.New())
	if err != rules.ErrRuleNotFound {
		t.Errorf("Delete missing: want ErrRuleNotFound, got %v", err)
	}
}

func TestService_List(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	subID := realSubscriptionID(t, pool)
	suffix := uuid.New().String()[:8]
	eventType := "test.list_" + suffix

	// Create two rules for the same subscription+event_type.
	r1, err := svc.Create(context.Background(), rules.CreateInput{
		SubscriptionID: subID,
		Name:           "list rule 1 " + suffix,
		EventType:      eventType,
		LogicalOp:      rules.LogicalOpAND,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{domain.ChannelInApp},
		Schedule:       rules.ScheduleImmediate,
		Enabled:        true,
	})
	if err != nil {
		t.Fatalf("Create r1: %v", err)
	}
	t.Cleanup(func() { _ = svc.Delete(context.Background(), r1.ID) })

	r2, err := svc.Create(context.Background(), rules.CreateInput{
		SubscriptionID: subID,
		Name:           "list rule 2 " + suffix,
		EventType:      eventType,
		LogicalOp:      rules.LogicalOpOR,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{domain.ChannelEmail},
		Schedule:       rules.ScheduleDigest,
		Enabled:        false,
	})
	if err != nil {
		t.Fatalf("Create r2: %v", err)
	}
	t.Cleanup(func() { _ = svc.Delete(context.Background(), r2.ID) })

	// List all for the subscription + event type.
	all, err := svc.List(context.Background(), rules.ListFilter{
		SubscriptionID: subID,
		EventType:      eventType,
	})
	if err != nil {
		t.Fatalf("List all: %v", err)
	}
	if len(all) < 2 {
		t.Errorf("List all: expected >= 2, got %d", len(all))
	}

	// List only enabled.
	enabled, err := svc.List(context.Background(), rules.ListFilter{
		SubscriptionID: subID,
		EventType:      eventType,
		EnabledOnly:    true,
	})
	if err != nil {
		t.Fatalf("List enabled: %v", err)
	}
	for _, r := range enabled {
		if !r.Enabled {
			t.Errorf("List enabled: returned disabled rule %v", r.ID)
		}
	}
}

func TestService_Create_Validation(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	subID := realSubscriptionID(t, pool)

	tests := []struct {
		name    string
		input   rules.CreateInput
		wantErr error
	}{
		{
			name: "missing name",
			input: rules.CreateInput{
				SubscriptionID: subID,
				Name:           "",
				EventType:      "artefact.created",
				LogicalOp:      rules.LogicalOpAND,
				Conditions:     nil,
				Channels:       nil,
				Schedule:       rules.ScheduleImmediate,
				Enabled:        true,
			},
			wantErr: rules.ErrMissingName,
		},
		{
			name: "missing event type",
			input: rules.CreateInput{
				SubscriptionID: subID,
				Name:           "rule",
				EventType:      "",
				LogicalOp:      rules.LogicalOpAND,
				Conditions:     nil,
				Channels:       nil,
				Schedule:       rules.ScheduleImmediate,
				Enabled:        true,
			},
			wantErr: rules.ErrMissingEventType,
		},
		{
			name: "invalid logical op",
			input: rules.CreateInput{
				SubscriptionID: subID,
				Name:           "rule",
				EventType:      "artefact.created",
				LogicalOp:      "NAND",
				Conditions:     nil,
				Channels:       nil,
				Schedule:       rules.ScheduleImmediate,
				Enabled:        true,
			},
			wantErr: rules.ErrInvalidLogicalOp,
		},
		{
			name: "invalid schedule",
			input: rules.CreateInput{
				SubscriptionID: subID,
				Name:           "rule",
				EventType:      "artefact.created",
				LogicalOp:      rules.LogicalOpAND,
				Conditions:     nil,
				Channels:       nil,
				Schedule:       "weekly",
				Enabled:        true,
			},
			wantErr: rules.ErrInvalidSchedule,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.Create(context.Background(), tc.input)
			if err != tc.wantErr {
				t.Errorf("Create: want %v, got %v", tc.wantErr, err)
			}
		})
	}
}
