package lookups

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns lookup reads against mmff_vector.
type Service struct {
	pool *pgxpool.Pool
}

// NewService returns a Service backed by the given mmff_vector pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// ListUsersInScope returns all active users in the caller's subscription
// in slim wire form. Subscription clamp is hard-coded into the SQL; the
// caller cannot bypass it.
func (s *Service) ListUsersInScope(ctx context.Context, subscriptionID uuid.UUID) ([]UserInScope, error) {
	if s.pool == nil {
		return []UserInScope{}, nil
	}
	rows, err := s.pool.Query(ctx, sqlListUsersInScope, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("list users-in-scope: %w", err)
	}
	defer rows.Close()

	var out []UserInScope
	for rows.Next() {
		var u UserInScope
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.AvatarURL); err != nil {
			return nil, fmt.Errorf("scan users-in-scope row: %w", err)
		}
		out = append(out, u)
	}
	if out == nil {
		out = []UserInScope{}
	}
	return out, rows.Err()
}
