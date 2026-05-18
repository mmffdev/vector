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
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/roletypes"
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

// B16.8.8 — JWT issuer + audience claims.
//
// Three contracts pinned here. Until the implementation lands, the
// "wrong-iss / wrong-aud reject" tests fail red because Parse* doesn't
// validate either; the "legacy accept" test stays green throughout
// (no claim present == no constraint to violate).
//
// Constants are wire-stable. Renaming the issuer string or audience
// string anywhere outside a deliberate revoke-all-tokens release is
// the same severity as renaming the JWT secret.
func TestTokens_IssuerAudienceConstants(t *testing.T) {
	if Issuer != "vector-auth" {
		t.Errorf("Issuer drifted: got %q, want %q", Issuer, "vector-auth")
	}
	if Audience != "vector-api" {
		t.Errorf("Audience drifted: got %q, want %q", Audience, "vector-api")
	}
}

func TestAccessToken_RoundTripsIssAud(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-do-not-use-in-prod-do-not-use-in-prod")
	u := minimalUser()
	tok, err := SignAccessToken(u, uuid.New(), "")
	if err != nil {
		t.Fatalf("SignAccessToken: %v", err)
	}
	claims, err := ParseAccessToken(tok)
	if err != nil {
		t.Fatalf("ParseAccessToken: %v", err)
	}
	if claims.Issuer != Issuer {
		t.Errorf("issuer not stamped: got %q, want %q", claims.Issuer, Issuer)
	}
	if len(claims.Audience) == 0 || claims.Audience[0] != Audience {
		t.Errorf("audience not stamped: got %v, want [%q]", claims.Audience, Audience)
	}
}

func TestAccessToken_RejectsWrongIssuer(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-do-not-use-in-prod-do-not-use-in-prod")
	// Sign with a deliberately wrong issuer by bypassing SignAccessToken.
	raw := mintTokenWithClaims(t, AccessClaims{
		Email: "x@y", Role: "user",
		SubscriptionID: uuid.NewString(),
		RegisteredClaims: registeredClaimsWith("attacker.example.com", Audience, uuid.New().String()),
	})
	if _, err := ParseAccessToken(raw); err == nil {
		t.Error("ParseAccessToken accepted a token with the wrong issuer — iss validation missing")
	}
}

func TestAccessToken_RejectsWrongAudience(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-do-not-use-in-prod-do-not-use-in-prod")
	raw := mintTokenWithClaims(t, AccessClaims{
		Email: "x@y", Role: "user",
		SubscriptionID: uuid.NewString(),
		RegisteredClaims: registeredClaimsWith(Issuer, "wrong-audience", uuid.New().String()),
	})
	if _, err := ParseAccessToken(raw); err == nil {
		t.Error("ParseAccessToken accepted a token with the wrong audience — aud validation missing")
	}
}

func TestAccessToken_AcceptsLegacyMissingIssAud(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-do-not-use-in-prod-do-not-use-in-prod")
	// Legacy token: signed before this commit, no iss/aud claims at all.
	raw := mintTokenWithClaims(t, AccessClaims{
		Email: "x@y", Role: "user",
		SubscriptionID: uuid.NewString(),
		// RegisteredClaims with sub + exp but no iss/aud.
		RegisteredClaims: registeredClaimsWith("", "", uuid.New().String()),
	})
	if _, err := ParseAccessToken(raw); err != nil {
		t.Errorf("ParseAccessToken rejected a legacy token missing iss/aud (grace window broken): %v", err)
	}
}

func TestChallengeToken_RoundTripsIssAud(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-secret-do-not-use-in-prod-do-not-use-in-prod")
	tok, err := SignChallengeToken(uuid.New())
	if err != nil {
		t.Fatalf("SignChallengeToken: %v", err)
	}
	claims, err := ParseChallengeToken(tok)
	if err != nil {
		t.Fatalf("ParseChallengeToken: %v", err)
	}
	if claims.Issuer != Issuer {
		t.Errorf("challenge issuer not stamped: got %q, want %q", claims.Issuer, Issuer)
	}
	if len(claims.Audience) == 0 || claims.Audience[0] != Audience {
		t.Errorf("challenge audience not stamped: got %v, want [%q]", claims.Audience, Audience)
	}
}

// ─── B16.8.8 test helpers ────────────────────────────────────────────────

// minimalUser returns a User sufficient for SignAccessToken — ID,
// SubscriptionID, Email, Role populated; everything else zero.
func minimalUser() *roletypes.User {
	return &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@example.com",
		Role:           "user",
	}
}

// registeredClaimsWith builds a RegisteredClaims with the given issuer,
// audience, and jti. Empty issuer/audience produces an empty-string
// Issuer / empty Audience slice (= claim absent in the JWT body via
// omitempty). Subject + ExpiresAt are populated so the parser accepts
// the token on the happy path.
func registeredClaimsWith(iss, aud, jti string) jwt.RegisteredClaims {
	rc := jwt.RegisteredClaims{
		Subject:   uuid.New().String(),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ID:        jti,
	}
	if iss != "" {
		rc.Issuer = iss
	}
	if aud != "" {
		rc.Audience = jwt.ClaimStrings{aud}
	}
	return rc
}

// mintTokenWithClaims signs the supplied AccessClaims with the current
// JWT_ACCESS_SECRET. Bypasses SignAccessToken so the test can produce
// deliberately-malformed tokens (wrong iss/aud, missing iss/aud) that
// SignAccessToken would never emit.
func mintTokenWithClaims(t *testing.T, claims AccessClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	raw, err := tok.SignedString([]byte("test-secret-do-not-use-in-prod-do-not-use-in-prod"))
	if err != nil {
		t.Fatalf("mintTokenWithClaims: %v", err)
	}
	return raw
}

// ────────────────────────────────────────────────────────────────────────

// B16.8.11 step 3 — codes.go pins the wire-stable Problem.Code values
// emitted by RequireAuth for session-state rejections. If anyone renames
// these (e.g. session_revoked → revoked), every frontend reading
// problem-details JSON breaks silently. This test fails loudly first.
func TestSessionProblemCodes_AreWireStable(t *testing.T) {
	if CodeSessionRevoked != "session_revoked" {
		t.Errorf("CodeSessionRevoked drifted: got %q, want %q", CodeSessionRevoked, "session_revoked")
	}
	if CodeSessionIdleExpired != "session_idle_expired" {
		t.Errorf("CodeSessionIdleExpired drifted: got %q, want %q", CodeSessionIdleExpired, "session_idle_expired")
	}
}

// B16.8.11 step 3 — SessionState shape is the contract between
// FindUserBySessionID and RequireAuth. Revoked is the instant-kill
// signal; LastActivityAt drives the idle-timeout comparison
// (NOW() - LastActivityAt > SESSION_IDLE_TTL). Test pins both fields
// exist and are the expected types so refactors that drop one trip CI.
func TestSessionState_HasRequiredFields(t *testing.T) {
	now := time.Now()
	st := SessionState{Revoked: true, LastActivityAt: now}
	if !st.Revoked {
		t.Error("Revoked field not assignable to true")
	}
	if !st.LastActivityAt.Equal(now) {
		t.Errorf("LastActivityAt round-trip broken: got %v, want %v", st.LastActivityAt, now)
	}
	var empty SessionState
	if empty.Revoked {
		t.Error("zero-value Revoked should be false")
	}
	if !empty.LastActivityAt.IsZero() {
		t.Errorf("zero-value LastActivityAt should be zero time, got %v", empty.LastActivityAt)
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
