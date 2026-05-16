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
	"testing"
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
