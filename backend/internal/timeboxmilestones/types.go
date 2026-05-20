package timeboxmilestones

import (
	"errors"
	"time"
)

var (
	ErrNotFound     = errors.New("milestone not found")
	ErrInvalidInput = errors.New("invalid milestone input")
)

// Milestone is the wire representation of a timeboxes_milestones row.
// JSON tags follow §2.3 — wire keys match the column names.
type Milestone struct {
	ID                   string     `json:"timeboxes_milestones_id"`
	SubscriptionID       string     `json:"timeboxes_milestones_id_subscription"`
	WorkspaceID          string     `json:"timeboxes_milestones_id_workspace"`
	OrgNodeID            *string    `json:"timeboxes_milestones_id_topology_node"`
	MilestoneName        string     `json:"timeboxes_milestones_name"`
	MilestoneDescription *string    `json:"timeboxes_milestones_description"`
	MilestoneOwner       *string    `json:"timeboxes_milestones_id_user_owner"`
	MilestoneDateTarget  string     `json:"timeboxes_milestones_date_target"`
	Status               string     `json:"timeboxes_milestones_status"`
	Position             int        `json:"timeboxes_milestones_position"`
	CreatedAt            time.Time  `json:"timeboxes_milestones_created_at"`
	UpdatedAt            time.Time  `json:"timeboxes_milestones_updated_at"`
	ArchivedAt           *time.Time `json:"timeboxes_milestones_archived_at"`
}

// CreateMilestoneInput holds required fields to create a milestone.
type CreateMilestoneInput struct {
	SubscriptionID       string
	WorkspaceID          string
	OrgNodeID            *string
	MilestoneName        string
	MilestoneDescription *string
	MilestoneOwner       *string
	MilestoneDateTarget  string
	Position             *int
}

// UpdateMilestoneInput holds optional fields for partial milestone update.
// Nil pointer = field unchanged.
type UpdateMilestoneInput struct {
	MilestoneName        *string
	MilestoneDescription *string
	MilestoneOwner       *string
	MilestoneDateTarget  *string
	Status               *string
	Position             *int
}

// ListFilters holds query parameters for the list endpoint.
type ListFilters struct {
	OrgNodeID *string
	Status    *string
}

var validStatuses = map[string]bool{
	"planned":   true,
	"active":    true,
	"completed": true,
	"missed":    true,
}
