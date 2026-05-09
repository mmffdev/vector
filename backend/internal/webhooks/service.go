// Package webhooks is the SOLE writer for webhook_subscriptions and
// webhook_deliveries in vector_artefacts.
//
// Enqueue is the primary integration point for other packages:
//   webhooks.Enqueue(ctx, workspaceID, "item.created", payload)
//
// It fans the event out to every active matching subscription for
// the workspace, inserting one webhook_deliveries row per subscription.
// The delivery worker picks up those rows asynchronously.
package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound     = errors.New("webhook subscription not found")
	ErrInvalidInput = errors.New("invalid input")
)

// Subscription is the wire shape for a webhook_subscriptions row.
type Subscription struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	URL         string     `json:"url"`
	Events      *string    `json:"events"`
	IsActive    bool       `json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
}

// CreateInput is the payload for creating a new subscription.
type CreateInput struct {
	URL    string  `json:"url"`
	Events *string `json:"events"`
	Secret *string `json:"secret"`
}

// UpdateInput is the partial-update payload.
type UpdateInput struct {
	URL      *string `json:"url,omitempty"`
	Events   *string `json:"events,omitempty"`
	IsActive *bool   `json:"is_active,omitempty"`
}

// Service is the sole-writer surface.
type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// List returns all active subscriptions for a workspace.
func (s *Service) List(ctx context.Context, workspaceID uuid.UUID) ([]Subscription, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, workspace_id, url, events, is_active, created_at, updated_at, archived_at
		FROM webhook_subscriptions
		WHERE workspace_id = $1 AND archived_at IS NULL
		ORDER BY created_at`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Subscription
	for rows.Next() {
		var sub Subscription
		if err := rows.Scan(&sub.ID, &sub.WorkspaceID, &sub.URL, &sub.Events,
			&sub.IsActive, &sub.CreatedAt, &sub.UpdatedAt, &sub.ArchivedAt); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// Get returns one subscription by ID, scoped to workspace.
func (s *Service) Get(ctx context.Context, workspaceID, id uuid.UUID) (*Subscription, error) {
	var sub Subscription
	err := s.pool.QueryRow(ctx, `
		SELECT id, workspace_id, url, events, is_active, created_at, updated_at, archived_at
		FROM webhook_subscriptions
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
		id, workspaceID,
	).Scan(&sub.ID, &sub.WorkspaceID, &sub.URL, &sub.Events,
		&sub.IsActive, &sub.CreatedAt, &sub.UpdatedAt, &sub.ArchivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &sub, err
}

// Create registers a new webhook subscription.
func (s *Service) Create(ctx context.Context, workspaceID uuid.UUID, in CreateInput) (*Subscription, error) {
	if strings.TrimSpace(in.URL) == "" {
		return nil, fmt.Errorf("%w: url is required", ErrInvalidInput)
	}
	if !strings.HasPrefix(in.URL, "https://") && !strings.HasPrefix(in.URL, "http://") {
		return nil, fmt.Errorf("%w: url must begin with http:// or https://", ErrInvalidInput)
	}

	secret := ""
	if in.Secret != nil && strings.TrimSpace(*in.Secret) != "" {
		secret = strings.TrimSpace(*in.Secret)
	} else {
		secret = generateSecret()
	}

	var sub Subscription
	err := s.pool.QueryRow(ctx, `
		INSERT INTO webhook_subscriptions (workspace_id, url, events, secret)
		VALUES ($1, $2, $3, $4)
		RETURNING id, workspace_id, url, events, is_active, created_at, updated_at, archived_at`,
		workspaceID, in.URL, in.Events, secret,
	).Scan(&sub.ID, &sub.WorkspaceID, &sub.URL, &sub.Events,
		&sub.IsActive, &sub.CreatedAt, &sub.UpdatedAt, &sub.ArchivedAt)
	return &sub, err
}

// Update applies a partial update to a subscription.
func (s *Service) Update(ctx context.Context, workspaceID, id uuid.UUID, in UpdateInput) (*Subscription, error) {
	sets := []string{}
	args := []any{}
	add := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}

	if in.URL != nil {
		u := strings.TrimSpace(*in.URL)
		if u == "" {
			return nil, fmt.Errorf("%w: url cannot be empty", ErrInvalidInput)
		}
		if !strings.HasPrefix(u, "https://") && !strings.HasPrefix(u, "http://") {
			return nil, fmt.Errorf("%w: url must begin with http:// or https://", ErrInvalidInput)
		}
		add("url", u)
	}
	if in.Events != nil {
		add("events", in.Events)
	}
	if in.IsActive != nil {
		add("is_active", *in.IsActive)
	}

	if len(sets) == 0 {
		return s.Get(ctx, workspaceID, id)
	}

	args = append(args, id, workspaceID)
	q := fmt.Sprintf(
		`UPDATE webhook_subscriptions SET %s WHERE id = $%d AND workspace_id = $%d AND archived_at IS NULL`,
		strings.Join(sets, ", "), len(args)-1, len(args),
	)
	n, err := s.pool.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if n.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, workspaceID, id)
}

// Delete soft-deletes a subscription (sets archived_at).
func (s *Service) Delete(ctx context.Context, workspaceID, id uuid.UUID) error {
	n, err := s.pool.Exec(ctx, `
		UPDATE webhook_subscriptions SET archived_at = now()
		WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
		id, workspaceID,
	)
	if err != nil {
		return err
	}
	if n.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Enqueue fans an event out to every active, matching subscription
// for the workspace, inserting one webhook_deliveries row per
// subscription. Safe to call from any goroutine.
func (s *Service) Enqueue(ctx context.Context, workspaceID uuid.UUID, eventType string, payload []byte) error {
	rows, err := s.pool.Query(ctx, `
		SELECT id, events FROM webhook_subscriptions
		WHERE workspace_id = $1 AND is_active = TRUE AND archived_at IS NULL`,
		workspaceID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var subID uuid.UUID
		var events *string
		if err := rows.Scan(&subID, &events); err != nil {
			return err
		}
		if !matchesFilter(events, eventType) {
			continue
		}
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO webhook_deliveries (subscription_id, event_type, payload)
			VALUES ($1, $2, $3)`,
			subID, eventType, payload,
		); err != nil {
			return err
		}
	}
	return rows.Err()
}

// matchesFilter returns true if the subscription's event filter
// matches the given event type. nil or "*" matches everything.
func matchesFilter(filter *string, eventType string) bool {
	if filter == nil || *filter == "" || *filter == "*" {
		return true
	}
	for _, f := range strings.Split(*filter, ",") {
		if strings.TrimSpace(f) == eventType {
			return true
		}
	}
	return false
}

func generateSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("webhooks: failed to generate secret: %v", err))
	}
	return hex.EncodeToString(b)
}
