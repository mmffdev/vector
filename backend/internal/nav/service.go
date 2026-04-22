package nav

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnknownItemKey    = errors.New("unknown item_key")
	ErrNotPinnable       = errors.New("item_key is not pinnable")
	ErrStartPageNotPinned = errors.New("start_page_key must be present in pinned list")
	ErrBadPositions      = errors.New("positions must be contiguous 0..N-1")
	ErrDuplicateKey      = errors.New("duplicate item_key in pinned list")
)

type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

type PrefRow struct {
	ItemKey     string `json:"item_key"`
	Position    int    `json:"position"`
	IsStartPage bool   `json:"is_start_page"`
}

type PinnedInput struct {
	ItemKey  string `json:"item_key"`
	Position int    `json:"position"`
}

// GetPrefs returns a user's prefs for (user, tenant, profile=NULL) ordered by position.
// Empty slice means "no prefs set" — callers fall back to catalogue defaults.
func (s *Service) GetPrefs(ctx context.Context, userID, tenantID uuid.UUID) ([]PrefRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT item_key, position, is_start_page
		FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL
		ORDER BY position`, userID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PrefRow, 0, 16)
	for rows.Next() {
		var p PrefRow
		if err := rows.Scan(&p.ItemKey, &p.Position, &p.IsStartPage); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetStartPageHref resolves the start page for (user, tenant, profile=NULL).
// Returns ("", false) if no start page set.
func (s *Service) GetStartPageHref(ctx context.Context, userID, tenantID uuid.UUID) (string, bool, error) {
	var key string
	err := s.Pool.QueryRow(ctx, `
		SELECT item_key FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL AND is_start_page = TRUE
		LIMIT 1`, userID, tenantID).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	entry, ok := Find(key)
	if !ok {
		// Stale key — catalogue changed after prefs were written. Caller falls back.
		return "", false, nil
	}
	return entry.Href, true, nil
}

// ReplacePrefs validates the input, then atomically deletes and re-inserts
// this user's prefs for (tenant, profile=NULL). Hard-delete on unpin.
//
// Validation:
//   - every item_key exists in static catalogue (entity keys deferred to Phase 3)
//   - every item_key is pinnable
//   - no duplicate item_keys
//   - positions form contiguous 0..N-1
//   - start_page_key, if non-nil, is in the pinned list and pinnable
func (s *Service) ReplacePrefs(ctx context.Context, userID, tenantID uuid.UUID, pinned []PinnedInput, startPageKey *string) error {
	if err := validatePinned(pinned); err != nil {
		return err
	}
	if startPageKey != nil {
		if !IsPinnable(*startPageKey) {
			return fmt.Errorf("%w: start_page_key=%s", ErrNotPinnable, *startPageKey)
		}
		found := false
		for _, p := range pinned {
			if p.ItemKey == *startPageKey {
				found = true
				break
			}
		}
		if !found {
			return ErrStartPageNotPinned
		}
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL`, userID, tenantID); err != nil {
		return err
	}

	if len(pinned) > 0 {
		batch := &pgx.Batch{}
		for _, p := range pinned {
			isStart := startPageKey != nil && *startPageKey == p.ItemKey
			batch.Queue(`
				INSERT INTO user_nav_prefs (user_id, tenant_id, profile_id, item_key, position, is_start_page)
				VALUES ($1, $2, NULL, $3, $4, $5)`,
				userID, tenantID, p.ItemKey, p.Position, isStart)
		}
		br := tx.SendBatch(ctx, batch)
		for range pinned {
			if _, err := br.Exec(); err != nil {
				_ = br.Close()
				return err
			}
		}
		if err := br.Close(); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// DeletePrefs nukes all prefs rows for (user, tenant, profile=NULL). Used by
// "Reset to defaults" in the modal.
func (s *Service) DeletePrefs(ctx context.Context, userID, tenantID uuid.UUID) error {
	_, err := s.Pool.Exec(ctx, `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND tenant_id = $2 AND profile_id IS NULL`, userID, tenantID)
	return err
}

func validatePinned(pinned []PinnedInput) error {
	seen := make(map[string]struct{}, len(pinned))
	positions := make(map[int]struct{}, len(pinned))
	for _, p := range pinned {
		if _, ok := Find(p.ItemKey); !ok {
			return fmt.Errorf("%w: %s", ErrUnknownItemKey, p.ItemKey)
		}
		if !IsPinnable(p.ItemKey) {
			return fmt.Errorf("%w: %s", ErrNotPinnable, p.ItemKey)
		}
		if _, dup := seen[p.ItemKey]; dup {
			return fmt.Errorf("%w: %s", ErrDuplicateKey, p.ItemKey)
		}
		seen[p.ItemKey] = struct{}{}
		positions[p.Position] = struct{}{}
	}
	for i := 0; i < len(pinned); i++ {
		if _, ok := positions[i]; !ok {
			return ErrBadPositions
		}
	}
	return nil
}
