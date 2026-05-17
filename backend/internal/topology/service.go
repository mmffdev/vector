// Package orgdesign is the SOLE writer for topology_nodes,
// users_roles_topology_nodes, and topology_view_states. Every INSERT/UPDATE/
// DELETE against any of these tables must pass through this package.
//
// The Topology canvas (PLA-0006) treats the topology_nodes tree as the
// source of truth for tenant organisational structure. Every other
// clamp / rollup / audit / cross-team-move feature in Vector reads
// from it, so a single corrupting writer outside this boundary has
// blast radius across the whole product. See docs/c_c_topology.md
// for the MVP decisions.
//
// The boundary is enforced by:
//   1. This package being the only place that holds the SQL strings
//      for those three tables in Go code.
//   2. boundary_test.go in this package, which runs ripgrep over
//      every .go file in the repo and fails CI if any file outside
//      backend/internal/orgdesign/ writes to one of the tables.
//
// SQL migrations are exempt from the boundary (the test scopes to
// .go files).
//
// M6.2.7 cutover (PLA-0006): topology_nodes, users_roles_topology_nodes,
// topology_view_states, and topology_commits all live in the
// vector_artefacts database. Every topology read/write goes through
// s.vaPool. The legacy s.pool (mmff_vector) is retained only for
// membership/auth checks (e.g. the PoolWorkspaceLookup adapter) —
// no topology I/O touches it after PLA-0023 P6 (2026-05-13, mig 180
// + VA mig 053).
package topology

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// LayoutMode is the closed vocabulary for topology_nodes.layout_mode.
// Mirrored by the CHECK constraint in artefacts migration 031.
type LayoutMode string

const (
	LayoutAutoHorizontal LayoutMode = "auto-horizontal"
	LayoutAutoVertical   LayoutMode = "auto-vertical"
	LayoutAutoRadial     LayoutMode = "auto-radial"
	LayoutManual         LayoutMode = "manual"
)

func (l LayoutMode) IsValid() bool {
	switch l {
	case LayoutAutoHorizontal, LayoutAutoVertical, LayoutAutoRadial, LayoutManual:
		return true
	}
	return false
}

// Role is the closed vocabulary for users_roles_topology_nodes.role_code.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

func (r Role) IsValid() bool {
	switch r {
	case RoleAdmin, RoleEditor, RoleViewer:
		return true
	}
	return false
}

// Sentinel errors. Map these to HTTP statuses in the handler:
//
//	ErrNodeNotFound        → 404
//	ErrTenantMismatch      → 404 (don't leak existence to other tenants)
//	ErrCycleDetected       → 400
//	ErrInvalidLayoutMode   → 400
//	ErrInvalidRole         → 400
//	ErrInvalidName         → 400
//	ErrManualXYRequired    → 400
//	ErrManualXYForbidden   → 400
//	ErrAdminAlreadyGranted → 409 (MVP single-admin constraint)
//	ErrGrantNotFound       → 404
//	ErrDelegationDepth     → 403 (story 00288: single-level delegation)
//	ErrRedelegationDisabled → 403 (story 00288: can_redelegate is Phase X)
//	ErrWorkspaceRequired   → 400 (writes need a workspace clamp)
var (
	ErrNodeNotFound         = errors.New("orgdesign: node not found")
	ErrTenantMismatch       = errors.New("orgdesign: node not found")
	ErrCycleDetected        = errors.New("orgdesign: move would create a cycle")
	ErrInvalidLayoutMode    = errors.New("orgdesign: invalid layout_mode")
	ErrInvalidRole          = errors.New("orgdesign: invalid role")
	ErrInvalidName          = errors.New("orgdesign: name must be non-empty")
	ErrManualXYRequired     = errors.New("orgdesign: manual layout requires manual_x and manual_y")
	ErrManualXYForbidden    = errors.New("orgdesign: manual_x/manual_y only allowed when layout_mode='manual'")
	ErrAdminAlreadyGranted  = errors.New("orgdesign: an active admin grant already exists for this node")
	ErrGrantNotFound        = errors.New("orgdesign: role grant not found")
	ErrDelegationDepth      = errors.New("orgdesign: delegation depth exceeded — only gadmin may grant in MVP")
	ErrRedelegationDisabled = errors.New("orgdesign: can_redelegate is reserved for Phase X — must be false in MVP")
	ErrCommitForbidden      = errors.New("orgdesign: only gadmin may commit the topology working model")
	ErrResetForbidden       = errors.New("orgdesign: only gadmin may reset the topology canvas")
	ErrWorkspaceRequired    = errors.New("orgdesign: write requires a workspace clamp on context")
	// Restore-specific. ErrNotArchived guards POST /restore from being
	// run against a live node. ErrParentArchived / ErrParentMissing
	// surface the two cases where the requested landing parent is not
	// a valid restoration target.
	ErrNotArchived    = errors.New("orgdesign: node is not archived")
	ErrParentArchived = errors.New("orgdesign: target parent is archived — pick a live new_parent_id")
	ErrParentMissing  = errors.New("orgdesign: target parent does not exist")

	// ErrForbidden is returned when a service-level role/permission gate
	// blocks the caller. Mapped to HTTP 403 by the handler (the handler
	// checks errors.Is(err, ErrForbidden) explicitly so writeErr does
	// not need to know about it). Used by ListGrantsByUser (PLA-0046)
	// to refuse non-gadmin actors as defence-in-depth alongside the
	// route-level RequirePermission gate.
	ErrForbidden = errors.New("orgdesign: forbidden")
)

// GrantNotifier receives a one-shot notification each time a new
// grant is created (not on idempotent re-grant). Used by the handoff
// inbox (story 00283) to push a per-user realtime event so the
// granted user's UI can offer a deep-link back to /topology?focus=…
//
// Wired via WithNotifier; nil by default — Service stays usable in
// tests and tools that don't run the realtime hub.
type GrantNotifier interface {
	NotifyGrant(userID uuid.UUID, payload GrantNotification)
}

// GrantNotification is the wire-shape published by NotifyGrant.
// Stable JSON shape; the frontend hook (useTopologyHandoffs)
// unmarshals it directly.
type GrantNotification struct {
	GrantID       uuid.UUID `json:"grant_id"`
	NodeID        uuid.UUID `json:"node_id"`
	NodeName      string    `json:"node_name"`
	LabelOverride *string   `json:"label_override,omitempty"`
	Role          Role      `json:"role"`
	GrantedBy     uuid.UUID `json:"granted_by"`
	GrantedAt     time.Time `json:"granted_at"`
}

// Service is the sole writer for the three Topology tables.
//
// pool   — mmff_vector. Membership / auth lookups (PoolWorkspaceLookup)
//
//	and non-topology bookkeeping (subscriptions.topology_committed_*).
//	NOT used for any topology read or write after M6.2.7.
//
// vaPool — vector_artefacts. EVERY topology read/write goes here. The
//
//	three boundary tables (topology_nodes, users_roles_topology_nodes,
//	topology_view_states) only exist in this database.
type Service struct {
	pool     *pgxpool.Pool
	vaPool   *pgxpool.Pool
	notifier GrantNotifier
}

// New constructs a Service. pool is the legacy mmff_vector pool (kept
// for membership/auth lookups); vaPool is the vector_artefacts pool
// where all topology reads/writes land. Both are required for normal
// operation; vaPool may be nil only in narrow test paths that do not
// call any topology method.
func New(pool *pgxpool.Pool, vaPool *pgxpool.Pool) *Service {
	return &Service{pool: pool, vaPool: vaPool}
}

// WithNotifier wires a GrantNotifier into the Service. Optional —
// when unset, GrantRole is silent. Returns the Service so the call
// can chain off the constructor.
func (s *Service) WithNotifier(n GrantNotifier) *Service {
	s.notifier = n
	return s
}

// Node is one row of topology_nodes returned by reads.
//
// ArchivedDescendantCount is a computed rollup populated by Subtree (the
// /tree endpoint): for each live node it counts the archived descendants
// reachable through live ancestors. Always 0 outside of Subtree results
// — single-node reads (loadNode, ancestors) leave it zero because the
// rollup requires walking the live tree.
//
// Field names changed from the legacy org_nodes shape:
//
//	ManualX/ManualY → X/Y (direct rename in topology_nodes.x / .y)
//	Position        → SortOrder (column rename)
//	LevelID         → DROPPED (no equivalent in vector_artefacts)
//
// JSON tags retain the legacy wire shape (manual_x, manual_y, position)
// so existing frontend clients keep working.
type Node struct {
	ID                      uuid.UUID  `json:"id"`
	WorkspaceID             uuid.UUID  `json:"workspace_id"`
	SubscriptionID          uuid.UUID  `json:"subscription_id"`
	ParentID                *uuid.UUID `json:"parent_id"`
	Name                    string     `json:"name"`
	Description             string     `json:"description"`
	LabelOverride           *string    `json:"label_override"`
	Icon                    *string    `json:"icon"`
	Colour                  *string    `json:"colour"`
	AvatarURL               *string    `json:"avatar_url"`
	LayoutMode              LayoutMode `json:"layout_mode"`
	X                       *int       `json:"manual_x"`
	Y                       *int       `json:"manual_y"`
	CollapsedDefault        bool       `json:"collapsed_default"`
	SortOrder               int        `json:"position"`
	ArchivedAt              *time.Time `json:"archived_at"`
	ArchivedDescendantCount int        `json:"archived_descendant_count"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
}

// GetID / GetParentID satisfy topology.Node so Subtree results can flow
// straight through the shared walker (PLA-0044 / story 00543). Parent is
// stringified to "" for roots so the walker's empty-string root key
// matches TS's null sentinel.
func (n Node) GetID() string { return n.ID.String() }
func (n Node) GetParentID() *string {
	if n.ParentID == nil {
		return nil
	}
	s := n.ParentID.String()
	return &s
}

// ArchivedDescendant is one entry in the archive map returned by
// ArchivedDescendants. It is the closure of archived nodes reachable
// from a live root, including transitively-archived branches: an
// archived child's archived children also surface here so the user
// sees the full sub-graph that needs restoration.
type ArchivedDescendant struct {
	ID               uuid.UUID  `json:"id"`
	ParentID         *uuid.UUID `json:"parent_id"`
	Name             string     `json:"name"`
	ArchivedAt       time.Time  `json:"archived_at"`
	ParentIsArchived bool       `json:"parent_is_archived"`
}

// CreateNodeInput collects the writable columns of topology_nodes for
// a new row. ParentID nil means root. WorkspaceID is required: the
// new substrate is workspace-scoped.
type CreateNodeInput struct {
	WorkspaceID      uuid.UUID
	SubscriptionID   uuid.UUID
	ParentID         *uuid.UUID
	Name             string
	Description      *string
	LabelOverride    *string
	Icon             *string
	Colour           *string
	AvatarURL        *string
	LayoutMode       LayoutMode // empty → defaults to auto-horizontal
	ManualX          *int
	ManualY          *int
	CollapsedDefault *bool // nil → DB default TRUE
	Position         int
}

// CreateNode inserts a new topology_nodes row. When ParentID is non-nil
// it must be a live node in the same subscription. Returns the new node.
func (s *Service) CreateNode(ctx context.Context, in CreateNodeInput) (Node, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Node{}, ErrInvalidName
	}

	mode := in.LayoutMode
	if mode == "" {
		mode = LayoutAutoHorizontal
	}
	if !mode.IsValid() {
		return Node{}, ErrInvalidLayoutMode
	}
	if err := validateManualXY(mode, in.ManualX, in.ManualY); err != nil {
		return Node{}, err
	}

	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback(ctx)

	workspaceID := in.WorkspaceID
	if in.ParentID != nil {
		parent, err := s.loadNode(ctx, tx, *in.ParentID, in.SubscriptionID, false)
		if err != nil {
			return Node{}, err
		}
		// A child always inherits its parent's workspace_id. If the
		// caller supplied a (possibly stale) workspace_id, parent wins —
		// this prevents a child from accidentally being filed under a
		// sibling workspace within the same subscription.
		workspaceID = parent.WorkspaceID
	}
	if workspaceID == uuid.Nil {
		return Node{}, ErrWorkspaceRequired
	}

	var collapsedDefault any
	if in.CollapsedDefault != nil {
		collapsedDefault = *in.CollapsedDefault
	} else {
		collapsedDefault = true
	}

	var n Node
	err = tx.QueryRow(ctx, sqlInsertNode,
		workspaceID, in.SubscriptionID, in.ParentID, name, derefStr(in.Description), in.LabelOverride,
		in.Icon, in.Colour, in.AvatarURL,
		string(mode), in.ManualX, in.ManualY,
		collapsedDefault, in.Position,
	).Scan(
		&n.ID, &n.WorkspaceID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
		&n.Icon, &n.Colour, &n.AvatarURL,
		&n.LayoutMode, &n.X, &n.Y,
		&n.CollapsedDefault, &n.SortOrder, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return Node{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Node{}, err
	}
	return n, nil
}

// RenameNode updates topology_nodes.name. Subscription scope is enforced.
func (s *Service) RenameNode(ctx context.Context, subscriptionID, nodeID uuid.UUID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidName
	}
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlRenameNode, name, nodeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MoveNode re-parents a node. newParentID nil moves to root. Refuses
// the move when newParentID is the node itself or one of its
// descendants (cycle prevention) — this is a hard server-side gate;
// the canvas UI is convenience-only.
func (s *Service) MoveNode(ctx context.Context, subscriptionID, nodeID uuid.UUID, newParentID *uuid.UUID) error {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return err
	}

	if newParentID != nil {
		if *newParentID == nodeID {
			return ErrCycleDetected
		}
		if _, err := s.loadNode(ctx, tx, *newParentID, subscriptionID, false); err != nil {
			return err
		}
		// Walk newParentID's ancestors. If any of them is nodeID we'd
		// be inserting nodeID under its own descendant — a cycle.
		var ancestorOfNew bool
		err := tx.QueryRow(ctx, sqlCycleCheckMoveAncestor, *newParentID, nodeID).Scan(&ancestorOfNew)
		if err != nil {
			return err
		}
		if ancestorOfNew {
			return ErrCycleDetected
		}
	}

	if _, err := tx.Exec(ctx, sqlMoveNode, newParentID, nodeID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ArchiveNode sets archived_at = NOW() on a node. The subtree stays
// in place — Topology renders archived subtrees in greyed-out limbo
// per the MVP decision in c_c_topology.md. Idempotent: archiving an
// already-archived node is a no-op.
func (s *Service) ArchiveNode(ctx context.Context, subscriptionID, nodeID uuid.UUID) error {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, true); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlArchiveNode, nodeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// NodePositionUpdate is one entry of the BulkPosition payload — the
// canvas debounces drag commits and posts a batch.
type NodePositionUpdate struct {
	NodeID     uuid.UUID
	Position   int
	LayoutMode LayoutMode // optional; empty leaves layout_mode unchanged
	ManualX    *int       // honoured only when LayoutMode == LayoutManual
	ManualY    *int
}

// BulkPosition applies a batch of (sort_order, layout_mode, x, y)
// updates in one tx. All updates must belong to subscriptionID — any
// mismatch aborts the whole batch.
func (s *Service) BulkPosition(ctx context.Context, subscriptionID uuid.UUID, updates []NodePositionUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, u := range updates {
		current, err := s.loadNode(ctx, tx, u.NodeID, subscriptionID, false)
		if err != nil {
			return err
		}
		mode := u.LayoutMode
		if mode == "" {
			mode = current.LayoutMode
		}
		if !mode.IsValid() {
			return ErrInvalidLayoutMode
		}
		mx, my := u.ManualX, u.ManualY
		if mode != LayoutManual {
			// Manual coords only meaningful in manual mode — null them
			// so we honour the table's pair-or-null CHECK constraint.
			mx, my = nil, nil
		}
		if err := validateManualXY(mode, mx, my); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, sqlBulkPositionUpdate, u.Position, string(mode), mx, my, u.NodeID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// DuplicateSubtree clones the live subtree rooted at sourceID into the
// same subscription, preserving every field except identity timestamps.
// Names are copied verbatim — sibling-uniqueness was dropped pre-cutover,
// so a duplicate of "Dev" is a second "Dev" sitting next to the source.
//
// The whole walk runs in one transaction: either every row of the new
// subtree commits, or none does. Old → new ID mapping is built as the
// walk descends so each child's parent_id is remapped to its cloned
// parent.
//
// Returns the new root node. The new root is appended after its source
// in sibling order: sort_order = source.sort_order + 1 with all later
// siblings of the source shifted up by 1 in the same tx, so the new
// root lands immediately to the right of the original.
func (s *Service) DuplicateSubtree(ctx context.Context, subscriptionID, sourceID uuid.UUID) (Node, error) {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback(ctx)

	src, err := s.loadNode(ctx, tx, sourceID, subscriptionID, false)
	if err != nil {
		return Node{}, err
	}

	// Shift later siblings of the source up by 1 so the clone can land
	// at source.sort_order + 1 without colliding. Root and child branches
	// take slightly different WHERE clauses because parent_id is nullable.
	if src.ParentID == nil {
		if _, err := tx.Exec(ctx, sqlShiftRootSiblingsUp, subscriptionID, src.SortOrder); err != nil {
			return Node{}, err
		}
	} else {
		if _, err := tx.Exec(ctx, sqlShiftChildSiblingsUp, subscriptionID, *src.ParentID, src.SortOrder); err != nil {
			return Node{}, err
		}
	}

	// Walk the live subtree depth-first via recursive CTE, ordered so
	// every parent appears before its children.
	rows, err := tx.Query(ctx, sqlWalkSubtreeForClone, sourceID, subscriptionID)
	if err != nil {
		return Node{}, err
	}

	type srcRow struct {
		ID               uuid.UUID
		WorkspaceID      uuid.UUID
		ParentID         *uuid.UUID
		Name             string
		Description      string
		LabelOverride    *string
		Icon             *string
		Colour           *string
		AvatarURL        *string
		LayoutMode       LayoutMode
		X                *int
		Y                *int
		CollapsedDefault bool
		SortOrder        int
	}
	walked := []srcRow{}
	for rows.Next() {
		var r srcRow
		if err := rows.Scan(
			&r.ID, &r.WorkspaceID, &r.ParentID, &r.Name, &r.Description, &r.LabelOverride,
			&r.Icon, &r.Colour, &r.AvatarURL,
			&r.LayoutMode, &r.X, &r.Y,
			&r.CollapsedDefault, &r.SortOrder,
		); err != nil {
			rows.Close()
			return Node{}, err
		}
		walked = append(walked, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Node{}, err
	}
	if len(walked) == 0 {
		return Node{}, ErrNodeNotFound
	}

	idMap := make(map[uuid.UUID]uuid.UUID, len(walked))
	var newRoot Node

	for i, r := range walked {
		var newParent *uuid.UUID
		var newSortOrder int
		if i == 0 {
			// Root of the duplicate: attach to the source's parent and
			// land at source.sort_order + 1 (slot opened by the shift above).
			newParent = src.ParentID
			newSortOrder = src.SortOrder + 1
		} else {
			mapped, ok := idMap[*r.ParentID]
			if !ok {
				return Node{}, ErrNodeNotFound
			}
			newParent = &mapped
			newSortOrder = r.SortOrder
		}

		var n Node
		err = tx.QueryRow(ctx, sqlInsertNode,
			r.WorkspaceID, subscriptionID, newParent, r.Name, r.Description, r.LabelOverride,
			r.Icon, r.Colour, r.AvatarURL,
			string(r.LayoutMode), r.X, r.Y,
			r.CollapsedDefault, newSortOrder,
		).Scan(
			&n.ID, &n.WorkspaceID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
			&n.Icon, &n.Colour, &n.AvatarURL,
			&n.LayoutMode, &n.X, &n.Y,
			&n.CollapsedDefault, &n.SortOrder, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
		)
		if err != nil {
			return Node{}, err
		}
		idMap[r.ID] = n.ID
		if i == 0 {
			newRoot = n
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Node{}, err
	}
	return newRoot, nil
}

// GrantRole inserts (or re-grants) a users_roles_topology_nodes row. MVP
// constraint: at most one active admin grant per node — checked here
// before the INSERT and also enforced by the partial unique index in
// the artefacts schema (defence in depth). The same (node, user) cannot
// have two active rows; an existing active grant for the same user is a
// no-op (the existing row is returned).
//
// Story 00288 — federated handoff governance gate:
//   - Only gadmin may issue grants in MVP. A padmin (or any other role)
//     attempting to grant returns ErrDelegationDepth.
//   - canRedelegate must be false. The column ships in the schema for
//     Phase X but is read by zero handlers — passing true returns
//     ErrRedelegationDisabled so a future loosening of the rule is an
//     explicit code change, not a quiet config drift.
func (s *Service) GrantRole(
	ctx context.Context,
	subscriptionID, nodeID, userID uuid.UUID,
	role Role,
	grantedBy uuid.UUID,
	granterRole string,
	canRedelegate bool,
) (uuid.UUID, error) {
	if !role.IsValid() {
		return uuid.Nil, ErrInvalidRole
	}
	if canRedelegate {
		return uuid.Nil, ErrRedelegationDisabled
	}
	if granterRole != "" && granterRole != "gadmin" {
		return uuid.Nil, ErrDelegationDepth
	}

	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	node, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false)
	if err != nil {
		return uuid.Nil, err
	}

	// Idempotent: same (node, user) with an active grant returns it.
	var existingID uuid.UUID
	err = tx.QueryRow(ctx, sqlSelectActiveGrantForUserOnNode, nodeID, userID).Scan(&existingID)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return uuid.Nil, err
		}
		return existingID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}

	if role == RoleAdmin {
		var hasAdmin bool
		err := tx.QueryRow(ctx, sqlExistsActiveAdminGrantOnNode, nodeID).Scan(&hasAdmin)
		if err != nil {
			return uuid.Nil, err
		}
		if hasAdmin {
			return uuid.Nil, ErrAdminAlreadyGranted
		}
	}

	var newID uuid.UUID
	var grantedAt time.Time
	err = tx.QueryRow(ctx, sqlInsertGrant,
		node.WorkspaceID, subscriptionID, nodeID, userID, string(role), canRedelegate, grantedBy,
	).Scan(&newID, &grantedAt)
	if err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	if s.notifier != nil {
		s.notifier.NotifyGrant(userID, GrantNotification{
			GrantID:       newID,
			NodeID:        nodeID,
			NodeName:      node.Name,
			LabelOverride: node.LabelOverride,
			Role:          role,
			GrantedBy:     grantedBy,
			GrantedAt:     grantedAt,
		})
	}
	return newID, nil
}

// RevokeRole stamps revoked_at + revoked_by on an active grant.
// Subscription scope is enforced. Already-revoked rows return
// ErrGrantNotFound (callers should treat the action as idempotent at
// the API layer if they want).
func (s *Service) RevokeRole(ctx context.Context, subscriptionID, grantID, revokedBy uuid.UUID) error {
	tag, err := s.vaPool.Exec(ctx, sqlRevokeGrant, revokedBy, grantID, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	return nil
}

// SetViewState upserts the per-user canvas viewport (pan + zoom) for a
// workspace. One row per (workspace_id, user_id); the unique constraint
// drives ON CONFLICT.
//
// Signature change at M6.2.7: the legacy org_node_view_state stored
// per-node collapse state, while topology_view_states stores the canvas
// viewport. Callers now pass workspaceID + viewport coordinates instead
// of nodeID + collapsed.
func (s *Service) SetViewState(
	ctx context.Context,
	subscriptionID, workspaceID, userID uuid.UUID,
	viewportX, viewportY, viewportZoom float64,
) error {
	if workspaceID == uuid.Nil {
		return ErrWorkspaceRequired
	}
	if viewportZoom <= 0 {
		// CHECK (viewport_zoom > 0) on the column; reject early.
		viewportZoom = 1.0
	}
	if _, err := s.vaPool.Exec(ctx, sqlUpsertViewState,
		workspaceID, subscriptionID, userID, viewportX, viewportY, viewportZoom,
	); err != nil {
		return err
	}
	return nil
}

// Subtree returns every live descendant of rootID (including rootID
// itself) inside the given subscription, ordered depth-first by
// sort_order. The recursive CTE is the same shape used by the clamp
// predicate so query plans stay symmetric.
//
// When WorkspaceIDFromCtx is set (story 00378), every reference to
// topology_nodes is additionally filtered by workspace_id — a Topology
// canvas request bound to workspace W cannot accidentally surface a
// row anchored under a sibling workspace in the same tenant. Without
// a workspace clamp (admin tools / migrations) the query falls back
// to subscription-only scoping.
func (s *Service) Subtree(ctx context.Context, subscriptionID, rootID uuid.UUID) ([]Node, error) {
	wsClause, args, slot := workspaceClause(ctx, "n", []any{rootID, subscriptionID})
	wsClauseC := workspaceClauseAt("c", slot)
	wsClauseA := workspaceClauseAt("a", slot)
	rows, err := s.vaPool.Query(ctx,
		fmt.Sprintf(sqlSubtreeTemplate, wsClause, wsClauseC, wsClauseA, wsClauseC),
		args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Node{}
	for rows.Next() {
		var n Node
		if err := rows.Scan(
			&n.ID, &n.WorkspaceID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
			&n.Icon, &n.Colour, &n.AvatarURL,
			&n.LayoutMode, &n.X, &n.Y,
			&n.CollapsedDefault, &n.SortOrder, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
			&n.ArchivedDescendantCount,
		); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// AncestorsOf returns the chain from nodeID up to root, inclusive of
// nodeID itself, ordered root → node. Used by the breadcrumb header
// on the node-detail panel and by audit log "where did this happen"
// queries.
func (s *Service) AncestorsOf(ctx context.Context, subscriptionID, nodeID uuid.UUID) ([]Node, error) {
	rows, err := s.vaPool.Query(ctx, sqlAncestorsOf, nodeID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Node{}
	for rows.Next() {
		var n Node
		if err := rows.Scan(
			&n.ID, &n.WorkspaceID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
			&n.Icon, &n.Colour, &n.AvatarURL,
			&n.LayoutMode, &n.X, &n.Y,
			&n.CollapsedDefault, &n.SortOrder, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ArchivedDescendants returns the closure of archived nodes reachable
// from a live anchor node. Walks down from `nodeID` (which must be live
// and in this tenant), enters every archived child branch, and recurses
// into transitively-archived descendants.
func (s *Service) ArchivedDescendants(
	ctx context.Context,
	subscriptionID, nodeID uuid.UUID,
) ([]ArchivedDescendant, error) {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return nil, err
	}

	wsClauseN, archArgs, slot := workspaceClause(ctx, "n", []any{nodeID, subscriptionID})
	wsClauseC := workspaceClauseAt("c", slot)
	wsClauseA := workspaceClauseAt("a", slot)
	rows, err := tx.Query(ctx,
		fmt.Sprintf(sqlArchivedDescendantsTemplate, wsClauseN, wsClauseC, wsClauseA, wsClauseC),
		archArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ArchivedDescendant{}
	for rows.Next() {
		var d ArchivedDescendant
		if err := rows.Scan(&d.ID, &d.ParentID, &d.Name, &d.ArchivedAt, &d.ParentIsArchived); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DescendantNodeIDs returns rootNodeID plus the IDs of every live
// descendant reachable through topology_nodes.parent_id. Archived nodes
// (and everything beneath them) are skipped, so a scope clamp built
// from this set never reaches dead branches. The root itself must be
// live and in the caller's tenant; ErrNodeNotFound is returned
// otherwise.
//
// Used by readers that need the "this node + every descendant" set for
// the PLA-0043 scope clamp on artefact reads.
func (s *Service) DescendantNodeIDs(
	ctx context.Context,
	subscriptionID, rootNodeID uuid.UUID,
) ([]uuid.UUID, error) {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := s.loadNode(ctx, tx, rootNodeID, subscriptionID, false); err != nil {
		return nil, err
	}

	wsClauseN, args, slot := workspaceClause(ctx, "n", []any{rootNodeID, subscriptionID})
	wsClauseC := workspaceClauseAt("c", slot)
	rows, err := tx.Query(ctx,
		fmt.Sprintf(sqlDescendantNodeIDsTemplate, wsClauseN, wsClauseC),
		args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// RestoreNode lifts a node out of limbo by clearing its archived_at.
// When newParentID is non-nil it ALSO reparents to that node; pass nil
// to leave the existing parent_id untouched.
//
// Errors:
//   - ErrNodeNotFound       — node missing or in another tenant
//   - ErrNotArchived        — node is already live (no-op rejected so the
//                             caller can surface "nothing to do")
//   - ErrParentMissing      — newParentID points at a non-existent node
//   - ErrParentArchived     — newParentID points at an archived node
//                             (and was not passed nil meaning "keep
//                             current parent")
//
// When newParentID is nil and the node's existing parent_id is itself
// archived, ErrParentArchived is returned: the caller MUST supply a
// live new_parent_id to restore in that case.
func (s *Service) RestoreNode(
	ctx context.Context,
	subscriptionID, nodeID uuid.UUID,
	newParentID *uuid.UUID,
) error {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	n, err := s.loadNode(ctx, tx, nodeID, subscriptionID, true)
	if err != nil {
		return err
	}
	if n.ArchivedAt == nil {
		return ErrNotArchived
	}

	var landingParent *uuid.UUID
	if newParentID != nil {
		var pSub uuid.UUID
		var pArchived *time.Time
		err := tx.QueryRow(ctx, sqlSelectParentForRestoreByID, *newParentID).
			Scan(&pSub, &pArchived)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrParentMissing
		}
		if err != nil {
			return err
		}
		if pSub != subscriptionID {
			return ErrParentMissing
		}
		if pArchived != nil {
			return ErrParentArchived
		}
		landingParent = newParentID
	} else if n.ParentID != nil {
		var pArchived *time.Time
		err := tx.QueryRow(ctx, sqlSelectParentForRestoreInTenant, *n.ParentID, subscriptionID).
			Scan(&pArchived)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrParentMissing
		}
		if err != nil {
			return err
		}
		if pArchived != nil {
			return ErrParentArchived
		}
		landingParent = n.ParentID
	}

	if _, err := tx.Exec(ctx, sqlRestoreNode, nodeID, landingParent); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// MyGrant is one row of the user's own grant list — what the scope
// picker shows. It pairs the grant identity + role with the node's
// display fields so the chrome dropdown can render without a second
// round trip.
type MyGrant struct {
	GrantID       uuid.UUID  `json:"grant_id"`
	NodeID        uuid.UUID  `json:"node_id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	ParentID      *uuid.UUID `json:"parent_id"`
	Name          string     `json:"name"`
	LabelOverride *string    `json:"label_override"`
	Colour        *string    `json:"colour"`
	Icon          *string    `json:"icon"`
	Role          Role       `json:"role"`
	GrantedAt     time.Time  `json:"granted_at"`
	// PLA-0044: sibling order from topology_nodes.sort_order. Lets the
	// ScopeRail / picker run the shared walkTopology() walker with
	// byPosition sort and render in canvas order.
	Position int `json:"position"`
}

// ListMyGrants returns every active grant for the given (subscription,
// user) joined to the underlying live topology_node. Archived nodes are
// excluded — a grant on a node that was later archived has no useful
// scope to switch into. Result is ordered by name for a stable dropdown.
//
// Gadmin override: gadmin is the platform-level support role and is
// expected to be able to traverse the whole topology of any subscription
// they're acting on. Rather than seeding real grant rows for them (which
// would pollute the grant audit trail), we synthesise a "virtual admin
// grant" on every live node. The synthetic GrantID is the node ID — it
// is never read back as a real grant identifier (gadmin never revokes
// its own synthetic grants), so this collision is safe; the picker only
// uses it as a React key. GrantedAt is the node's created_at for stable
// sort, and Role is fixed to "admin" so any role-coded UI affordance
// (e.g. role pill in the picker) renders meaningfully.
func (s *Service) ListMyGrants(ctx context.Context, subscriptionID, userID uuid.UUID, actorRole string) ([]MyGrant, error) {
	if actorRole == string(roletypes.RoleGAdmin) {
		return s.listMyGrantsGadmin(ctx, subscriptionID)
	}
	rows, err := s.vaPool.Query(ctx, sqlListMyGrants, subscriptionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []MyGrant{}
	for rows.Next() {
		var g MyGrant
		if err := rows.Scan(
			&g.GrantID, &g.NodeID, &g.WorkspaceID, &g.ParentID,
			&g.Name, &g.LabelOverride, &g.Colour, &g.Icon,
			&g.Role, &g.GrantedAt, &g.Position,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// listMyGrantsGadmin returns a synthetic admin grant for every live
// node in the subscription. See ListMyGrants doc for why this is
// synthesised rather than seeded.
func (s *Service) listMyGrantsGadmin(ctx context.Context, subscriptionID uuid.UUID) ([]MyGrant, error) {
	rows, err := s.vaPool.Query(ctx, sqlListMyGrantsGadmin, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []MyGrant{}
	for rows.Next() {
		var g MyGrant
		if err := rows.Scan(
			&g.NodeID, &g.WorkspaceID, &g.ParentID,
			&g.Name, &g.LabelOverride, &g.Colour, &g.Icon,
			&g.GrantedAt, &g.Position,
		); err != nil {
			return nil, err
		}
		g.GrantID = g.NodeID // synthetic — React-key only; see ListMyGrants doc.
		g.Role = "admin"
		out = append(out, g)
	}
	return out, rows.Err()
}

// ListGrantsByUser returns every active grant for the given target
// user, joined to the underlying live node. Unlike ListMyGrants which
// is self-pivot (the caller views their own grants), this method is
// the admin-pivot read used by the Topology Permissions page (PLA-0046,
// B6.8) — a gadmin actor enumerates any user's grants in the same
// subscription. Non-gadmin actors are refused with ErrForbidden; the
// underlying permission gate (topology.grants.manage_others) is also
// enforced upstream at the handler, but service-side enforcement is
// the authoritative defence-in-depth.
//
// Result is ordered by node sort_order then name for a stable list.
// Archived nodes are excluded — a grant on a node that was later
// archived has no useful scope to display.
func (s *Service) ListGrantsByUser(ctx context.Context, subscriptionID, targetUserID uuid.UUID, actorRole string) ([]MyGrant, error) {
	if actorRole != string(roletypes.RoleGAdmin) {
		return nil, ErrForbidden
	}
	rows, err := s.vaPool.Query(ctx, sqlListGrantsByUser, subscriptionID, targetUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []MyGrant{}
	for rows.Next() {
		var g MyGrant
		if err := rows.Scan(
			&g.GrantID, &g.NodeID, &g.WorkspaceID, &g.ParentID,
			&g.Name, &g.LabelOverride, &g.Colour, &g.Icon,
			&g.Role, &g.GrantedAt, &g.Position,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ClampPredicate returns the set of live node IDs the user can see —
// the union of the subtrees rooted at every node they hold an active
// grant on. Empty result means "no Topology access" and should result
// in an empty list response from any clamped endpoint.
func (s *Service) ClampPredicate(ctx context.Context, subscriptionID, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.vaPool.Query(ctx, sqlClampPredicate, subscriptionID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers — only this file may issue write SQL against the
// three boundary tables.
// ─────────────────────────────────────────────────────────────────────

// loadNode SELECT … FOR UPDATE on a node, returning ErrNodeNotFound
// when missing or in another subscription. allowArchived=false
// additionally rejects archived nodes (write paths); =true accepts
// them (view-state writes, idempotent archive).
func (s *Service) loadNode(ctx context.Context, tx pgx.Tx, nodeID, subscriptionID uuid.UUID, allowArchived bool) (Node, error) {
	var n Node
	err := tx.QueryRow(ctx, sqlLoadNodeForUpdate, nodeID).Scan(
		&n.ID, &n.WorkspaceID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
		&n.Icon, &n.Colour, &n.AvatarURL,
		&n.LayoutMode, &n.X, &n.Y,
		&n.CollapsedDefault, &n.SortOrder, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Node{}, ErrNodeNotFound
	}
	if err != nil {
		return Node{}, err
	}
	if n.SubscriptionID != subscriptionID {
		// Don't leak existence to a different tenant.
		return Node{}, ErrTenantMismatch
	}
	if !allowArchived && n.ArchivedAt != nil {
		return Node{}, ErrNodeNotFound
	}
	return n, nil
}

// PurgeTenantTopologyData deletes all topology rows for subscriptionID
// within an existing transaction. Order: role grants → view states →
// detach parent_id self-refs → nodes. The tx must target vaPool.
// Intended for dev-reset paths only — irreversible.
func (s *Service) PurgeTenantTopologyData(ctx context.Context, subscriptionID uuid.UUID, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, sqlPurgeTenantRoleGrants, subscriptionID); err != nil {
		return fmt.Errorf("purge role grants: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlPurgeTenantViewStates, subscriptionID); err != nil {
		return fmt.Errorf("purge view states: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlDetachTenantNodeParents, subscriptionID); err != nil {
		return fmt.Errorf("detach parent refs: %w", err)
	}
	if _, err := tx.Exec(ctx, sqlPurgeTenantNodes, subscriptionID); err != nil {
		return fmt.Errorf("purge nodes: %w", err)
	}
	return nil
}

// SeedRootNode inserts a single root topology node within an existing
// transaction. The tx must target vaPool.
// Intended for dev-reset paths only.
func (s *Service) SeedRootNode(ctx context.Context, workspaceID, subscriptionID uuid.UUID, name string, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, sqlInsertRootNode, workspaceID, subscriptionID, name)
	return err
}

// validateManualXY enforces the same pair-or-null rule the artefacts
// migration 031 CHECK enforces, in Go, so we return a typed error
// instead of a raw constraint violation.
func validateManualXY(mode LayoutMode, x, y *int) error {
	if mode == LayoutManual {
		if x == nil || y == nil {
			return ErrManualXYRequired
		}
		return nil
	}
	if x != nil || y != nil {
		return ErrManualXYForbidden
	}
	return nil
}
