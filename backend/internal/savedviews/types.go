package savedviews

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors. Handlers translate these to HTTP status codes.
var (
	ErrNotFound        = errors.New("saved view not found")
	ErrForbidden       = errors.New("caller may not perform this action on this saved view")
	ErrInvalidInput    = errors.New("invalid saved-view input")
	ErrNotNodeMember   = errors.New("caller is not a member of the target topology node")
	ErrNotWSAdmin      = errors.New("caller is not a workspace admin")
	ErrTenantMismatch  = errors.New("scope id does not belong to the caller's subscription")
	ErrBodyTooLarge    = errors.New("saved view body exceeds 64KB cap")
)

// Scope values.
const (
	ScopeUser      = "user"
	ScopeNode      = "node"
	ScopeWorkspace = "workspace"
)

// Kind values.
const (
	KindObjectTree = "objecttree"
	KindPageLayout = "page_layout"
)

// View is the wire shape returned by the handler. Field names match the
// column-prefix convention so the frontend addresses fields with the
// same prefix the table uses.
type View struct {
	ID             uuid.UUID       `json:"saved_views_id"`
	SubscriptionID uuid.UUID       `json:"saved_views_id_subscription"`
	Kind           string          `json:"saved_views_kind"`
	Scope          string          `json:"saved_views_scope"`
	UserID         *uuid.UUID      `json:"saved_views_id_user,omitempty"`
	NodeID         *uuid.UUID      `json:"saved_views_id_node,omitempty"`
	WorkspaceID    *uuid.UUID      `json:"saved_views_id_workspace,omitempty"`
	Target         string          `json:"saved_views_target"`
	Name           string          `json:"saved_views_name"`
	Body           json.RawMessage `json:"saved_views_body"`
	CreatedBy      uuid.UUID       `json:"saved_views_id_user_created_by"`
	CreatedAt      time.Time       `json:"saved_views_created_at"`
	UpdatedAt      time.Time       `json:"saved_views_updated_at"`
	ArchivedAt     *time.Time      `json:"saved_views_archived_at,omitempty"`
}

// ListVisibleQuery is the parameter struct for ListVisibleToUser.
// Returns the union of three result sets:
//   - user-scoped views where SubscriptionID matches + UserID matches Actor
//   - node-scoped views where SubscriptionID matches + NodeID is in Actor's node memberships
//   - workspace-scoped views where SubscriptionID matches + WorkspaceID matches Actor's workspace
// All filtered by Kind + Target + archived_at IS NULL.
type ListVisibleQuery struct {
	SubscriptionID uuid.UUID
	ActorUserID    uuid.UUID
	ActorWorkspace uuid.UUID
	ActorNodeIDs   []uuid.UUID // nodes the actor is a member of
	Kind           string
	Target         string
}

// CreateInput is the parameter struct for Service.Create. Scope+IDs must
// satisfy CHECK constraint (exactly one of id_user/id_node/id_workspace
// matching scope). Tenant integrity verified by service.
type CreateInput struct {
	SubscriptionID uuid.UUID
	Kind           string
	Scope          string
	UserID         *uuid.UUID
	NodeID         *uuid.UUID
	WorkspaceID    *uuid.UUID
	Target         string
	Name           string
	Body           json.RawMessage
	ActorUserID    uuid.UUID // becomes id_user_created_by
}

// UpdateScopeInput is the parameter struct for Service.UpdateScope.
// Used to promote/demote a view between sharing scopes. ViewID and
// ActorUserID identify the row + the caller; new scope + scope ID
// replace the existing values.
type UpdateScopeInput struct {
	SubscriptionID uuid.UUID
	ViewID         uuid.UUID
	NewScope       string
	NewUserID      *uuid.UUID
	NewNodeID      *uuid.UUID
	NewWorkspaceID *uuid.UUID
	ActorUserID    uuid.UUID
}
