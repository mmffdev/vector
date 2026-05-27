package templates

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── Sentinel errors ───────────────────────────────────────────────────────────

var (
	// ErrTemplateMissing is returned by Render / RenderOverride when no
	// template row satisfies the (event_type, channel, locale) lookup — not
	// even the en-GB fallback. Callers should fall back to a generic title/body
	// or log and continue; a missing template is non-fatal for the pipeline.
	ErrTemplateMissing = errors.New("template: no matching template found")

	// ErrTemplateNotFound is returned by Get when the requested template ID does
	// not exist. Distinct from ErrTemplateMissing so callers can distinguish
	// "lookup found nothing" (Render) from "explicit ID lookup failed" (Get).
	ErrTemplateNotFound = errors.New("template: template not found")

	// ErrInvalidLocale is returned when the locale string fails basic sanity
	// (empty or longer than 35 chars — longer than any IETF BCP 47 tag).
	ErrInvalidLocale = errors.New("template: invalid locale")
)

// ── Domain types ──────────────────────────────────────────────────────────────

// Template is the in-memory representation of one notifications_templates row.
//
// Note on Channel + EventType: the v2 domain package (S02, parallel story) will
// supply typed Channel and EventType values. Until S02 lands and the validator
// rebases, these fields use plain strings so this package compiles independently.
// The validator will update these to domain.Channel / domain.EventType on merge.
type Template struct {
	ID        uuid.UUID `json:"notifications_templates_id"`
	EventType string    `json:"notifications_templates_event_type"`
	Channel   string    `json:"notifications_templates_channel"`
	Locale    string    `json:"notifications_templates_locale"`
	Subject   string    `json:"notifications_templates_subject"`
	Body      string    `json:"notifications_templates_body"`
	Version   int       `json:"notifications_templates_version"`
	Active    bool      `json:"notifications_templates_active"`
	CreatedAt time.Time `json:"notifications_templates_created_at"`
	UpdatedAt time.Time `json:"notifications_templates_updated_at"`
}

// ListFilter narrows a List query.
type ListFilter struct {
	EventType string
	Channel   string
	Locale    string
	ActiveOnly bool
}

// ── Service interface ─────────────────────────────────────────────────────────

// Service is the v2 templates surface. All methods are safe for concurrent use.
type Service interface {
	// Render performs the standard lookup: (event_type, channel, locale, latest
	// active version). If no row is found for the given locale, falls back to
	// locale='en-GB'. If still no row, returns ErrTemplateMissing.
	// Subject and Body are interpolated with data before returning.
	Render(ctx context.Context, eventType, channel, locale string, data map[string]any) (subject, body string, err error)

	// RenderOverride bypasses the standard lookup and uses the explicit templateID.
	// Used by rules with a template_override_id set. Returns ErrTemplateNotFound
	// if the ID does not exist or the template is inactive.
	RenderOverride(ctx context.Context, templateID uuid.UUID, data map[string]any) (subject, body string, err error)

	// Create inserts a new template row. The caller must supply EventType,
	// Channel, Locale, Subject, Body. Version defaults to 1 if zero.
	Create(ctx context.Context, t Template) (Template, error)

	// Get returns the template with the given ID. Returns ErrTemplateNotFound if
	// not present.
	Get(ctx context.Context, id uuid.UUID) (Template, error)

	// Update applies patch fields (Subject, Body, Active, Version) to the
	// template identified by id. Returns ErrTemplateNotFound if not present.
	Update(ctx context.Context, id uuid.UUID, patch Template) (Template, error)

	// Delete removes the template row permanently. Returns ErrTemplateNotFound
	// if not present.
	Delete(ctx context.Context, id uuid.UUID) error

	// List returns templates matching filter. An empty filter returns all rows.
	List(ctx context.Context, filter ListFilter) ([]Template, error)
}

// ── pgService — Postgres implementation ──────────────────────────────────────

// pgService implements Service against the vector_artefacts pool.
type pgService struct {
	pool *pgxpool.Pool
}

// NewService constructs a Postgres-backed template Service.
func NewService(pool *pgxpool.Pool) Service {
	return &pgService{pool: pool}
}

// validateLocale is a cheap guard before we hit the DB.
func validateLocale(locale string) error {
	if locale == "" || len(locale) > 35 {
		return fmt.Errorf("%w: %q", ErrInvalidLocale, locale)
	}
	return nil
}

// ── Render ────────────────────────────────────────────────────────────────────

// Render looks up the best active template for (event_type, channel, locale) and
// interpolates subject + body with data.
func (s *pgService) Render(ctx context.Context, eventType, channel, locale string, data map[string]any) (string, string, error) {
	if err := validateLocale(locale); err != nil {
		return "", "", err
	}

	row, err := s.lookup(ctx, eventType, channel, locale)
	if errors.Is(err, ErrTemplateMissing) && locale != "en-GB" {
		// Locale-specific template not found — fall back to en-GB.
		row, err = s.lookup(ctx, eventType, channel, "en-GB")
	}
	if err != nil {
		return "", "", err
	}

	return Interpolate(row.Subject, data), Interpolate(row.Body, data), nil
}

// lookup returns the highest-version active template for (event_type, channel, locale).
func (s *pgService) lookup(ctx context.Context, eventType, channel, locale string) (Template, error) {
	const q = `
		SELECT
			notifications_templates_id,
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active,
			notifications_templates_created_at,
			notifications_templates_updated_at
		FROM notifications_templates
		WHERE notifications_templates_event_type = $1
		  AND notifications_templates_channel     = $2
		  AND notifications_templates_locale      = $3
		  AND notifications_templates_active      = true
		ORDER BY notifications_templates_version DESC
		LIMIT 1
	`
	row := s.pool.QueryRow(ctx, q, eventType, channel, locale)
	t, err := scanTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrTemplateMissing
	}
	return t, err
}

// ── RenderOverride ────────────────────────────────────────────────────────────

func (s *pgService) RenderOverride(ctx context.Context, templateID uuid.UUID, data map[string]any) (string, string, error) {
	t, err := s.Get(ctx, templateID)
	if err != nil {
		return "", "", err
	}
	if !t.Active {
		return "", "", fmt.Errorf("%w: template %s is inactive", ErrTemplateMissing, templateID)
	}
	return Interpolate(t.Subject, data), Interpolate(t.Body, data), nil
}

// ── Create ────────────────────────────────────────────────────────────────────

func (s *pgService) Create(ctx context.Context, t Template) (Template, error) {
	if t.Version <= 0 {
		t.Version = 1
	}
	const q = `
		INSERT INTO notifications_templates (
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING
			notifications_templates_id,
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active,
			notifications_templates_created_at,
			notifications_templates_updated_at
	`
	row := s.pool.QueryRow(ctx, q,
		t.EventType, t.Channel, t.Locale, t.Subject, t.Body, t.Version, t.Active,
	)
	return scanTemplate(row)
}

// ── Get ───────────────────────────────────────────────────────────────────────

func (s *pgService) Get(ctx context.Context, id uuid.UUID) (Template, error) {
	const q = `
		SELECT
			notifications_templates_id,
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active,
			notifications_templates_created_at,
			notifications_templates_updated_at
		FROM notifications_templates
		WHERE notifications_templates_id = $1
	`
	row := s.pool.QueryRow(ctx, q, id)
	t, err := scanTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrTemplateNotFound
	}
	return t, err
}

// ── Update ────────────────────────────────────────────────────────────────────

func (s *pgService) Update(ctx context.Context, id uuid.UUID, patch Template) (Template, error) {
	const q = `
		UPDATE notifications_templates
		SET
			notifications_templates_subject    = $2,
			notifications_templates_body       = $3,
			notifications_templates_active     = $4,
			notifications_templates_version    = $5,
			notifications_templates_updated_at = now()
		WHERE notifications_templates_id = $1
		RETURNING
			notifications_templates_id,
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active,
			notifications_templates_created_at,
			notifications_templates_updated_at
	`
	row := s.pool.QueryRow(ctx, q, id, patch.Subject, patch.Body, patch.Active, patch.Version)
	t, err := scanTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrTemplateNotFound
	}
	return t, err
}

// ── Delete ────────────────────────────────────────────────────────────────────

func (s *pgService) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM notifications_templates WHERE notifications_templates_id = $1`,
		id,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTemplateNotFound
	}
	return nil
}

// ── List ──────────────────────────────────────────────────────────────────────

func (s *pgService) List(ctx context.Context, filter ListFilter) ([]Template, error) {
	q := `
		SELECT
			notifications_templates_id,
			notifications_templates_event_type,
			notifications_templates_channel,
			notifications_templates_locale,
			notifications_templates_subject,
			notifications_templates_body,
			notifications_templates_version,
			notifications_templates_active,
			notifications_templates_created_at,
			notifications_templates_updated_at
		FROM notifications_templates
		WHERE 1=1
	`
	args := []any{}
	n := 1

	if filter.EventType != "" {
		q += fmt.Sprintf(" AND notifications_templates_event_type = $%d", n)
		args = append(args, filter.EventType)
		n++
	}
	if filter.Channel != "" {
		q += fmt.Sprintf(" AND notifications_templates_channel = $%d", n)
		args = append(args, filter.Channel)
		n++
	}
	if filter.Locale != "" {
		q += fmt.Sprintf(" AND notifications_templates_locale = $%d", n)
		args = append(args, filter.Locale)
		n++
	}
	if filter.ActiveOnly {
		q += " AND notifications_templates_active = true"
	}
	q += " ORDER BY notifications_templates_event_type, notifications_templates_channel, notifications_templates_version DESC"

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Template
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ── scanner helper ────────────────────────────────────────────────────────────

// scanTemplate scans a single template row. Accepts anything that satisfies
// the pgx row-scanning interface (pgx.Row, pgx.Rows both work).
type rowScanner interface {
	Scan(dest ...any) error
}

func scanTemplate(row rowScanner) (Template, error) {
	var t Template
	err := row.Scan(
		&t.ID,
		&t.EventType,
		&t.Channel,
		&t.Locale,
		&t.Subject,
		&t.Body,
		&t.Version,
		&t.Active,
		&t.CreatedAt,
		&t.UpdatedAt,
	)
	return t, err
}
