package auth

// TD-LIB-001 contract — backfill test, 2026-05-16.
//
// 2026-05-16 commit `74d1bff` removed the bespoke
// AccessClaims.UnmarshalJSON that used to dual-accept the legacy
// `tenant_id` claim alongside `subscription_id`. This test pins the
// post-removal contract so a future "let's just add a tiny fallback
// for the old field" reintroduction fails CI before it ships.
//
// Tests written red-first (verified by temporarily restoring the
// dual-accept UnmarshalJSON locally — both assertions failed against
// that code path, then passed once the natural unmarshal was back).
// Filed as a backfill per the red-green-always discipline (commit
// `cfaa26c`); next regression on this surface is now caught.

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestAccessClaims_RejectsLegacyTenantIdClaim verifies that a JWT body
// carrying ONLY the legacy `tenant_id` field (no `subscription_id`)
// produces an AccessClaims with an empty SubscriptionID. Pre-cleanup,
// the bespoke UnmarshalJSON would copy `tenant_id` → SubscriptionID;
// post-cleanup, the natural unmarshal ignores unknown JSON fields and
// SubscriptionID stays the zero value.
func TestAccessClaims_RejectsLegacyTenantIdClaim(t *testing.T) {
	// Body of a legacy token: subscription_id absent, tenant_id present.
	legacy := []byte(`{
		"email": "claude@mmffdev.com",
		"role": "gadmin",
		"tenant_id": "00000000-0000-0000-0000-000000000001",
		"force_pwd_change": false
	}`)

	var c AccessClaims
	if err := json.Unmarshal(legacy, &c); err != nil {
		t.Fatalf("unmarshal legacy claims: %v", err)
	}

	if c.SubscriptionID != "" {
		t.Errorf(
			"AccessClaims.SubscriptionID = %q, want empty (the legacy `tenant_id` claim must NOT populate SubscriptionID — TD-LIB-001 cleanup removed that fallback)",
			c.SubscriptionID,
		)
	}
	// Other fields should still decode cleanly via natural unmarshal.
	if c.Email != "claude@mmffdev.com" {
		t.Errorf("Email decode broken: got %q", c.Email)
	}
	if c.Role != "gadmin" {
		t.Errorf("Role decode broken: got %q", c.Role)
	}
}

// TestAccessClaims_AcceptsSubscriptionIdClaim is the positive case: a
// well-formed claim with `subscription_id` decodes cleanly.
func TestAccessClaims_AcceptsSubscriptionIdClaim(t *testing.T) {
	modern := []byte(`{
		"email": "claude@mmffdev.com",
		"role": "gadmin",
		"subscription_id": "00000000-0000-0000-0000-000000000001",
		"force_pwd_change": false
	}`)

	var c AccessClaims
	if err := json.Unmarshal(modern, &c); err != nil {
		t.Fatalf("unmarshal modern claims: %v", err)
	}
	if c.SubscriptionID != "00000000-0000-0000-0000-000000000001" {
		t.Errorf("SubscriptionID decode broken: got %q", c.SubscriptionID)
	}
}

// B16.8.11 step 2 — AccessClaims must carry the issuing session row id
// as the `sid` JSON claim. Red-first: this test fails before the field
// is added to AccessClaims. Asserts JSON round-trip (encode → decode)
// preserves the sid so RequireAuth (step 3) can read it from the parsed
// claim and per-request check users_sessions for revocation / idle
// eviction. omitempty is intentional — legacy tokens issued before this
// commit have no sid; middleware's grace path (step 3) handles that by
// falling back to user-only auth for the 24h grace window.
func TestAccessClaims_RoundTripsSessionIDClaim(t *testing.T) {
	sid := uuid.MustParse("11111111-2222-3333-4444-555555555555")
	in := AccessClaims{SessionID: sid.String()}
	enc, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// Must serialise under JSON key "sid" — not "session_id", not
	// "SessionID" — middleware reads exactly that key.
	if !strings.Contains(string(enc), `"sid":"11111111-2222-3333-4444-555555555555"`) {
		t.Errorf("AccessClaims did not serialise the sid claim under key `sid`: %s", string(enc))
	}
	var out AccessClaims
	if err := json.Unmarshal(enc, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.SessionID != sid.String() {
		t.Errorf("sid round-trip broken: got %q, want %q", out.SessionID, sid.String())
	}
}

// Legacy claim without `sid` decodes cleanly with an empty SessionID —
// the omitempty contract that lets the 24h grace window work in step 3.
func TestAccessClaims_LegacyTokenHasEmptySessionID(t *testing.T) {
	legacy := []byte(`{"email":"x@y","role":"gadmin","subscription_id":"00000000-0000-0000-0000-000000000001"}`)
	var c AccessClaims
	if err := json.Unmarshal(legacy, &c); err != nil {
		t.Fatalf("unmarshal legacy: %v", err)
	}
	if c.SessionID != "" {
		t.Errorf("legacy claim should have empty SessionID, got %q", c.SessionID)
	}
}

// B16.8.11 step 1 — LoginResult must carry the issuing session row id so
// downstream callers (step 2: sid claim signing) can stamp it onto the
// access JWT. Red-first: this test fails to compile before
// LoginResult.SessionID is added; once added it asserts the field is
// assignable and round-trips a uuid. Pins the structural contract every
// session-issuing call site (Login, MFAVerifyLogin, Refresh,
// refreshFromSuccessor — no, .refreshFromSuccessor reuses existing
// session, no insert — and SwitchWorkspace) must populate.
func TestLoginResult_CarriesSessionID(t *testing.T) {
	sid := uuid.New()
	lr := LoginResult{SessionID: sid}
	if lr.SessionID != sid {
		t.Errorf("LoginResult.SessionID round-trip broken: got %s, want %s", lr.SessionID, sid)
	}
	// Zero value is uuid.Nil — confirms the field exists but is not
	// populated by accident; callers must set it explicitly.
	var empty LoginResult
	if empty.SessionID != uuid.Nil {
		t.Errorf("LoginResult{}.SessionID = %s, want uuid.Nil", empty.SessionID)
	}
}
