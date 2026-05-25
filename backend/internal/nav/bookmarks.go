package nav

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TD-CUT1.1.1-BOOKMARK-SURFACE (Path A, resolved 2026-05-25):
// EntityKind, EntityKindPortfolio, EntityKindProduct, Bookmarks (Pin/Unpin/IsPinned),
// itemKey, tagEnumForBookmark, loadEntity, hrefFor, iconFor — all deleted.
// The entity bookmark surface (Pin/Unpin/IsPinned, /nav/bookmark routes) is gone.
// Page bookmarks (PageBookmarks / PinPage / UnpinPage) survive — they are
// independent of any entity kind and continue to work correctly.

var (
	ErrPageNotFound      = errors.New("page not found or not pinnable")
	ErrStaticBookmarkCap = errors.New("static bookmark cap reached")
)

// PageBookmarks handles bookmark lifecycle for static pages (kind='static',
// pinnable=true). See TD-CUT1.1.1-BOOKMARK-SURFACE in docs/c_tech_debt.md.
type PageBookmarks struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
	Svc      *Service
}

func NewPageBookmarks(pool *pgxpool.Pool, registry *CachedRegistry, svc *Service) *PageBookmarks {
	return &PageBookmarks{Pool: pool, Registry: registry, Svc: svc}
}

// PinPage adds a static page to the user's bookmarks. Idempotent (ON CONFLICT DO NOTHING).
func (b *PageBookmarks) PinPage(ctx context.Context, userID, callerSubscription uuid.UUID, pageKey string) error {
	profileID, err := b.Svc.ResolveProfile(ctx, userID, callerSubscription, nil)
	if err != nil {
		return err
	}

	tx, err := b.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Validate page exists, is static, pinnable, and visible to this subscription.
	var foundKey string
	err = tx.QueryRow(ctx, sqlSelectStaticPageForBookmark, pageKey, callerSubscription).Scan(&foundKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPageNotFound
	}
	if err != nil {
		return err
	}

	// Serialise concurrent pins for this user.
	if _, err = tx.Exec(ctx, sqlPgAdvisoryXactLockForPin, userID); err != nil {
		return err
	}

	// Cap check.
	var count int
	if err = tx.QueryRow(ctx, sqlCountUserStaticBookmarks, userID, callerSubscription, profileID).Scan(&count); err != nil {
		return err
	}
	if count >= MaxPinned {
		return ErrStaticBookmarkCap
	}

	// Next position.
	var nextPos int
	if err = tx.QueryRow(ctx, sqlNextUserNavPrefPosition, userID, callerSubscription, profileID).Scan(&nextPos); err != nil {
		return err
	}

	// Insert — idempotent via ON CONFLICT DO NOTHING.
	if _, err = tx.Exec(ctx, sqlInsertUserNavPrefBookmark, userID, callerSubscription, profileID, pageKey, nextPos); err != nil {
		return err
	}

	if err = tx.Commit(ctx); err != nil {
		return err
	}

	b.Registry.Load(ctx) //nolint:errcheck
	return nil
}

// UnpinPage removes a static page from the user's bookmarks. Idempotent (no-op if not pinned).
func (b *PageBookmarks) UnpinPage(ctx context.Context, userID, callerSubscription uuid.UUID, pageKey string) error {
	profileID, err := b.Svc.ResolveProfile(ctx, userID, callerSubscription, nil)
	if err != nil {
		return err
	}

	tx, err := b.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err = tx.Exec(ctx, sqlClearPageBookmarkFlag, userID, callerSubscription, profileID, pageKey); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
