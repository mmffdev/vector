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
	WorkspaceID    string `json:"workspace_id,omitempty"`
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

func SignAccessToken(u *roletypes.User) (string, error) {
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

	claims := AccessClaims{
		Email:          u.Email,
		Role:           string(u.Role),
		SubscriptionID: u.SubscriptionID.String(),
		WorkspaceID:    workspaceID,
		ForcePwdChange: u.ForcePasswordChange,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   u.ID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        jti,
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString([]byte(secret))
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
// expired, malformed, or carries the wrong kind claim.
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
