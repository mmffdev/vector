package notifications

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service exposes the user-facing read surface: list the bell,
// count unread, mark read, list+update preferences. Backed by
// users_notifications + users_notifications_prefs on mmff_vector.
type Service struct {
	pool  *pgxpool.Pool
	prefs *Prefs
}

func NewService(pool *pgxpool.Pool, prefs *Prefs) *Service {
	return &Service{pool: pool, prefs: prefs}
}

// UserNotification is the wire shape of one users_notifications row.
type UserNotification struct {
	ID             uuid.UUID  `json:"users_notifications_id"`
	SubscriptionID uuid.UUID  `json:"users_notifications_id_subscription"`
	UserID         uuid.UUID  `json:"users_notifications_id_user"`
	Kind           string     `json:"users_notifications_kind"`
	Title          string     `json:"users_notifications_title"`
	Body           string     `json:"users_notifications_body"`
	ContextKind    *string    `json:"users_notifications_context_kind,omitempty"`
	ContextID      *string    `json:"users_notifications_context_id,omitempty"`
	ContextLabel   *string    `json:"users_notifications_context_label,omitempty"`
	CreatedAt      time.Time  `json:"users_notifications_created_at"`
	ReadAt         *time.Time `json:"users_notifications_read_at,omitempty"`
}

// ListFilters narrows the bell list.
type ListFilters struct {
	OnlyUnread bool
	Limit      int
}

// List returns the user's notifications, newest first.
func (s *Service) List(ctx context.Context, subscriptionID, userID uuid.UUID, f ListFilters) ([]UserNotification, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	conds := []string{
		"users_notifications_id_subscription = $1",
		"users_notifications_id_user         = $2",
	}
	args := []any{subscriptionID, userID}
	if f.OnlyUnread {
		conds = append(conds, "users_notifications_read_at IS NULL")
	}
	q := fmt.Sprintf(sqlListUserNotificationsTemplate, strings.Join(conds, " AND "), len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	out := []UserNotification{}
	for rows.Next() {
		var n UserNotification
		if err := rows.Scan(
			&n.ID, &n.SubscriptionID, &n.UserID,
			&n.Kind, &n.Title, &n.Body,
			&n.ContextKind, &n.ContextID, &n.ContextLabel,
			&n.CreatedAt, &n.ReadAt,
		); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// UnreadCount returns the user's unread bell count.
func (s *Service) UnreadCount(ctx context.Context, subscriptionID, userID uuid.UUID) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, sqlCountUnreadUserNotifications, subscriptionID, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("unread count: %w", err)
	}
	return n, nil
}

// MarkRead flips read_at on one row, asserting ownership.
func (s *Service) MarkRead(ctx context.Context, notificationID, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, sqlMarkUserNotificationRead, notificationID, userID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkAllRead clears the unread flag on every row the user owns
// within their subscription. Returns the number of rows affected.
func (s *Service) MarkAllRead(ctx context.Context, subscriptionID, userID uuid.UUID) (int, error) {
	tag, err := s.pool.Exec(ctx, sqlMarkAllUserNotificationsRead, subscriptionID, userID)
	if err != nil {
		return 0, fmt.Errorf("mark all read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// ListPrefs returns the explicit prefs the user has set. Defaults
// (no row = enabled) are applied at delivery time by the dispatchers.
func (s *Service) ListPrefs(ctx context.Context, userID uuid.UUID) ([]Pref, error) {
	return s.prefs.ListForUser(ctx, userID)
}

// UpsertPref writes one (kind, channel, enabled) row.
func (s *Service) UpsertPref(ctx context.Context, userID uuid.UUID, kind, channel string, enabled bool) error {
	if !validChannel(channel) {
		return fmt.Errorf("%w: channel %q", ErrInvalidInput, channel)
	}
	return s.prefs.Upsert(ctx, userID, kind, channel, enabled)
}

func validChannel(c string) bool {
	switch c {
	case "in_app", "email", "sse":
		return true
	}
	return false
}
