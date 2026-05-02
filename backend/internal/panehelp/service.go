// Package panehelp serves the gadmin-editable help body shown in the
// popover opened by the TbHelpHexagon icon on every <PaneHeader>.
//
// Read path: GetAll() returns a {paneId: body_html} map served from a
// 60s in-process cache so opening a new page anywhere in the app costs
// at most one DB round-trip per minute per server.
//
// Write path: Put() upserts a row, stamps the editor + timestamp, and
// busts the cache so the next GetAll reflects the change immediately.
package panehelp

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CacheTTL is the GetAll cache window. PUT busts the cache regardless.
const CacheTTL = 60 * time.Second

// ErrNotFound is returned by Put when paneId does not exist.
// Callers map this to HTTP 404.
var ErrNotFound = errors.New("pane help: paneId not found")

type Service struct {
	pool *pgxpool.Pool

	mu        sync.RWMutex
	cache     map[string]string
	cachedAt  time.Time
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// GetAll returns {paneId: body_html} for every row, served from a 60s
// cache. The boolean is true on a cache hit.
func (s *Service) GetAll(ctx context.Context) (map[string]string, bool, error) {
	s.mu.RLock()
	if s.cache != nil && time.Since(s.cachedAt) < CacheTTL {
		out := make(map[string]string, len(s.cache))
		for k, v := range s.cache {
			out[k] = v
		}
		s.mu.RUnlock()
		return out, true, nil
	}
	s.mu.RUnlock()

	rows, err := s.pool.Query(ctx, `SELECT paneid, body_html FROM pane_help`)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	fresh := map[string]string{}
	for rows.Next() {
		var id, body string
		if err := rows.Scan(&id, &body); err != nil {
			return nil, false, err
		}
		fresh[id] = body
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	s.mu.Lock()
	s.cache = fresh
	s.cachedAt = time.Now()
	s.mu.Unlock()

	out := make(map[string]string, len(fresh))
	for k, v := range fresh {
		out[k] = v
	}
	return out, false, nil
}

// AdminRow is one row of the gadmin editor view: paneId, current body,
// when it was last edited, and the editor's email (best-effort; null if
// the user was deleted). Not cached — the editor needs fresh metadata
// after every save.
type AdminRow struct {
	PaneID      string     `json:"paneId"`
	BodyHTML    string     `json:"body_html"`
	UpdatedAt   time.Time  `json:"updated_at"`
	UpdatedBy   *string    `json:"updated_by_email"`
}

// GetAllAdmin returns every pane_help row with editor metadata, joined
// to users to expose the editor's email. Bypasses the GetAll cache so
// the editor sees fresh updated_at after every save.
func (s *Service) GetAllAdmin(ctx context.Context) ([]AdminRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.paneid, p.body_html, p.updated_at, u.email
		  FROM pane_help p
		  LEFT JOIN users u ON u.id = p.updated_by_user_id
		 ORDER BY p.paneid
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AdminRow{}
	for rows.Next() {
		var r AdminRow
		if err := rows.Scan(&r.PaneID, &r.BodyHTML, &r.UpdatedAt, &r.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Put updates the body_html for an existing paneId, stamps the editor
// + timestamp, and busts the cache. Returns ErrNotFound if paneId is
// not in the table — pane creation is registry-driven (migration only),
// not API-driven, so PUT never inserts.
func (s *Service) Put(ctx context.Context, paneID string, body string, editorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE pane_help
		   SET body_html = $1,
		       updated_at = NOW(),
		       updated_by_user_id = $2
		 WHERE paneid = $3
	`, body, editorID, paneID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	s.mu.Lock()
	s.cache = nil
	s.mu.Unlock()
	return nil
}
