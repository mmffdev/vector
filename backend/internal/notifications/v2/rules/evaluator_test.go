//go:build integration

package rules_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
)

// testPool returns a pool connected to the integration DB.
// Skips if DATABASE_URL is not set.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set — skipping integration test (dev swarm not running)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("pool.Ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// realSubscriptionID fetches one subscriptions_id for FK satisfaction.
func realSubscriptionID(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT subscriptions_id FROM subscriptions LIMIT 1`,
	).Scan(&id); err != nil {
		t.Fatalf("fetch subscriptions_id: %v", err)
	}
	return id
}

// insertTestRule inserts a rule directly and registers cleanup.
func insertTestRule(
	t *testing.T,
	pool *pgxpool.Pool,
	svc rules.Service,
	input rules.CreateInput,
) rules.Rule {
	t.Helper()
	r, err := svc.Create(context.Background(), input)
	if err != nil {
		t.Fatalf("Create rule: %v", err)
	}
	t.Cleanup(func() {
		_ = svc.Delete(context.Background(), r.ID)
	})
	return r
}

func TestEvaluator_MatchEvent_NoRules(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	ev := rules.NewEvaluator(pool)

	subID := realSubscriptionID(t, pool)
	eventType, _ := domain.ParseEventType("test.no_rules_" + uuid.New().String()[:8])
	e := domain.Event{
		EventKey:       "no-rules-test",
		Type:           eventType,
		Priority:       domain.PriorityLow,
		FanoutMode:     domain.FanoutTenant,
		SubscriptionID: &subID,
		SentBySystem:   true,
		Data:           map[string]any{"msg": "hello"},
	}

	matched, err := ev.MatchEvent(context.Background(), e)
	if err != nil {
		t.Fatalf("MatchEvent: %v", err)
	}
	if len(matched) != 0 {
		t.Errorf("expected 0 matches for fresh event type, got %d", len(matched))
	}
	// Verify the service is at least accessible.
	_ = svc
}

func TestEvaluator_MatchEvent_ANDConditions(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	ev := rules.NewEvaluator(pool)
	subID := realSubscriptionID(t, pool)

	suffix := uuid.New().String()[:8]
	eventTypeStr := "test.and_eval_" + suffix
	eventType, _ := domain.ParseEventType(eventTypeStr)

	// Rule: actor.role == "gadmin" AND item.priority == "high"
	r := insertTestRule(t, pool, svc, rules.CreateInput{
		SubscriptionID: subID,
		Name:           "AND rule " + suffix,
		EventType:      eventTypeStr,
		LogicalOp:      rules.LogicalOpAND,
		Conditions: []rules.Condition{
			{Field: "actor.role", Operator: rules.OperatorEq, Value: "gadmin"},
			{Field: "item.priority", Operator: rules.OperatorEq, Value: "high"},
		},
		Channels: []domain.Channel{domain.ChannelInApp},
		Schedule: rules.ScheduleImmediate,
		Enabled:  true,
	})
	_ = r

	mkEvent := func(data map[string]any) domain.Event {
		return domain.Event{
			EventKey:       uuid.New().String(),
			Type:           eventType,
			Priority:       domain.PriorityLow,
			FanoutMode:     domain.FanoutTenant,
			SubscriptionID: &subID,
			SentBySystem:   true,
			Data:           data,
		}
	}

	// Both conditions match → rule fires.
	matched, err := ev.MatchEvent(context.Background(), mkEvent(map[string]any{
		"actor": map[string]any{"role": "gadmin"},
		"item":  map[string]any{"priority": "high"},
	}))
	if err != nil {
		t.Fatalf("MatchEvent (both match): %v", err)
	}
	if len(matched) != 1 {
		t.Errorf("expected 1 match, got %d", len(matched))
	}

	// Only first condition matches → AND short-circuits, rule does not fire.
	matched, err = ev.MatchEvent(context.Background(), mkEvent(map[string]any{
		"actor": map[string]any{"role": "gadmin"},
		"item":  map[string]any{"priority": "low"},
	}))
	if err != nil {
		t.Fatalf("MatchEvent (partial match): %v", err)
	}
	if len(matched) != 0 {
		t.Errorf("expected 0 matches (AND partial), got %d", len(matched))
	}
}

func TestEvaluator_MatchEvent_ORConditions(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	ev := rules.NewEvaluator(pool)
	subID := realSubscriptionID(t, pool)

	suffix := uuid.New().String()[:8]
	eventTypeStr := "test.or_eval_" + suffix
	eventType, _ := domain.ParseEventType(eventTypeStr)

	// Rule: tier == "enterprise" OR tier == "premium"
	insertTestRule(t, pool, svc, rules.CreateInput{
		SubscriptionID: subID,
		Name:           "OR rule " + suffix,
		EventType:      eventTypeStr,
		LogicalOp:      rules.LogicalOpOR,
		Conditions: []rules.Condition{
			{Field: "tier", Operator: rules.OperatorEq, Value: "enterprise"},
			{Field: "tier", Operator: rules.OperatorEq, Value: "premium"},
		},
		Channels: []domain.Channel{domain.ChannelEmail},
		Schedule: rules.ScheduleImmediate,
		Enabled:  true,
	})

	mkEvent := func(data map[string]any) domain.Event {
		return domain.Event{
			EventKey:       uuid.New().String(),
			Type:           eventType,
			Priority:       domain.PriorityLow,
			FanoutMode:     domain.FanoutTenant,
			SubscriptionID: &subID,
			SentBySystem:   true,
			Data:           data,
		}
	}

	// OR: first condition matches → rule fires.
	matched, err := ev.MatchEvent(context.Background(), mkEvent(map[string]any{"tier": "enterprise"}))
	if err != nil {
		t.Fatalf("MatchEvent (OR first): %v", err)
	}
	if len(matched) != 1 {
		t.Errorf("expected 1 match (OR first), got %d", len(matched))
	}

	// OR: neither condition matches → rule does not fire.
	matched, err = ev.MatchEvent(context.Background(), mkEvent(map[string]any{"tier": "free"}))
	if err != nil {
		t.Fatalf("MatchEvent (OR none): %v", err)
	}
	if len(matched) != 0 {
		t.Errorf("expected 0 matches (OR none), got %d", len(matched))
	}
}

func TestEvaluator_MatchEvent_VacuousTruth(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	ev := rules.NewEvaluator(pool)
	subID := realSubscriptionID(t, pool)

	suffix := uuid.New().String()[:8]
	eventTypeStr := "test.vacuous_" + suffix
	eventType, _ := domain.ParseEventType(eventTypeStr)

	mkEvent := func() domain.Event {
		return domain.Event{
			EventKey:       uuid.New().String(),
			Type:           eventType,
			Priority:       domain.PriorityLow,
			FanoutMode:     domain.FanoutTenant,
			SubscriptionID: &subID,
			SentBySystem:   true,
			Data:           map[string]any{},
		}
	}

	// AND with zero conditions → always matches.
	insertTestRule(t, pool, svc, rules.CreateInput{
		SubscriptionID: subID,
		Name:           "AND-empty " + suffix,
		EventType:      eventTypeStr,
		LogicalOp:      rules.LogicalOpAND,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{domain.ChannelInApp},
		Schedule:       rules.ScheduleImmediate,
		Enabled:        true,
	})

	matched, err := ev.MatchEvent(context.Background(), mkEvent())
	if err != nil {
		t.Fatalf("MatchEvent (AND-empty): %v", err)
	}
	if len(matched) != 1 {
		t.Errorf("AND with zero conditions: expected 1 match (vacuous truth), got %d", len(matched))
	}
}

func TestEvaluator_MatchEvent_DisabledRuleSkipped(t *testing.T) {
	pool := testPool(t)
	svc := rules.NewService(pool)
	ev := rules.NewEvaluator(pool)
	subID := realSubscriptionID(t, pool)

	suffix := uuid.New().String()[:8]
	eventTypeStr := "test.disabled_" + suffix
	eventType, _ := domain.ParseEventType(eventTypeStr)

	// Create a disabled rule that would otherwise match.
	insertTestRule(t, pool, svc, rules.CreateInput{
		SubscriptionID: subID,
		Name:           "disabled rule " + suffix,
		EventType:      eventTypeStr,
		LogicalOp:      rules.LogicalOpAND,
		Conditions:     []rules.Condition{},
		Channels:       []domain.Channel{domain.ChannelInApp},
		Schedule:       rules.ScheduleImmediate,
		Enabled:        false, // disabled
	})

	e := domain.Event{
		EventKey:       uuid.New().String(),
		Type:           eventType,
		Priority:       domain.PriorityLow,
		FanoutMode:     domain.FanoutTenant,
		SubscriptionID: &subID,
		SentBySystem:   true,
		Data:           map[string]any{},
	}

	matched, err := ev.MatchEvent(context.Background(), e)
	if err != nil {
		t.Fatalf("MatchEvent (disabled): %v", err)
	}
	if len(matched) != 0 {
		t.Errorf("disabled rule must not match, got %d matches", len(matched))
	}
}

func TestEvaluator_MatchEvent_PlatformEvent_NoSubscription(t *testing.T) {
	pool := testPool(t)
	ev := rules.NewEvaluator(pool)

	eventType, _ := domain.ParseEventType("platform.broadcast")
	e := domain.Event{
		EventKey:       uuid.New().String(),
		Type:           eventType,
		Priority:       domain.PriorityLow,
		FanoutMode:     domain.FanoutPlatform,
		SubscriptionID: nil, // platform events have no subscription
		SentBySystem:   true,
		Data:           map[string]any{},
	}

	matched, err := ev.MatchEvent(context.Background(), e)
	if err != nil {
		t.Fatalf("MatchEvent (platform): %v", err)
	}
	if len(matched) != 0 {
		t.Errorf("platform event with no subscription should return 0 rules, got %d", len(matched))
	}
}
