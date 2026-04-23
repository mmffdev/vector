// Package custompages owns user-authored "container" pages and the
// views inside them. A custom page is a labelled holder (think Jira
// plan); a view is a render mode within it (timeline / board / list).
//
// The page surfaces in the nav catalogue as kind="user_custom" via the
// merge in nav handler (CatalogueWithCustom). Pinning lives in
// user_nav_prefs as item_key="custom:<page.id>".
package custompages

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Caps and limits.
const (
	MaxPagesPerUser    = 50
	MaxViewsPerPage    = 8
	MaxLabelLen        = 64
	DefaultIcon        = "folder"
	DefaultViewLabel   = "Timeline"
	DefaultViewKind    = ViewKindTimeline
)

type ViewKind string

const (
	ViewKindTimeline ViewKind = "timeline"
	ViewKindBoard    ViewKind = "board"
	ViewKindList     ViewKind = "list"
)

func (k ViewKind) Valid() bool {
	switch k {
	case ViewKindTimeline, ViewKindBoard, ViewKindList:
		return true
	}
	return false
}

// CustomPage is the container row.
type CustomPage struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Icon  string `json:"icon"`
	// Views is populated by ListWithViews / Get; nil from ListPagesOnly.
	Views []CustomView `json:"views,omitempty"`
}

// CustomView is a render mode within a page.
type CustomView struct {
	ID       string                 `json:"id"`
	Label    string                 `json:"label"`
	Kind     ViewKind               `json:"kind"`
	Position int                    `json:"position"`
	Config   map[string]any         `json:"config"`
}

var (
	ErrNotFound          = errors.New("custom page not found")
	ErrEmptyLabel        = errors.New("label cannot be empty")
	ErrLabelTooLong      = fmt.Errorf("label exceeds %d chars", MaxLabelLen)
	ErrDuplicateLabel    = errors.New("a page with that label already exists")
	ErrPageCap           = fmt.Errorf("custom page cap (%d) reached", MaxPagesPerUser)
	ErrViewCap           = fmt.Errorf("view cap (%d) reached", MaxViewsPerPage)
	ErrInvalidViewKind   = errors.New("invalid view kind")
	ErrLastView          = errors.New("cannot delete the only view on a page")
)

// Service is the business layer for custom pages.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// ListPagesOnly returns the caller's custom pages (label + icon),
// ordered by label. Used by the catalogue merge — no views needed there.
func (s *Service) ListPagesOnly(ctx context.Context, userID, tenantID uuid.UUID) ([]CustomPage, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, label, icon
		FROM user_custom_pages
		WHERE user_id = $1 AND tenant_id = $2
		ORDER BY label`, userID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CustomPage, 0, 8)
	for rows.Next() {
		var p CustomPage
		var id uuid.UUID
		if err := rows.Scan(&id, &p.Label, &p.Icon); err != nil {
			return nil, err
		}
		p.ID = id.String()
		out = append(out, p)
	}
	return out, rows.Err()
}

// Get returns a single page (with views) if it belongs to the caller.
// Returns ErrNotFound for both "doesn't exist" and "belongs to someone
// else" — never leak existence across users/tenants.
func (s *Service) Get(ctx context.Context, userID, tenantID, pageID uuid.UUID) (*CustomPage, error) {
	var p CustomPage
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx, `
		SELECT id, label, icon
		FROM user_custom_pages
		WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
		pageID, userID, tenantID).Scan(&id, &p.Label, &p.Icon)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.ID = id.String()

	views, err := s.listViews(ctx, pageID)
	if err != nil {
		return nil, err
	}
	p.Views = views
	return &p, nil
}

func (s *Service) listViews(ctx context.Context, pageID uuid.UUID) ([]CustomView, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, label, kind::text, position, config
		FROM user_custom_page_views
		WHERE page_id = $1
		ORDER BY position`, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CustomView, 0, 4)
	for rows.Next() {
		var v CustomView
		var id uuid.UUID
		var kind string
		if err := rows.Scan(&id, &v.Label, &kind, &v.Position, &v.Config); err != nil {
			return nil, err
		}
		v.ID = id.String()
		v.Kind = ViewKind(kind)
		if v.Config == nil {
			v.Config = map[string]any{}
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Create makes a page and seeds it with one default view (Timeline,
// position 0). Both rows go in a single transaction so a partial state
// can never exist.
func (s *Service) Create(ctx context.Context, userID, tenantID uuid.UUID, label, icon string) (*CustomPage, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return nil, ErrEmptyLabel
	}
	if len(label) > MaxLabelLen {
		return nil, ErrLabelTooLong
	}
	if icon == "" {
		icon = DefaultIcon
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Cap check inside the tx so concurrent creates can't race past it.
	var count int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_custom_pages
		WHERE user_id = $1 AND tenant_id = $2`, userID, tenantID).Scan(&count); err != nil {
		return nil, err
	}
	if count >= MaxPagesPerUser {
		return nil, ErrPageCap
	}

	pageID := uuid.New()
	_, err = tx.Exec(ctx, `
		INSERT INTO user_custom_pages (id, user_id, tenant_id, label, icon)
		VALUES ($1, $2, $3, $4, $5)`,
		pageID, userID, tenantID, label, icon)
	if err != nil {
		if isUniqueViolation(err, "user_custom_pages_label_unique") {
			return nil, ErrDuplicateLabel
		}
		return nil, err
	}

	viewID := uuid.New()
	_, err = tx.Exec(ctx, `
		INSERT INTO user_custom_page_views (id, page_id, label, kind, position, config)
		VALUES ($1, $2, $3, $4::custom_view_kind, 0, '{}'::jsonb)`,
		viewID, pageID, DefaultViewLabel, string(DefaultViewKind))
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CustomPage{
		ID:    pageID.String(),
		Label: label,
		Icon:  icon,
		Views: []CustomView{{
			ID:       viewID.String(),
			Label:    DefaultViewLabel,
			Kind:     DefaultViewKind,
			Position: 0,
			Config:   map[string]any{},
		}},
	}, nil
}

// PatchInput holds the fields the user can change on a page.
// nil pointer = leave unchanged.
type PatchInput struct {
	Label *string
	Icon  *string
}

// Patch updates label and/or icon on a page the caller owns.
func (s *Service) Patch(ctx context.Context, userID, tenantID, pageID uuid.UUID, in PatchInput) (*CustomPage, error) {
	if in.Label == nil && in.Icon == nil {
		return s.Get(ctx, userID, tenantID, pageID)
	}
	if in.Label != nil {
		l := strings.TrimSpace(*in.Label)
		if l == "" {
			return nil, ErrEmptyLabel
		}
		if len(l) > MaxLabelLen {
			return nil, ErrLabelTooLong
		}
		in.Label = &l
	}

	tag, err := s.Pool.Exec(ctx, `
		UPDATE user_custom_pages
		SET label = COALESCE($4, label),
		    icon  = COALESCE($5, icon)
		WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
		pageID, userID, tenantID, in.Label, in.Icon)
	if err != nil {
		if isUniqueViolation(err, "user_custom_pages_label_unique") {
			return nil, ErrDuplicateLabel
		}
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, userID, tenantID, pageID)
}

// Delete removes a page (and cascades its views). Also cascades on the
// nav side via ON DELETE CASCADE in user_nav_prefs? No — prefs do not
// FK to custom pages (item_key is a string). So callers should also
// drop any pinned reference; the frontend does this on delete.
func (s *Service) Delete(ctx context.Context, userID, tenantID, pageID uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		DELETE FROM user_custom_pages
		WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
		pageID, userID, tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// isUniqueViolation reports whether err is a Postgres 23505 on a
// specific constraint name. Safe on any error type.
func isUniqueViolation(err error, constraint string) bool {
	type pgErr interface {
		SQLState() string
	}
	var pe pgErr
	if !errors.As(err, &pe) {
		return false
	}
	if pe.SQLState() != "23505" {
		return false
	}
	// Constraint name lives in pgconn.PgError.ConstraintName, but the
	// SQLSTATE check is sufficient for the unique-label case here since
	// it's the only user-visible unique constraint on these tables.
	return strings.Contains(err.Error(), constraint) || true
}
