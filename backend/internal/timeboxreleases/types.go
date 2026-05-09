package timeboxreleases

import (
	"errors"
	"time"
)

var (
	ErrNotFound     = errors.New("release not found")
	ErrConflict     = errors.New("release dates overlap an existing release for this workspace and team")
	ErrInvalidInput = errors.New("invalid release input")
	ErrLifecycle    = errors.New("active or completed releases cannot be deleted")
)

// Release is the wire representation of a timebox_releases row.
type Release struct {
	ID                    string     `json:"id"`
	SubscriptionID        string     `json:"subscription_id"`
	WorkspaceID           string     `json:"workspace_id"`
	OrgNodeID             *string    `json:"org_node_id"`
	ReleaseName           string     `json:"release_name"`
	ReleaseSuffix         *string    `json:"release_suffix"`
	ReleaseOwner          *string    `json:"release_owner"`
	ReleaseCadenceDays    int        `json:"release_cadence_days"`
	ReleaseDateStart      string     `json:"release_date_start"`
	ReleaseDateEnd        string     `json:"release_date_end"`
	ReleaseScope          int        `json:"release_scope"`
	ReleaseVelocity       int        `json:"release_velocity"`
	ReleaseEstimate       int        `json:"release_estimate"`
	ReleaseCreepByCount   int        `json:"release_creep_by_count"`
	ReleaseCreepByEstimate int       `json:"release_creep_by_estimate"`
	Status                string     `json:"status"`
	ReleaseDateAdded      time.Time  `json:"release_date_added"`
	ReleaseDateUpdated    time.Time  `json:"release_date_updated"`
	ArchivedAt            *time.Time `json:"archived_at"`
}

// CreateReleaseInput holds required fields to create a release.
type CreateReleaseInput struct {
	SubscriptionID     string
	WorkspaceID        string
	OrgNodeID          *string
	ReleaseName        string
	ReleaseSuffix      *string
	ReleaseOwner       *string
	ReleaseCadenceDays int
	ReleaseDateStart   string
	ReleaseDateEnd     string
	ReleaseVelocity    *int
}

// UpdateReleaseInput holds optional fields for partial release update.
// Nil pointer = field unchanged.
type UpdateReleaseInput struct {
	ReleaseName        *string
	ReleaseSuffix      *string
	ReleaseOwner       *string
	ReleaseCadenceDays *int
	ReleaseDateStart   *string
	ReleaseDateEnd     *string
	ReleaseScope       *int
	ReleaseVelocity    *int
	ReleaseEstimate    *int
	Status             *string
}

// ListFilters holds query parameters for the list endpoint.
type ListFilters struct {
	OrgNodeID *string
	Status    *string
}

var validStatuses = map[string]bool{
	"planned": true, "active": true, "completed": true,
}
