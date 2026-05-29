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
	// Slice 5B — write rejected because the release is being viewed from a
	// descendant of its pinned topology node (heartbeat inheritance read).
	ErrInheritedReadOnly = errors.New("inherited release is read-only from this scope; edit it on its pinned node")
)

// Release is the wire representation of a timeboxes_releases row. JSON
// tags follow §2.3 — wire keys match the column names.
type Release struct {
	ID                     string     `json:"timeboxes_releases_id"`
	SubscriptionID         string     `json:"timeboxes_releases_id_subscription"`
	WorkspaceID            string     `json:"timeboxes_releases_id_workspace"`
	OrgNodeID              *string    `json:"timeboxes_releases_id_topology_node"`
	ReleaseName            string     `json:"timeboxes_releases_name"`
	ReleaseSuffix          *string    `json:"timeboxes_releases_suffix"`
	ReleaseOwner           *string    `json:"timeboxes_releases_id_user_owner"`
	ReleaseCadenceDays     int        `json:"timeboxes_releases_cadence_days"`
	ReleaseDateStart       string     `json:"timeboxes_releases_date_start"`
	ReleaseDateEnd         string     `json:"timeboxes_releases_date_end"`
	ReleaseScope           int        `json:"timeboxes_releases_scope"`
	ReleaseVelocity        int        `json:"timeboxes_releases_velocity"`
	ReleaseEstimate        int        `json:"timeboxes_releases_estimate"`
	ReleaseCreepByCount    int        `json:"timeboxes_releases_creep_by_count"`
	ReleaseCreepByEstimate int        `json:"timeboxes_releases_creep_by_estimate"`
	Status                 string     `json:"timeboxes_releases_status"`
	ReleaseDateAdded       time.Time  `json:"timeboxes_releases_created_at"`
	ReleaseDateUpdated     time.Time  `json:"timeboxes_releases_updated_at"`
	ArchivedAt             *time.Time `json:"timeboxes_releases_archived_at"`
	// Slice 5 of the ObjectTree refactor — heartbeat substrate. See
	// the matching field on Sprint (backend/internal/timeboxsprints/
	// types.go) for the contract. Values: 'this_node_only' (default)
	// or 'this_node_and_descendants'.
	ScopePropagation string `json:"timeboxes_releases_scope_propagation"`
	// Slice 5B — non-persisted read-time metadata. Mirror of Sprint.
	Origin       string  `json:"origin,omitempty"`
	FromNodeID   *string `json:"from_node_id,omitempty"`
	FromNodeName *string `json:"from_node_name,omitempty"`
	// Rally-screenshots batch (2026-05-29, migration 157). Five new
	// numeric/text columns. Actuals is NOT NULL DEFAULT 0; plan_estimate
	// / planned_velocity / gross_estimate_conversion_ratio are nullable.
	// Theme is free-form TEXT.
	// Spec: docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md §4.8
	Actuals                       string  `json:"timeboxes_releases_actuals"`
	PlanEstimate                  *string `json:"timeboxes_releases_plan_estimate"`
	PlannedVelocity               *string `json:"timeboxes_releases_planned_velocity"`
	Theme                         *string `json:"timeboxes_releases_theme"`
	GrossEstimateConversionRatio  *string `json:"timeboxes_releases_gross_estimate_conversion_ratio"`
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
	// Slice 5 — propagation intent. Nil = use the DB default
	// ('this_node_only'). Valid non-nil values:
	//   'this_node_only', 'this_node_and_descendants'
	ScopePropagation *string
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
	// Slice 7 — toggle propagation intent from the edit form.
	// Valid values: 'this_node_only' | 'this_node_and_descendants'.
	ScopePropagation *string
	// Rally-screenshots batch (mig 157). Numerics enter as *string for
	// precision (mirrors artefactitems). Three-state: nil ⇒ skip; "" ⇒
	// clear-to-NULL (Actuals is NOT NULL — service rejects empty);
	// non-"" ⇒ write through ::numeric. GrossEstimateConversionRatio
	// is range-bound 0..10 in the DB.
	Actuals                      *string
	PlanEstimate                 *string
	PlannedVelocity              *string
	Theme                        *string
	GrossEstimateConversionRatio *string
}

// ListFilters holds query parameters for the list endpoint.
type ListFilters struct {
	OrgNodeID *string
	Status    *string
	// Slice 5B — opt-in ancestor-walk on List. See the matching field
	// on timeboxsprints.ListFilters for the full contract.
	SubscriptionID *string
}

var validStatuses = map[string]bool{
	"planned": true, "active": true, "completed": true,
}
