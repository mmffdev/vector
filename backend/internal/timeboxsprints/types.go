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

// Sprint is the wire representation of a timeboxes_sprints row. JSON
// tags follow §2.3 — the wire keys match the column names so the
// frontend can address fields with the same prefix it uses for the
// other timeboxes table.
type Sprint struct {
	ID                    string     `json:"timeboxes_sprints_id"`
	SubscriptionID        string     `json:"timeboxes_sprints_id_subscription"`
	WorkspaceID           string     `json:"timeboxes_sprints_id_workspace"`
	OrgNodeID             *string    `json:"timeboxes_sprints_id_topology_node"`
	SprintName            string     `json:"timeboxes_sprints_name"`
	SprintSuffix          *string    `json:"timeboxes_sprints_suffix"`
	SprintOwner           *string    `json:"timeboxes_sprints_id_user_owner"`
	SprintCadenceDays     int        `json:"timeboxes_sprints_cadence_days"`
	SprintDateStart       string     `json:"timeboxes_sprints_date_start"`
	SprintDateEnd         string     `json:"timeboxes_sprints_date_end"`
	SprintScope           int        `json:"timeboxes_sprints_scope"`
	SprintVelocity        int        `json:"timeboxes_sprints_velocity"`
	SprintEstimate        int        `json:"timeboxes_sprints_estimate"`
	SprintCreepByCount    int        `json:"timeboxes_sprints_creep_by_count"`
	SprintCreepByEstimate int        `json:"timeboxes_sprints_creep_by_estimate"`
	Status                string     `json:"timeboxes_sprints_status"`
	SprintDateAdded       time.Time  `json:"timeboxes_sprints_created_at"`
	SprintDateUpdated     time.Time  `json:"timeboxes_sprints_updated_at"`
	ArchivedAt            *time.Time `json:"timeboxes_sprints_archived_at"`
	// Slice 5 of the ObjectTree refactor — heartbeat substrate. Values:
	//   'this_node_only'           — visible only on the pinned node (default)
	//   'this_node_and_descendants' — visible on the pinned node AND
	//                                  every live descendant (computed
	//                                  at read time via ancestor-walk;
	//                                  Phase B). The persisted column
	//                                  controls intent; read-side
	//                                  visibility is derived from it.
	ScopePropagation string `json:"timeboxes_sprints_scope_propagation"`
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
	// Slice 5 — propagation intent. Nil = use the DB default
	// ('this_node_only'). Valid non-nil values:
	//   'this_node_only', 'this_node_and_descendants'
	ScopePropagation *string
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
