package timeboxsprints

import (
	"errors"
	"time"
)

var (
	ErrNotFound       = errors.New("sprint not found")
	ErrConflict       = errors.New("sprint dates overlap an existing sprint for this workspace and team")
	ErrAdjacency      = errors.New("sprint start date must be exactly one day after the previous sprint's end date")
	ErrInvalidInput   = errors.New("invalid sprint input")
	ErrLifecycle      = errors.New("active or completed sprints cannot be deleted")
	ErrStartLifecycle = errors.New("only planned sprints can be started")
	ErrCloseLifecycle = errors.New("only active sprints can be closed")
)

// Sprint is the wire representation of a timebox_sprints row.
type Sprint struct {
	ID               string     `json:"id"`
	SubscriptionID   string     `json:"subscription_id"`
	WorkspaceID      string     `json:"workspace_id"`
	OrgNodeID        *string    `json:"org_node_id"`
	SprintName       string     `json:"sprint_name"`
	SprintSuffix     *string    `json:"sprint_suffix"`
	SprintOwner      *string    `json:"sprint_owner"`
	SprintCadenceDays int       `json:"sprint_cadence_days"`
	SprintDateStart  string     `json:"sprint_date_start"`
	SprintDateEnd    string     `json:"sprint_date_end"`
	SprintScope      int        `json:"sprint_scope"`
	SprintVelocity   int        `json:"sprint_velocity"`
	SprintEstimate   int        `json:"sprint_estimate"`
	SprintCreepByCount    int   `json:"sprint_creep_by_count"`
	SprintCreepByEstimate int   `json:"sprint_creep_by_estimate"`
	Status           string     `json:"status"`
	SprintDateAdded  time.Time  `json:"sprint_date_added"`
	SprintDateUpdated time.Time `json:"sprint_date_updated"`
	ArchivedAt       *time.Time `json:"archived_at"`
}

// CreateSprintInput holds required fields to create a sprint.
type CreateSprintInput struct {
	SubscriptionID    string
	WorkspaceID       string
	OrgNodeID         *string
	SprintName        string
	SprintSuffix      *string
	SprintOwner       *string
	SprintCadenceDays int
	SprintDateStart   string
	SprintDateEnd     string
	SprintVelocity    *int
}

// UpdateSprintInput holds optional fields for partial sprint update.
// Nil pointer = field unchanged.
type UpdateSprintInput struct {
	SprintName        *string
	SprintSuffix      *string
	SprintOwner       *string
	SprintCadenceDays *int
	SprintDateStart   *string
	SprintDateEnd     *string
	SprintScope       *int
	SprintVelocity    *int
	SprintEstimate    *int
	Status            *string
}

// ListFilters holds query parameters for the list endpoint.
type ListFilters struct {
	OrgNodeID *string
	Status    *string
}

// validStatuses is the set of allowed sprint status values.
var validStatuses = map[string]bool{
	"planned": true, "active": true, "completed": true,
}
