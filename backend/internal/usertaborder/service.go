package usertaborder

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxTabsPerPage  = 64
	MaxTabKeyLen    = 128
	MaxPageIDLen    = 128
)

var (
	ErrTooManyTabs    = errors.New("too many tabs for page")
	ErrEmptyTabKey    = errors.New("tab_key must not be empty")
	ErrEmptyPageID    = errors.New("page_id must not be empty")
	ErrTabKeyTooLong  = errors.New("tab_key too long")
	ErrPageIDTooLong  = errors.New("page_id too long")
	ErrDuplicateTab   = errors.New("duplicate tab_key in payload")
	ErrBadPositions   = errors.New("positions must be contiguous 0..N-1")
)

type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{Pool: pool}
}

// Row is the wire shape returned by List and accepted by Replace.
type Row struct {
	TabKey   string `json:"tab_key"`
	Position int    `json:"position"`
}

// List returns the user's tab order for (subscription, page), ordered by
// position. An empty slice means "no preference set" — callers fall back
// to the page's default ordering (alphabetical or registration order).
func (s *Service) List(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	pageID string,
) ([]Row, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT tab_key, position
		FROM user_tab_order
		WHERE user_id = $1 AND subscription_id = $2 AND page_id = $3
		ORDER BY position`,
		userID, subscriptionID, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Row, 0, 8)
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.TabKey, &r.Position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Replace atomically wipes and re-inserts the user's tab order for
// (subscription, page). Tab keys not present in the live page catalog are
// preserved on disk but ignored by the read path — see migration 115's
// header comment. The DEFERRABLE position uniqueness lets a single tx
// safely swap two rows.
//
// Validation:
//   - len(items) <= MaxTabsPerPage
//   - page_id non-empty, <= MaxPageIDLen
//   - every tab_key non-empty, <= MaxTabKeyLen, unique within payload
//   - positions form contiguous 0..N-1
func (s *Service) Replace(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	pageID string,
	items []Row,
) error {
	if pageID == "" {
		return ErrEmptyPageID
	}
	if len(pageID) > MaxPageIDLen {
		return fmt.Errorf("%w: %d > %d", ErrPageIDTooLong, len(pageID), MaxPageIDLen)
	}
	if len(items) > MaxTabsPerPage {
		return fmt.Errorf("%w: %d > %d", ErrTooManyTabs, len(items), MaxTabsPerPage)
	}

	seen := make(map[string]struct{}, len(items))
	positions := make(map[int]struct{}, len(items))
	for _, it := range items {
		if it.TabKey == "" {
			return ErrEmptyTabKey
		}
		if len(it.TabKey) > MaxTabKeyLen {
			return fmt.Errorf("%w: %d > %d", ErrTabKeyTooLong, len(it.TabKey), MaxTabKeyLen)
		}
		if _, dup := seen[it.TabKey]; dup {
			return fmt.Errorf("%w: %s", ErrDuplicateTab, it.TabKey)
		}
		seen[it.TabKey] = struct{}{}
		positions[it.Position] = struct{}{}
	}
	for i := 0; i < len(items); i++ {
		if _, ok := positions[i]; !ok {
			return ErrBadPositions
		}
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		DELETE FROM user_tab_order
		WHERE user_id = $1 AND subscription_id = $2 AND page_id = $3`,
		userID, subscriptionID, pageID); err != nil {
		return err
	}

	if len(items) > 0 {
		batch := &pgx.Batch{}
		for _, it := range items {
			batch.Queue(`
				INSERT INTO user_tab_order (user_id, subscription_id, page_id, tab_key, position)
				VALUES ($1, $2, $3, $4, $5)`,
				userID, subscriptionID, pageID, it.TabKey, it.Position)
		}
		br := tx.SendBatch(ctx, batch)
		for range items {
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

// Reset wipes the user's tab order for (subscription, page). Read path
// then falls back to the page's default ordering.
func (s *Service) Reset(
	ctx context.Context,
	userID, subscriptionID uuid.UUID,
	pageID string,
) error {
	if pageID == "" {
		return ErrEmptyPageID
	}
	_, err := s.Pool.Exec(ctx, `
		DELETE FROM user_tab_order
		WHERE user_id = $1 AND subscription_id = $2 AND page_id = $3`,
		userID, subscriptionID, pageID)
	return err
}
