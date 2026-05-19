package costcentres

import (
	"time"

	"github.com/google/uuid"
)

// CostCentre is one row of cost_centres. parent_id is nullable so
// top-level centres carry NULL; hierarchy depth is operator-managed
// (no DB-level depth cap today).
type CostCentre struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	ParentID       *uuid.UUID `json:"parent_id,omitempty"`
	Code           string     `json:"code"`
	Name           string     `json:"name"`
	IsActive       bool       `json:"is_active"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
