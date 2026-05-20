package notifications

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Prefs answers "should this notification be delivered to this user
// on this channel?". Backed by users_notifications_prefs; an empty
// row set falls back to the default-on policy.
//
// Defaults (when no explicit row exists for (user, kind, channel)):
//   - in_app: enabled
//   - email:  enabled  (subject to legal/SMTP availability — Email
//                       dispatcher also checks SMTP config)
//   - sse:    enabled
//
// The bell preferences UI calls Upsert when the user toggles a
// switch; the dispatchers call Enabled before delivery.
type Prefs struct {
	pool *pgxpool.Pool

	// Tiny in-process cache to avoid hammering the DB for every
	// envelope. Keyed by user_id — invalidated on Upsert.
	mu    sync.RWMutex
	cache map[uuid.UUID]map[prefKey]bool
}

type prefKey struct {
	Kind    string
	Channel string
}

func NewPrefs(pool *pgxpool.Pool) *Prefs {
	return &Prefs{pool: pool, cache: make(map[uuid.UUID]map[prefKey]bool)}
}

// Enabled reports whether the user wants this (kind, channel)
// combination delivered. Defaults to true when no row exists.
func (p *Prefs) Enabled(ctx context.Context, userID uuid.UUID, kind, channel string) (bool, error) {
	prefs, err := p.load(ctx, userID)
	if err != nil {
		return false, err
	}
	if explicit, ok := prefs[prefKey{Kind: kind, Channel: channel}]; ok {
		return explicit, nil
	}
	return true, nil // default-on
}

// ListForUser returns the explicit rows for this user — the bell
// settings page uses this to render the matrix with checkbox state.
// Missing rows mean "default" (which the UI can show as "on, but
// not pinned").
func (p *Prefs) ListForUser(ctx context.Context, userID uuid.UUID) ([]Pref, error) {
	rows, err := p.pool.Query(ctx, sqlListUserNotificationsPrefs, userID)
	if err != nil {
		return nil, fmt.Errorf("list prefs: %w", err)
	}
	defer rows.Close()
	out := []Pref{}
	for rows.Next() {
		var pr Pref
		if err := rows.Scan(&pr.Kind, &pr.Channel, &pr.Enabled); err != nil {
			return nil, fmt.Errorf("scan pref: %w", err)
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

// Upsert writes one (kind, channel, enabled) row and invalidates the
// in-process cache for this user.
func (p *Prefs) Upsert(ctx context.Context, userID uuid.UUID, kind, channel string, enabled bool) error {
	if _, err := p.pool.Exec(ctx, sqlUpsertUserNotificationsPref, userID, kind, channel, enabled); err != nil {
		return fmt.Errorf("upsert pref: %w", err)
	}
	p.invalidate(userID)
	return nil
}

func (p *Prefs) load(ctx context.Context, userID uuid.UUID) (map[prefKey]bool, error) {
	p.mu.RLock()
	hit, ok := p.cache[userID]
	p.mu.RUnlock()
	if ok {
		return hit, nil
	}

	rows, err := p.pool.Query(ctx, sqlListUserNotificationsPrefs, userID)
	if err != nil {
		// Don't poison the cache on transient errors.
		if errors.Is(err, pgx.ErrNoRows) {
			return map[prefKey]bool{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	m := map[prefKey]bool{}
	for rows.Next() {
		var kind, channel string
		var enabled bool
		if err := rows.Scan(&kind, &channel, &enabled); err != nil {
			return nil, err
		}
		m[prefKey{Kind: kind, Channel: channel}] = enabled
	}

	p.mu.Lock()
	p.cache[userID] = m
	p.mu.Unlock()
	return m, nil
}

func (p *Prefs) invalidate(userID uuid.UUID) {
	p.mu.Lock()
	delete(p.cache, userID)
	p.mu.Unlock()
}

// Pref is the wire shape returned to the bell-settings UI.
type Pref struct {
	Kind    string `json:"kind"`
	Channel string `json:"channel"`
	Enabled bool   `json:"enabled"`
}
