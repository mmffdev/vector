// Package apikeys manages API key issuance, validation, and lifecycle for programmatic access.
package apikeys

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zeebo/blake3"
)

// Service manages API key operations.
type Service struct {
	db *pgxpool.Pool
}

// New creates a new API key service.
func New(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// Key is a full API key (returned only on creation).
type Key struct {
	ID            string `json:"id"`
	SubscriptionID string `json:"subscription_id"`
	Prefix        string `json:"prefix"`       // First 8 chars for identification
	RawKey        string `json:"raw_key"`      // Full key (only returned once)
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
}

// KeyInfo is a stored key (no raw key, only hash).
type KeyInfo struct {
	ID            string    `json:"id"`
	SubscriptionID string    `json:"subscription_id"`
	Prefix        string    `json:"prefix"`
	Scopes        []string  `json:"scopes"`
	CreatedAt     time.Time `json:"created_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
	RevokedAt     *time.Time `json:"revoked_at"`
	LastUsedAt    *time.Time `json:"last_used_at"`
}

// Issue creates a new API key. Returns the full key (raw_key) once; never returned again.
func (s *Service) Issue(ctx context.Context, subscriptionID string, expiresAt *time.Time, scopes []string) (*Key, error) {
	rawKey := generateKey()
	prefix := rawKey[:8] // e.g., "sam_live"
	hash := hashKey(rawKey)

	var id string
	err := s.db.QueryRow(ctx,
		`INSERT INTO api_keys (subscription_id, prefix, hash, scopes, expires_at)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		subscriptionID, prefix, hash, scopes, expiresAt,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("insert api_key: %w", err)
	}

	return &Key{
		ID:            id,
		SubscriptionID: subscriptionID,
		Prefix:        prefix,
		RawKey:        rawKey,
		CreatedAt:     time.Now(),
		ExpiresAt:     expiresAt,
	}, nil
}

// ValidateKey checks if a key is valid (exists, not revoked, not expired) and updates last_used_at.
func (s *Service) ValidateKey(ctx context.Context, rawKey string) (*KeyInfo, error) {
	hash := hashKey(rawKey)
	prefix := rawKey[:8]

	var info KeyInfo
	err := s.db.QueryRow(ctx,
		`SELECT id, subscription_id, prefix, scopes, created_at, expires_at, revoked_at, last_used_at
		 FROM api_keys
		 WHERE hash = $1 AND prefix = $2`,
		hash, prefix,
	).Scan(
		&info.ID, &info.SubscriptionID, &info.Prefix, &info.Scopes,
		&info.CreatedAt, &info.ExpiresAt, &info.RevokedAt, &info.LastUsedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("invalid or unknown key")
		}
		return nil, fmt.Errorf("query api_key: %w", err)
	}

	// Check revocation and expiration
	if info.RevokedAt != nil {
		return nil, fmt.Errorf("key is revoked")
	}
	if info.ExpiresAt != nil && time.Now().After(*info.ExpiresAt) {
		return nil, fmt.Errorf("key is expired")
	}

	// Update last_used_at
	_, err = s.db.Exec(ctx,
		`UPDATE api_keys SET last_used_at = now() WHERE id = $1`,
		info.ID,
	)
	if err != nil {
		// Log but don't fail the validation
		fmt.Printf("warn: could not update last_used_at for key %s: %v\n", info.ID, err)
	}

	return &info, nil
}

// ListKeys returns all non-revoked keys for a subscription.
func (s *Service) ListKeys(ctx context.Context, subscriptionID string) ([]KeyInfo, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, subscription_id, prefix, scopes, created_at, expires_at, revoked_at, last_used_at
		 FROM api_keys
		 WHERE subscription_id = $1 AND revoked_at IS NULL
		 ORDER BY created_at DESC`,
		subscriptionID,
	)
	if err != nil {
		return nil, fmt.Errorf("query api_keys: %w", err)
	}
	defer rows.Close()

	var keys []KeyInfo
	for rows.Next() {
		var k KeyInfo
		err := rows.Scan(&k.ID, &k.SubscriptionID, &k.Prefix, &k.Scopes,
			&k.CreatedAt, &k.ExpiresAt, &k.RevokedAt, &k.LastUsedAt)
		if err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return keys, nil
}

// Revoke marks a key as revoked (soft-delete).
func (s *Service) Revoke(ctx context.Context, keyID string) error {
	result, err := s.db.Exec(ctx,
		`UPDATE api_keys SET revoked_at = now() WHERE id = $1`,
		keyID,
	)
	if err != nil {
		return fmt.Errorf("revoke key: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("key not found")
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// generateKey produces a key in format sam_live_<32-char-base62> or sam_test_<32-char-base62>.
// For now, always returns sam_live_ prefix; test prefix can be used when needed.
func generateKey() string {
	// Generate 24 random bytes; base62 encode to get ~32 chars.
	b := make([]byte, 24)
	_, err := rand.Read(b)
	if err != nil {
		panic(fmt.Sprintf("rand.Read failed: %v", err))
	}
	// Base64 encode and take the first 32 chars (base64 is not base62, but good enough for now).
	encoded := base64.RawURLEncoding.EncodeToString(b)
	// Replace URL-unsafe chars with base62-safe alternatives.
	encoded = strings.ReplaceAll(encoded, "-", "a")
	encoded = strings.ReplaceAll(encoded, "_", "b")
	if len(encoded) > 32 {
		encoded = encoded[:32]
	}
	return "sam_live_" + encoded
}

// hashKey computes the Blake3 hash of a key for storage.
func hashKey(key string) []byte {
	h := blake3.New()
	h.Write([]byte(key))
	return h.Sum(nil)
}
