package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/secrets"
)

// B16.8.8 — wire-stable issuer + audience identifiers stamped onto
// every Vector-minted JWT (access + challenge). Parse* rejects tokens
// that present either claim with the wrong value; tokens that omit both
// claims entirely are accepted as legacy (grace path) until
// REQUIRE_SID_CLAIM closes the door (B16.8.11 step 5) or operators
// flip a future REQUIRE_ISS_AUD_CLAIMS gate.
//
// Renaming either constant is wire-breaking — equivalent severity to
// rotating JWT_ACCESS_SECRET. Pinned by TestTokens_IssuerAudienceConstants.
const (
	Issuer   = "vector-auth"
	Audience = "vector-api"
)

type AccessClaims struct {
	Email          string `json:"email"`
	Role           string `json:"role"`
	SubscriptionID string `json:"subscription_id"`
	// WorkspaceID is the active workspace within the subscription.
	// Added by PLA-0053 / story 00575. Read by WorkspaceClampMiddleware
	// as the primary workspace source; absent claim → middleware falls
	// back to FirstLiveWorkspace (legacy-token rollout window).
	// omitempty so a zero-value claim is genuinely absent (not just "")
	// — distinguishes "JWT has no workspace context yet" from "JWT
	// explicitly carries an empty workspace_id".
	WorkspaceID string `json:"workspace_id,omitempty"`
	// SessionID is the users_sessions row id that issued this token.
	// Added by B16.8.11 step 2. Read by RequireAuth middleware (step 3)
	// to per-request check users_sessions for revocation / idle
	// eviction without per-request DB-write churn — the existing
	// FindUserByID lookup is extended into a JOIN against users_sessions
	// on this id. omitempty so legacy tokens (pre-step-2) decode with an
	// empty SessionID and middleware's 24h grace path can recognise them.
	SessionID      string `json:"sid,omitempty"`
	ForcePwdChange bool   `json:"force_pwd_change"`
	jwt.RegisteredClaims
}

// (Removed 2026-05-16 — TD-LIB-001.) A bespoke UnmarshalJSON used to
// accept the legacy `tenant_id` claim alongside `subscription_id` so
// pre-mig-017 tokens kept verifying. Refresh-token rotation has long
// since drained every live token; the natural unmarshal of AccessClaims
// is authoritative again.
//
// Contract is now pinned by tokens_test.go (TestAccessClaims_*) — any
// future reintroduction of dual-accept will fail there before merge.

// SignAccessToken mints a fresh access JWT for u, stamped with sid as
// the `sid` claim so RequireAuth (B16.8.11 step 3) can per-request check
// users_sessions for revocation/idle eviction. Pass uuid.Nil for sid on
// paths that have no issuing session row (none today — every call site
// passes through sqlInsertSession or refreshFromSuccessor which both
// surface a SessionID — but the omitempty contract keeps that escape
// hatch open if a future flow needs it).
func SignAccessToken(u *roletypes.User, sid uuid.UUID) (string, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", errors.New("JWT_ACCESS_SECRET not set")
	}
	ttl := parseDurationEnv("JWT_ACCESS_TTL", 15*time.Minute)
	jti := uuid.NewString()

	// Workspace claim is emitted only when the User carries a non-zero
	// WorkspaceID — keeps the legacy-token rollout window clean (zero =
	// omit, middleware falls back to FirstLiveWorkspace).
	workspaceID := ""
	if u.WorkspaceID != uuid.Nil {
		workspaceID = u.WorkspaceID.String()
	}

	// Same omitempty contract as workspace_id — zero uuid = no sid in
	// the JWT body, which middleware reads as "legacy token, take the
	// grace path."
	sidStr := ""
	if sid != uuid.Nil {
		sidStr = sid.String()
	}

	claims := AccessClaims{
		Email:          u.Email,
		Role:           string(u.Role),
		SubscriptionID: u.SubscriptionID.String(),
		WorkspaceID:    workspaceID,
		SessionID:      sidStr,
		ForcePwdChange: u.ForcePasswordChange,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{Audience},
			Subject:   u.ID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        jti,
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ErrTokenInvalidIssuer / ErrTokenInvalidAudience are returned by
// ParseAccessToken / ParseChallengeToken when a token presents a wrong
// iss / aud value. Tokens that omit both claims entirely (legacy
// pre-B16.8.8 tokens) are accepted — the grace window the issuer/audience
// rollout depends on, mirroring B16.8.11 step 2's sid omitempty contract.
var (
	ErrTokenInvalidIssuer   = errors.New("token issuer is not recognised")
	ErrTokenInvalidAudience = errors.New("token audience is not recognised")
)

// validateIssAud applies the B16.8.8 issuer/audience policy to a parsed
// RegisteredClaims. If iss is non-empty it must equal Issuer; if aud is
// non-empty it must contain Audience. Both empty = legacy token, accepted.
func validateIssAud(rc jwt.RegisteredClaims) error {
	if rc.Issuer != "" && rc.Issuer != Issuer {
		return ErrTokenInvalidIssuer
	}
	if len(rc.Audience) > 0 {
		ok := false
		for _, a := range rc.Audience {
			if a == Audience {
				ok = true
				break
			}
		}
		if !ok {
			return ErrTokenInvalidAudience
		}
	}
	return nil
}

func ParseAccessToken(raw string) (*AccessClaims, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	claims := &AccessClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if err := validateIssAud(claims.RegisteredClaims); err != nil {
		return nil, err
	}
	return claims, nil
}

// GenerateRefreshToken returns (raw, sha256_hex_hash).
func GenerateRefreshToken() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(b)
	return raw, Sha256Hex(raw), nil
}

func Sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// ChallengeClaims is the payload for short-lived MFA challenge tokens.
// kind="mfa_challenge" lets ParseAccessToken callers reject these at
// protected endpoints — they carry no role/subscription context.
type ChallengeClaims struct {
	Kind string `json:"kind"`
	jwt.RegisteredClaims
}

// SignChallengeToken mints a 5-minute HS256 token that can only be
// exchanged at POST /auth/mfa/verify. It carries sub (userID) + kind
// but no role, subscription_id, or workspace_id — it is not a full
// access token and must never be accepted as one.
func SignChallengeToken(userID uuid.UUID) (string, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", errors.New("JWT_ACCESS_SECRET not set")
	}
	claims := ChallengeClaims{
		Kind: "mfa_challenge",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{Audience},
			Subject:   userID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.NewString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ParseChallengeToken validates and returns the ChallengeClaims for a
// token minted by SignChallengeToken. Returns an error if the token is
// expired, malformed, carries the wrong kind claim, or presents a
// wrong iss/aud (legacy tokens with neither claim are accepted under
// the B16.8.8 grace window).
func ParseChallengeToken(raw string) (*ChallengeClaims, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	claims := &ChallengeClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims.Kind != "mfa_challenge" {
		return nil, errors.New("token is not an mfa_challenge")
	}
	if err := validateIssAud(claims.RegisteredClaims); err != nil {
		return nil, err
	}
	return claims, nil
}

// ── Password-reset handoff token ────────────────────────────────────────────
//
// TD-SEC-RESET-TOKEN-FRAGMENT. The reset-link redeem endpoint
// (/_site/auth/password-reset/redeem) validates the raw token from
// the email link, then hands off to /login/reset/confirm via a
// signed cookie carrying only the reset_id. The cookie is HttpOnly,
// so JS can't read it; the raw token never crosses into client land.
//
// Why a JWT and not just an opaque cookie value: the JWT signature
// proves the cookie was minted by the redeem endpoint after a
// successful raw-token check. Without it, a hostile site could
// forge a cookie containing any reset_id. With it, the backend
// verifies the signature before trusting reset_id.
//
// Kind discriminator stops a stray access token from being replayed
// against the confirm POST.

type ResetHandoffClaims struct {
	Kind    string `json:"kind"`
	ResetID string `json:"reset_id"`
	jwt.RegisteredClaims
}

// SignResetHandoffToken mints a 5-minute HS256 token referencing the
// users_password_resets row by id. Set as a HttpOnly cookie by the
// redeem endpoint; consumed by the confirm POST.
func SignResetHandoffToken(resetID uuid.UUID) (string, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", errors.New("JWT_ACCESS_SECRET not set")
	}
	claims := ResetHandoffClaims{
		Kind:    "reset_handoff",
		ResetID: resetID.String(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{Audience},
			Subject:   resetID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.NewString(),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
}

// ParseResetHandoffToken validates and returns the ResetHandoffClaims
// for a token minted by SignResetHandoffToken.
func ParseResetHandoffToken(raw string) (*ResetHandoffClaims, error) {
	secret := secrets.Get("JWT_ACCESS_SECRET")
	claims := &ResetHandoffClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims.Kind != "reset_handoff" {
		return nil, errors.New("token is not a reset_handoff")
	}
	if err := validateIssAud(claims.RegisteredClaims); err != nil {
		return nil, err
	}
	return claims, nil
}

func parseDurationEnv(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}
