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
