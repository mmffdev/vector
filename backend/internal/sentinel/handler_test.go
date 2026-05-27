// Tests for PUT /sentinel/focus — the persistence side of the per-user
// default focus node (the "home topology node" set from the dropdown
// in app/user/account-settings/page.tsx).
//
// Four contract cases, all driven through the existing stubResolver
// from middleware_test.go so this file never touches a live DB:
//
//   1. Happy path        — actor has a grant on the node → 204, write captured
//   2. Clear             — body { "focus_node_id": null } → 204, write captured with nil
//   3. No grant          — actor has NO grant on the node → 403 problem+json, no write
//   4. Malformed UUID    — body { "focus_node_id": "not-a-uuid" } → 400, no write
//
// The handler also has an unauth path (no actor on ctx → 401) and a
// malformed-JSON path (400); those are covered inline at the end as
// quick contract pins rather than top-level test functions.

package sentinel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// fixtureNodeForFocus is the node-id PutFocus tests use as the target.
// Distinct from middleware_test.go fixtures so a grep for either is
// unambiguous.
var fixtureNodeForFocus = uuid.MustParse("12345678-1234-1234-1234-123456789012")

// ---------------------------------------------------------------------
// Case 1 — actor has grant → 204, SetUserDefaultFocus captured the uuid
// ---------------------------------------------------------------------

func TestPutFocus_Case1_HasGrant_204AndPersists(t *testing.T) {
	var captured *uuid.UUID
	resolver := &stubResolver{
		grantOnNodeFn: func(_ context.Context, tenant, userID, nodeID, _ uuid.UUID) (bool, error) {
			if tenant != fixtureTenantA {
				t.Errorf("GrantOnNode tenant = %s, want %s", tenant, fixtureTenantA)
			}
			if nodeID != fixtureNodeForFocus {
				t.Errorf("GrantOnNode nodeID = %s, want %s", nodeID, fixtureNodeForFocus)
			}
			_ = userID
			return true, nil
		},
		setUserDefaultFocusFn: func(_ context.Context, _ uuid.UUID, nodeID *uuid.UUID) error {
			captured = nodeID
			return nil
		},
	}

	h := NewHandler(resolver)
	body := strings.NewReader(`{"focus_node_id":"` + fixtureNodeForFocus.String() + `"}`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()

	h.PutFocus(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if captured == nil {
		t.Fatal("SetUserDefaultFocus was called with nil — expected the requested uuid")
	}
	if *captured != fixtureNodeForFocus {
		t.Errorf("SetUserDefaultFocus nodeID = %s, want %s", *captured, fixtureNodeForFocus)
	}
}

// ---------------------------------------------------------------------
// Case 2 — body focus_node_id:null → 204, SetUserDefaultFocus(nil)
// ---------------------------------------------------------------------
// Clearing the default is always allowed — no grant check fires.

func TestPutFocus_Case2_NullClearsAndSkipsGrantCheck(t *testing.T) {
	grantCalled := false
	var setCalled bool
	var capturedWasNil bool
	resolver := &stubResolver{
		grantOnNodeFn: func(_ context.Context, _, _, _, _ uuid.UUID) (bool, error) {
			grantCalled = true
			return true, nil // shouldn't be reached
		},
		setUserDefaultFocusFn: func(_ context.Context, _ uuid.UUID, nodeID *uuid.UUID) error {
			setCalled = true
			capturedWasNil = nodeID == nil
			return nil
		},
	}

	h := NewHandler(resolver)
	body := strings.NewReader(`{"focus_node_id":null}`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()

	h.PutFocus(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if grantCalled {
		t.Error("GrantOnNode was called for a clear — should be skipped")
	}
	if !setCalled {
		t.Fatal("SetUserDefaultFocus was NOT called for a clear")
	}
	if !capturedWasNil {
		t.Error("SetUserDefaultFocus received non-nil node — expected nil to clear the column")
	}
}

// ---------------------------------------------------------------------
// Case 3 — actor has no grant → 403 problem+json, no write
// ---------------------------------------------------------------------

func TestPutFocus_Case3_NoGrant_403AndNoWrite(t *testing.T) {
	setCalled := false
	resolver := &stubResolver{
		grantOnNodeFn: func(_ context.Context, _, _, _, _ uuid.UUID) (bool, error) {
			return false, nil
		},
		setUserDefaultFocusFn: func(_ context.Context, _ uuid.UUID, _ *uuid.UUID) error {
			setCalled = true
			return nil
		},
	}

	h := NewHandler(resolver)
	body := strings.NewReader(`{"focus_node_id":"` + fixtureNodeForFocus.String() + `"}`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()

	h.PutFocus(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if setCalled {
		t.Fatal("SetUserDefaultFocus ran despite the grant gate denying — must not write")
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
	var bodyMap map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &bodyMap); err != nil {
		t.Fatalf("body not JSON: %v (raw=%s)", err, rec.Body.String())
	}
	if bodyMap["type"] != "/errors/sentinel/focus-no-access" {
		t.Errorf("body.type = %v, want /errors/sentinel/focus-no-access", bodyMap["type"])
	}
}

// ---------------------------------------------------------------------
// Case 4 — malformed UUID in body → 400, no grant check, no write
// ---------------------------------------------------------------------

func TestPutFocus_Case4_MalformedUUID_400AndNoWrite(t *testing.T) {
	grantCalled := false
	setCalled := false
	resolver := &stubResolver{
		grantOnNodeFn: func(_ context.Context, _, _, _, _ uuid.UUID) (bool, error) {
			grantCalled = true
			return true, nil
		},
		setUserDefaultFocusFn: func(_ context.Context, _ uuid.UUID, _ *uuid.UUID) error {
			setCalled = true
			return nil
		},
	}

	h := NewHandler(resolver)
	body := strings.NewReader(`{"focus_node_id":"not-a-uuid"}`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()

	h.PutFocus(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if grantCalled {
		t.Error("GrantOnNode was called for malformed UUID — should fail validation earlier")
	}
	if setCalled {
		t.Error("SetUserDefaultFocus was called for malformed UUID — must not write")
	}
}

// ---------------------------------------------------------------------
// Quick contract pins — unauth + malformed JSON paths
// ---------------------------------------------------------------------

func TestPutFocus_NoActor_401(t *testing.T) {
	h := NewHandler(&stubResolver{})
	body := strings.NewReader(`{"focus_node_id":null}`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	// no withFixtureUser — actor missing from ctx
	rec := httptest.NewRecorder()

	// auth.UserFromCtx without a user must return nil; verify the test
	// environment matches before asserting.
	if auth.UserFromCtx(req.Context()) != nil {
		t.Fatal("test fixture invariant: auth.UserFromCtx with no actor should return nil")
	}

	h.PutFocus(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/problem+json") {
		t.Fatalf("expected application/problem+json, got %q", ct)
	}
}

func TestPutFocus_MalformedJSON_400(t *testing.T) {
	h := NewHandler(&stubResolver{})
	body := strings.NewReader(`{not-json`)
	req := httptest.NewRequest("PUT", "/sentinel/focus", body)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()

	h.PutFocus(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------
// GET /sentinel/boot — composition contract pins
// ---------------------------------------------------------------------
//
// Boot composes auth.LoadRoleAndPermissions + topology.ListMyGrants into
// a single SentinelBootPayload. Replaces the frontend bridge that paid
// a wasted /sentinel/boot 404 probe on every page load.
//
// Five cases cover the contract:
//   1. Happy path — actor + grants + tenant_root assembled correctly
//   2. No grants  — empty []grants, tenant_root="" (matches bridge)
//   3. Tenant root derives from topmost grant (no parent_id wins)
//   4. Unauth     — no actor on ctx → 401
//   5. Misconfigured — WithBootDeps never called → 500 + log

// bootFixtureRootNode is the topology-root node id used by Boot tests.
// Distinct from fixtureNodeForFocus so a grep finds either unambiguously.
var bootFixtureRootNode = uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

func TestBoot_Case1_HappyPath_AssemblesPayload(t *testing.T) {
	wantRoleCode := "tenant_admin"
	wantRoleID := uuid.MustParse("99999999-1111-2222-3333-999999999999")
	wantPerms := []string{"work_items.list", "work_items.write"}

	loadRolePerms := func(_ context.Context, _ uuid.UUID) (string, uuid.UUID, []string) {
		return wantRoleCode, wantRoleID, wantPerms
	}
	listGrants := func(_ context.Context, _, _, _ uuid.UUID) ([]BootGrant, error) {
		return []BootGrant{
			{
				NodeID:      bootFixtureRootNode,
				WorkspaceID: uuid.MustParse("33333333-3333-3333-3333-333333333333"),
				ParentID:    nil, // root: no parent
				Name:        "Tenant Root",
				Role:        "admin",
			},
		}, nil
	}
	h := NewHandler(&stubResolver{}).WithBootDeps(loadRolePerms, listGrants)

	req := httptest.NewRequest("GET", "/sentinel/boot", nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.Boot(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("expected application/json, got %q", ct)
	}
	var payload BootPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body not JSON: %v (raw=%s)", err, rec.Body.String())
	}
	if payload.User.ID != fixtureUserA().ID {
		t.Errorf("user.id = %s, want %s", payload.User.ID, fixtureUserA().ID)
	}
	if payload.User.Role != wantRoleCode {
		t.Errorf("user.role = %s, want %s", payload.User.Role, wantRoleCode)
	}
	if payload.User.RoleID != wantRoleID {
		t.Errorf("user.role_id = %s, want %s", payload.User.RoleID, wantRoleID)
	}
	if len(payload.User.Permissions) != 2 {
		t.Errorf("user.permissions = %v, want 2 entries", payload.User.Permissions)
	}
	if payload.Tenant.ID != fixtureTenantA {
		t.Errorf("tenant.id = %s, want %s", payload.Tenant.ID, fixtureTenantA)
	}
	if len(payload.Grants) != 1 {
		t.Fatalf("grants len = %d, want 1", len(payload.Grants))
	}
	if payload.TenantRoot != bootFixtureRootNode.String() {
		t.Errorf("tenant_root = %s, want %s", payload.TenantRoot, bootFixtureRootNode)
	}
}

func TestBoot_Case2_NoGrants_EmptySliceAndEmptyRoot(t *testing.T) {
	loadRolePerms := func(_ context.Context, _ uuid.UUID) (string, uuid.UUID, []string) {
		return "user", uuid.Nil, []string{}
	}
	listGrants := func(_ context.Context, _, _, _ uuid.UUID) ([]BootGrant, error) {
		return nil, nil // simulates a user with no grants
	}
	h := NewHandler(&stubResolver{}).WithBootDeps(loadRolePerms, listGrants)

	req := httptest.NewRequest("GET", "/sentinel/boot", nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.Boot(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// Verify the wire shape sends [] not null — frontend bridge produces
	// [] today and the SentinelProvider's reducers expect Array.
	if !strings.Contains(rec.Body.String(), `"grants":[]`) {
		t.Errorf("expected grants:[] in body, got %s", rec.Body.String())
	}
	var payload BootPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if payload.TenantRoot != "" {
		t.Errorf("tenant_root = %q, want empty string for no-grants", payload.TenantRoot)
	}
}

func TestBoot_Case3_TopmostGrantWinsAsTenantRoot(t *testing.T) {
	// Two grants — first has a parent (NOT root), second is the root.
	// Algorithm must pick the second (parent_id == nil).
	rootNode := uuid.MustParse("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	childNode := uuid.MustParse("22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	parentRef := rootNode

	loadRolePerms := func(_ context.Context, _ uuid.UUID) (string, uuid.UUID, []string) {
		return "user", uuid.Nil, []string{}
	}
	listGrants := func(_ context.Context, _, _, _ uuid.UUID) ([]BootGrant, error) {
		return []BootGrant{
			{NodeID: childNode, ParentID: &parentRef, Role: "admin"},
			{NodeID: rootNode, ParentID: nil, Role: "admin"},
		}, nil
	}
	h := NewHandler(&stubResolver{}).WithBootDeps(loadRolePerms, listGrants)

	req := httptest.NewRequest("GET", "/sentinel/boot", nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.Boot(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var payload BootPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if payload.TenantRoot != rootNode.String() {
		t.Errorf("tenant_root = %s, want %s (topmost grant)", payload.TenantRoot, rootNode)
	}
}

func TestBoot_Case4_NoActor_401(t *testing.T) {
	h := NewHandler(&stubResolver{}).WithBootDeps(
		func(_ context.Context, _ uuid.UUID) (string, uuid.UUID, []string) { return "", uuid.Nil, nil },
		func(_ context.Context, _, _, _ uuid.UUID) ([]BootGrant, error) { return nil, nil },
	)
	req := httptest.NewRequest("GET", "/sentinel/boot", nil)
	// no withFixtureUser — no actor on ctx
	rec := httptest.NewRecorder()
	h.Boot(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestBoot_Case5_MisconfiguredHandler_500(t *testing.T) {
	// Handler constructed WITHOUT WithBootDeps. Defensive 500 + log.
	h := NewHandler(&stubResolver{})
	req := httptest.NewRequest("GET", "/sentinel/boot", nil)
	req = req.WithContext(withFixtureUser(req.Context(), fixtureUserA()))
	rec := httptest.NewRecorder()
	h.Boot(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}
