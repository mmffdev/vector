package security

import (
	"testing"
)

// TestMFARememberToken_RoundTrip is the SEC-MFA (RES066) guard: after
// switching the signer/parser from os.Getenv to secrets.Get, a token
// signed by SignMFARememberToken must still validate via
// ParseMFARememberToken. This pins the signing contract so the secret-
// access swap (and any future move to an encrypted JWT_ACCESS_SECRET)
// cannot silently break device-trust tokens.
func TestMFARememberToken_RoundTrip(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-value-for-mfa-remember")

	userID := "11111111-1111-1111-1111-111111111111"
	token, err := SignMFARememberToken(userID)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if token == "" {
		t.Fatal("sign returned empty token")
	}
	if err := ParseMFARememberToken(userID, token); err != nil {
		t.Fatalf("parse of freshly-signed token failed: %v", err)
	}
}

// TestMFARememberToken_WrongUserRejected confirms the HMAC binds the token
// to its userID — a token signed for user A must not validate for user B.
func TestMFARememberToken_WrongUserRejected(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-value-for-mfa-remember")

	token, err := SignMFARememberToken("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if err := ParseMFARememberToken("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", token); err == nil {
		t.Fatal("expected parse to reject a token signed for a different user")
	}
}

// TestMFARememberToken_NoSecretFailsClosed confirms an unset secret yields
// an error on sign and a rejection on parse rather than a usable token.
func TestMFARememberToken_NoSecretFailsClosed(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "")

	if _, err := SignMFARememberToken("any-user"); err == nil {
		t.Fatal("expected sign to error when JWT_ACCESS_SECRET is unset")
	}
	if err := ParseMFARememberToken("any-user", "0.deadbeef.cafe"); err == nil {
		t.Fatal("expected parse to reject when JWT_ACCESS_SECRET is unset")
	}
}
