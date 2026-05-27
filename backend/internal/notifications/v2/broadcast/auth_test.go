package broadcast_test

// Unit tests for broadcast auth functions.
// Uses stub implementations of RoleChecker and GrantChecker — no DB required.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/broadcast"
)

// ---- stubs ----

type stubRoles struct {
	globalAdmins  map[uuid.UUID]bool
	platformAdmins map[uuid.UUID]bool
	subAdmins     map[uuid.UUID]map[uuid.UUID]bool // userID → subID → bool
}

func (s *stubRoles) IsGlobalAdmin(_ context.Context, userID uuid.UUID) (bool, error) {
	return s.globalAdmins[userID], nil
}

func (s *stubRoles) IsPlatformAdmin(_ context.Context, userID uuid.UUID) (bool, error) {
	return s.platformAdmins[userID], nil
}

func (s *stubRoles) IsSubscriptionAdmin(_ context.Context, userID, subscriptionID uuid.UUID) (bool, error) {
	if subs, ok := s.subAdmins[userID]; ok {
		return subs[subscriptionID], nil
	}
	return false, nil
}

type stubGrants struct {
	grants map[string]bool // key: "tenant:user:node"
}

func grantKey(tenantID, userID, nodeID uuid.UUID) string {
	return tenantID.String() + ":" + userID.String() + ":" + nodeID.String()
}

func (s *stubGrants) GrantOnNode(_ context.Context, tenantID, userID, nodeID, _ uuid.UUID) (bool, error) {
	return s.grants[grantKey(tenantID, userID, nodeID)], nil
}

// errRoles returns errors from role lookups (tests error propagation path).
type errRoles struct{ err error }

func (e *errRoles) IsGlobalAdmin(_ context.Context, _ uuid.UUID) (bool, error) { return false, e.err }
func (e *errRoles) IsPlatformAdmin(_ context.Context, _ uuid.UUID) (bool, error) {
	return false, e.err
}
func (e *errRoles) IsSubscriptionAdmin(_ context.Context, _, _ uuid.UUID) (bool, error) {
	return false, e.err
}

// ---- CheckPlatformAuth ----

func TestCheckPlatformAuth_Allowed(t *testing.T) {
	gadminID := uuid.New()
	roles := &stubRoles{
		globalAdmins: map[uuid.UUID]bool{gadminID: true},
	}
	if err := broadcast.CheckPlatformAuth(context.Background(), gadminID, roles); err != nil {
		t.Errorf("expected nil, got: %v", err)
	}
}

func TestCheckPlatformAuth_Rejected_NotGadmin(t *testing.T) {
	userID := uuid.New()
	roles := &stubRoles{globalAdmins: map[uuid.UUID]bool{}}
	err := broadcast.CheckPlatformAuth(context.Background(), userID, roles)
	if !errors.Is(err, broadcast.ErrNotAuthorized) {
		t.Errorf("expected ErrNotAuthorized, got: %v", err)
	}
}

func TestCheckPlatformAuth_RoleError(t *testing.T) {
	roles := &errRoles{err: errors.New("db down")}
	err := broadcast.CheckPlatformAuth(context.Background(), uuid.New(), roles)
	if err == nil || errors.Is(err, broadcast.ErrNotAuthorized) {
		t.Errorf("expected a non-ErrNotAuthorized error on role checker failure, got: %v", err)
	}
}

// ---- CheckTopologyAuth ----

func TestCheckTopologyAuth_GadminWithGrant(t *testing.T) {
	gadminID := uuid.New()
	nodeID := uuid.New()
	tenantID := uuid.New()
	roleID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{gadminID: true},
		platformAdmins: map[uuid.UUID]bool{},
	}
	grants := &stubGrants{grants: map[string]bool{
		grantKey(tenantID, gadminID, nodeID): true,
	}}

	if err := broadcast.CheckTopologyAuth(context.Background(), gadminID, nodeID, tenantID, roleID, roles, grants); err != nil {
		t.Errorf("expected nil, got: %v", err)
	}
}

func TestCheckTopologyAuth_PadminWithGrant(t *testing.T) {
	padminID := uuid.New()
	nodeID := uuid.New()
	tenantID := uuid.New()
	roleID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{},
		platformAdmins: map[uuid.UUID]bool{padminID: true},
	}
	grants := &stubGrants{grants: map[string]bool{
		grantKey(tenantID, padminID, nodeID): true,
	}}

	if err := broadcast.CheckTopologyAuth(context.Background(), padminID, nodeID, tenantID, roleID, roles, grants); err != nil {
		t.Errorf("expected nil, got: %v", err)
	}
}

func TestCheckTopologyAuth_PadminWithoutGrant(t *testing.T) {
	padminID := uuid.New()
	nodeID := uuid.New()
	tenantID := uuid.New()
	roleID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{},
		platformAdmins: map[uuid.UUID]bool{padminID: true},
	}
	grants := &stubGrants{grants: map[string]bool{}} // no grant

	err := broadcast.CheckTopologyAuth(context.Background(), padminID, nodeID, tenantID, roleID, roles, grants)
	if !errors.Is(err, broadcast.ErrNotAuthorized) {
		t.Errorf("expected ErrNotAuthorized, got: %v", err)
	}
}

func TestCheckTopologyAuth_RegularUser_Rejected(t *testing.T) {
	userID := uuid.New()
	nodeID := uuid.New()
	tenantID := uuid.New()
	roleID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{},
		platformAdmins: map[uuid.UUID]bool{},
	}
	grants := &stubGrants{grants: map[string]bool{
		grantKey(tenantID, userID, nodeID): true, // has a grant but wrong role tier
	}}

	err := broadcast.CheckTopologyAuth(context.Background(), userID, nodeID, tenantID, roleID, roles, grants)
	if !errors.Is(err, broadcast.ErrNotAuthorized) {
		t.Errorf("expected ErrNotAuthorized for regular user, got: %v", err)
	}
}

// ---- CheckTenantAuth ----

func TestCheckTenantAuth_SubAdmin(t *testing.T) {
	adminID := uuid.New()
	subID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{},
		platformAdmins: map[uuid.UUID]bool{},
		subAdmins:     map[uuid.UUID]map[uuid.UUID]bool{adminID: {subID: true}},
	}

	if err := broadcast.CheckTenantAuth(context.Background(), adminID, subID, roles); err != nil {
		t.Errorf("expected nil, got: %v", err)
	}
}

func TestCheckTenantAuth_Gadmin(t *testing.T) {
	gadminID := uuid.New()
	subID := uuid.New()

	roles := &stubRoles{
		globalAdmins: map[uuid.UUID]bool{gadminID: true},
	}

	if err := broadcast.CheckTenantAuth(context.Background(), gadminID, subID, roles); err != nil {
		t.Errorf("expected nil for gadmin, got: %v", err)
	}
}

func TestCheckTenantAuth_RegularUser_Rejected(t *testing.T) {
	userID := uuid.New()
	subID := uuid.New()

	roles := &stubRoles{
		globalAdmins:  map[uuid.UUID]bool{},
		platformAdmins: map[uuid.UUID]bool{},
		subAdmins:     map[uuid.UUID]map[uuid.UUID]bool{},
	}

	err := broadcast.CheckTenantAuth(context.Background(), userID, subID, roles)
	if !errors.Is(err, broadcast.ErrNotAuthorized) {
		t.Errorf("expected ErrNotAuthorized, got: %v", err)
	}
}
