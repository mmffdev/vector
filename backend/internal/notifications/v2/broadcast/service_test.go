//go:build integration

package broadcast_test

// Integration tests for broadcast.Service.
// Requires a live vector_artefacts DB with the S01 migrations applied.
// Skip (not fail) if pool cannot connect.
//
// Test cases (per plan Task 6):
//   - Broadcast(workspace) writes 1 event + N recipients atomically
//   - Broadcast(topology_subtree) includes descendant users
//   - Broadcast(platform) event has id_subscription IS NULL
//   - PreviewRecipientCount(workspace) returns N, writes zero rows
//   - Auth rejection returns ErrNotAuthorized, writes zero rows
//   - DryRun=true returns RecipientCount, writes zero rows
//   - Snapshot semantics: adding a user after broadcast does NOT add a recipient row

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broadcast"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ---- stub auth for service tests ----

// allAllowedRoles permits everything (for "happy path" tests).
type allAllowedRoles struct{}

func (a *allAllowedRoles) IsGlobalAdmin(_ context.Context, _ uuid.UUID) (bool, error)   { return true, nil }
func (a *allAllowedRoles) IsPlatformAdmin(_ context.Context, _ uuid.UUID) (bool, error) { return true, nil }
func (a *allAllowedRoles) IsSubscriptionAdmin(_ context.Context, _, _ uuid.UUID) (bool, error) {
	return true, nil
}

// allAllowedGrants grants everything.
type allAllowedGrants struct{}

func (a *allAllowedGrants) GrantOnNode(_ context.Context, _, _, _, _ uuid.UUID) (bool, error) {
	return true, nil
}

// noGrants denies all grant checks.
type noGrants struct{}

func (n *noGrants) GrantOnNode(_ context.Context, _, _, _, _ uuid.UUID) (bool, error) {
	return false, nil
}

// noRoles denies all role checks.
type noRoles struct{}

func (n *noRoles) IsGlobalAdmin(_ context.Context, _ uuid.UUID) (bool, error)   { return false, nil }
func (n *noRoles) IsPlatformAdmin(_ context.Context, _ uuid.UUID) (bool, error) { return false, nil }
func (n *noRoles) IsSubscriptionAdmin(_ context.Context, _, _ uuid.UUID) (bool, error) {
	return false, nil
}

// ---- tests ----

// TestBroadcastWorkspace verifies the workspace fan-out mode writes
// 1 event row + N recipient rows atomically.
func TestBroadcastWorkspace(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, u1)
	mkGrantOnWorkspace(t, pool, wsID, subID, u2)

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentByUserID:   u1, // use a real user ID to satisfy FK
		EventType:      domain.EventType{Domain: "test", Action: "workspace_broadcast"},
		Priority:       domain.PriorityMedium,
		Data:           map[string]any{"msg": "hello workspace"},
		Mode:           domain.FanoutWorkspace,
		SubscriptionID: &subID,
		WorkspaceID:    &wsID,
		TenantID:       subID,
		ActorRoleID:    uuid.New(),
		EventKey:       "test-ws-broadcast-" + uuid.NewString(),
	}

	result, err := svc.Broadcast(ctx, req)
	if err != nil {
		t.Fatalf("Broadcast(workspace): %v", err)
	}
	if result.EventID == uuid.Nil {
		t.Fatal("expected non-nil EventID")
	}
	if result.RecipientCount != 2 {
		t.Errorf("RecipientCount: got %d want 2", result.RecipientCount)
	}

	// Verify DB rows
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_event_recipients WHERE notifications_event_recipients_id_event = $1`,
		result.EventID,
	).Scan(&count); err != nil {
		t.Fatalf("count recipients: %v", err)
	}
	if count != 2 {
		t.Errorf("DB recipient rows: got %d want 2", count)
	}

	// Verify resolved_at is set on event row
	var resolvedAtIsNull bool
	if err := pool.QueryRow(ctx,
		`SELECT notifications_events_v2_resolved_at IS NULL FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`,
		result.EventID,
	).Scan(&resolvedAtIsNull); err != nil {
		t.Fatalf("check resolved_at: %v", err)
	}
	if resolvedAtIsNull {
		t.Error("expected resolved_at to be non-NULL after broadcast")
	}

	// Verify recipient_count on event row
	var eventRecipientCount int
	if err := pool.QueryRow(ctx,
		`SELECT notifications_events_v2_recipient_count FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`,
		result.EventID,
	).Scan(&eventRecipientCount); err != nil {
		t.Fatalf("check recipient_count: %v", err)
	}
	if eventRecipientCount != 2 {
		t.Errorf("event recipient_count: got %d want 2", eventRecipientCount)
	}

	// Cleanup: remove the event + recipients
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, result.EventID)
	})
}

// TestBroadcastTopologySubtree verifies that a subtree broadcast captures
// users granted on descendant nodes.
func TestBroadcastTopologySubtree(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, rootNodeID, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	childNode := mkChildNode(t, pool, wsID, subID, rootNodeID, "Child-subtree-svc")
	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)
	mkGrantOnNode(t, pool, wsID, subID, rootNodeID, u1)
	mkGrantOnNode(t, pool, wsID, subID, childNode, u2)

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentByUserID:   u1, // real user for FK
		EventType:      domain.EventType{Domain: "test", Action: "subtree_broadcast"},
		Priority:       domain.PriorityHigh,
		Data:           map[string]any{},
		Mode:           domain.FanoutTopologySubtree,
		SubscriptionID: &subID,
		TopologyNodeID: &rootNodeID,
		TenantID:       subID,
		ActorRoleID:    uuid.New(),
		EventKey:       "test-subtree-broadcast-" + uuid.NewString(),
	}

	result, err := svc.Broadcast(ctx, req)
	if err != nil {
		t.Fatalf("Broadcast(topology_subtree): %v", err)
	}
	if result.RecipientCount != 2 {
		t.Errorf("RecipientCount: got %d want 2", result.RecipientCount)
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, result.EventID)
	})
}

// TestBroadcastPlatform verifies the platform event has id_subscription IS NULL.
func TestBroadcastPlatform(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentBySystem: true, // system-originated platform broadcast — no user FK needed
		EventType:    domain.EventType{Domain: "test", Action: "platform_broadcast"},
		Priority:     domain.PriorityLow,
		Data:         map[string]any{},
		Mode:         domain.FanoutPlatform,
		// SubscriptionID intentionally nil for platform
		ActorRoleID: uuid.New(),
		EventKey:    "test-platform-broadcast-" + uuid.NewString(),
	}

	result, err := svc.Broadcast(ctx, req)
	if err != nil {
		t.Fatalf("Broadcast(platform): %v", err)
	}

	// Verify id_subscription IS NULL on event row
	var subIDIsNull bool
	if err := pool.QueryRow(ctx,
		`SELECT notifications_events_v2_id_subscription IS NULL FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`,
		result.EventID,
	).Scan(&subIDIsNull); err != nil {
		t.Fatalf("check subscription on platform event: %v", err)
	}
	if !subIDIsNull {
		t.Error("platform broadcast event should have NULL id_subscription")
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, result.EventID)
	})
}

// TestPreviewRecipientCount verifies that preview does not write any rows.
func TestPreviewRecipientCount(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, u1)
	mkGrantOnWorkspace(t, pool, wsID, subID, u2)

	// Record event count before preview
	var beforeCount int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&beforeCount)

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentBySystem:   true, // no FK needed — preview writes nothing anyway
		EventType:      domain.EventType{Domain: "test", Action: "preview_test"},
		Priority:       domain.PriorityLow,
		Data:           map[string]any{},
		Mode:           domain.FanoutWorkspace,
		SubscriptionID: &subID,
		WorkspaceID:    &wsID,
		TenantID:       subID,
		ActorRoleID:    uuid.New(),
		EventKey:       "test-preview-" + uuid.NewString(),
	}

	n, err := svc.PreviewRecipientCount(ctx, req)
	if err != nil {
		t.Fatalf("PreviewRecipientCount: %v", err)
	}
	if n != 2 {
		t.Errorf("preview count: got %d want 2", n)
	}

	// Verify no event rows were written
	var afterCount int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&afterCount)
	if afterCount != beforeCount {
		t.Errorf("PreviewRecipientCount wrote %d event rows (expected 0 new rows)", afterCount-beforeCount)
	}
}

// TestBroadcastAuthRejection verifies that an unauthorized actor causes zero DB writes.
func TestBroadcastAuthRejection(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, u1)

	// Record state before
	var beforeEvents int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&beforeEvents)

	resolver := broadcast.NewResolver(pool)
	// noRoles denies all role checks → platform broadcast should be rejected
	svc := broadcast.NewService(pool, resolver, &noRoles{}, &noGrants{})

	req := broadcast.BroadcastRequest{
		SentByUserID: u1, // real user; auth will still be rejected by noRoles
		EventType:    domain.EventType{Domain: "test", Action: "auth_rejection_test"},
		Priority:     domain.PriorityLow,
		Data:         map[string]any{},
		Mode:         domain.FanoutPlatform,
		ActorRoleID:  uuid.New(),
		EventKey:     "test-auth-rejection-" + uuid.NewString(),
	}

	_, err := svc.Broadcast(ctx, req)
	if err == nil {
		t.Fatal("expected error from unauthorized broadcast, got nil")
	}
	if !isUnauthorizedError(err) {
		t.Errorf("expected ErrNotAuthorized (or wrapping it), got: %v", err)
	}

	// Verify no event rows were written
	var afterEvents int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&afterEvents)
	if afterEvents != beforeEvents {
		t.Errorf("auth rejection wrote %d unexpected event rows", afterEvents-beforeEvents)
	}
}

// TestBroadcastDryRun verifies that DryRun=true returns count without writes.
func TestBroadcastDryRun(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	u2 := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, u1)
	mkGrantOnWorkspace(t, pool, wsID, subID, u2)

	var beforeEvents int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&beforeEvents)

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentBySystem:   true, // no FK needed — dryrun writes nothing
		EventType:      domain.EventType{Domain: "test", Action: "dryrun_test"},
		Priority:       domain.PriorityMedium,
		Data:           map[string]any{},
		Mode:           domain.FanoutWorkspace,
		SubscriptionID: &subID,
		WorkspaceID:    &wsID,
		TenantID:       subID,
		ActorRoleID:    uuid.New(),
		EventKey:       "test-dryrun-" + uuid.NewString(),
		DryRun:         true,
	}

	result, err := svc.Broadcast(ctx, req)
	if err != nil {
		t.Fatalf("Broadcast(dryrun): %v", err)
	}
	if result.EventID != uuid.Nil {
		t.Errorf("DryRun: expected EventID=uuid.Nil, got %s", result.EventID)
	}
	if result.RecipientCount != 2 {
		t.Errorf("DryRun RecipientCount: got %d want 2", result.RecipientCount)
	}

	// Verify no DB rows written
	var afterEvents int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1`,
		subID,
	).Scan(&afterEvents)
	if afterEvents != beforeEvents {
		t.Errorf("DryRun wrote %d unexpected event rows", afterEvents-beforeEvents)
	}
}

// TestBroadcastSnapshotSemantics verifies that adding a user AFTER broadcast
// does NOT add a recipient row for them retroactively (decision #12).
func TestBroadcastSnapshotSemantics(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	subID, wsID, _, cleanup := mkFixtureTenant(t, pool)
	t.Cleanup(cleanup)

	u1 := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, u1)

	resolver := broadcast.NewResolver(pool)
	svc := broadcast.NewService(pool, resolver, &allAllowedRoles{}, &allAllowedGrants{})

	req := broadcast.BroadcastRequest{
		SentByUserID:   u1, // real user for FK
		EventType:      domain.EventType{Domain: "test", Action: "snapshot_test"},
		Priority:       domain.PriorityMedium,
		Data:           map[string]any{},
		Mode:           domain.FanoutWorkspace,
		SubscriptionID: &subID,
		WorkspaceID:    &wsID,
		TenantID:       subID,
		ActorRoleID:    uuid.New(),
		EventKey:       "test-snapshot-" + uuid.NewString(),
	}

	result, err := svc.Broadcast(ctx, req)
	if err != nil {
		t.Fatalf("Broadcast(snapshot): %v", err)
	}

	// Verify exactly 1 recipient at fire time
	var countBefore int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_event_recipients WHERE notifications_event_recipients_id_event = $1`,
		result.EventID,
	).Scan(&countBefore)
	if countBefore != 1 {
		t.Errorf("expected 1 recipient before adding late user, got %d", countBefore)
	}

	// Add a new user to the workspace AFTER the broadcast
	lateUser := mkFixtureUser(t, pool, subID)
	mkGrantOnWorkspace(t, pool, wsID, subID, lateUser)

	// Verify the recipient count on the event did NOT change
	var countAfter int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications_event_recipients WHERE notifications_event_recipients_id_event = $1`,
		result.EventID,
	).Scan(&countAfter)
	if countAfter != 1 {
		t.Errorf("snapshot violated: late user caused recipient count to change from 1 to %d", countAfter)
	}

	// Also verify the late user is NOT in the recipient rows
	var lateUserInRecipients bool
	pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM notifications_event_recipients WHERE notifications_event_recipients_id_event = $1 AND notifications_event_recipients_id_user = $2)`,
		result.EventID, lateUser,
	).Scan(&lateUserInRecipients)
	if lateUserInRecipients {
		t.Error("SNAPSHOT VIOLATION: late user appeared in recipients after broadcast resolved")
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notifications_events_v2 WHERE notifications_events_v2_id = $1`, result.EventID)
	})
}

// isUnauthorizedError checks if err is or wraps broadcast.ErrNotAuthorized.
func isUnauthorizedError(err error) bool {
	if err == nil {
		return false
	}
	// errors.Is unwraps the chain (fmt.Errorf %w wrapping is handled).
	return errors.Is(err, broadcast.ErrNotAuthorized)
}
