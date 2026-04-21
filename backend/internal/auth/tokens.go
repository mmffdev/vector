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
	"github.com/mmffdev/vector-backend/internal/models"
)

type AccessClaims struct {
	Email             string `json:"email"`
	Role              string `json:"role"`
	TenantID          string `json:"tenant_id"`
	ForcePwdChange    bool   `json:"force_pwd_change"`
	jwt.RegisteredClaims
}

func SignAccessToken(u *models.User) (string, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", errors.New("JWT_ACCESS_SECRET not set")
	}
	ttl := parseDurationEnv("JWT_ACCESS_TTL", 15*time.Minute)
	jti := uuid.NewString()

	claims := AccessClaims{
		Email:          u.Email,
		Role:           string(u.Role),
		TenantID:       u.TenantID.String(),
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
	secret := os.Getenv("JWT_ACCESS_SECRET")
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
