// Package orgdesign is the SOLE writer for org_nodes, org_node_roles,
// and org_node_view_state. Every INSERT/UPDATE/DELETE against any of
// these tables must pass through this package.
//
// The Topology canvas (PLA-0006) treats the org_nodes tree as the
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
// .go files); migration 085 inserts the bootstrap root nodes and
// is the documented exception.
package orgdesign

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LayoutMode is the closed vocabulary for org_nodes.layout_mode.
// Mirrored by the CHECK constraint in migration 082.
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

// Role is the closed vocabulary for org_node_roles.role.
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
var (
	ErrNodeNotFound        = errors.New("orgdesign: node not found")
	ErrTenantMismatch      = errors.New("orgdesign: node not found")
	ErrCycleDetected       = errors.New("orgdesign: move would create a cycle")
	ErrInvalidLayoutMode   = errors.New("orgdesign: invalid layout_mode")
	ErrInvalidRole         = errors.New("orgdesign: invalid role")
	ErrInvalidName         = errors.New("orgdesign: name must be non-empty")
	ErrManualXYRequired    = errors.New("orgdesign: manual layout requires manual_x and manual_y")
	ErrManualXYForbidden   = errors.New("orgdesign: manual_x/manual_y only allowed when layout_mode='manual'")
	ErrAdminAlreadyGranted = errors.New("orgdesign: an active admin grant already exists for this node")
	ErrGrantNotFound       = errors.New("orgdesign: role grant not found")
)

// Service is the sole writer for the three Topology tables.
type Service struct {
	pool *pgxpool.Pool
}

// New constructs a Service.
func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Node is one row of org_nodes returned by reads.
type Node struct {
	ID               uuid.UUID  `json:"id"`
	SubscriptionID   uuid.UUID  `json:"subscription_id"`
	ParentID         *uuid.UUID `json:"parent_id"`
	Name             string     `json:"name"`
	Description      *string    `json:"description"`
	LabelOverride    *string    `json:"label_override"`
	Icon             *string    `json:"icon"`
	Colour           *string    `json:"colour"`
	AvatarURL        *string    `json:"avatar_url"`
	LayoutMode       LayoutMode `json:"layout_mode"`
	ManualX          *int       `json:"manual_x"`
	ManualY          *int       `json:"manual_y"`
	CollapsedDefault bool       `json:"collapsed_default"`
	Position         int        `json:"position"`
	ArchivedAt       *time.Time `json:"archived_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// CreateNodeInput collects the writable columns of org_nodes for a
// new row. ParentID nil means root.
type CreateNodeInput struct {
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

// CreateNode inserts a new org_node. When ParentID is non-nil it must
// be a live node in the same subscription. Returns the new node.
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

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Node{}, err
	}
	defer tx.Rollback(ctx)

	if in.ParentID != nil {
		if _, err := s.loadNode(ctx, tx, *in.ParentID, in.SubscriptionID, false); err != nil {
			return Node{}, err
		}
	}

	var collapsedDefault any
	if in.CollapsedDefault != nil {
		collapsedDefault = *in.CollapsedDefault
	} else {
		collapsedDefault = true
	}

	var n Node
	err = tx.QueryRow(ctx, `
		INSERT INTO org_nodes (
		    subscription_id, parent_id, name, description, label_override,
		    icon, colour, avatar_url,
		    layout_mode, manual_x, manual_y,
		    collapsed_default, position
		) VALUES (
		    $1, $2, $3, $4, $5,
		    $6, $7, $8,
		    $9, $10, $11,
		    $12, $13
		)
		RETURNING
		    id, subscription_id, parent_id, name, description, label_override,
		    icon, colour, avatar_url,
		    layout_mode, manual_x, manual_y,
		    collapsed_default, position, archived_at, created_at, updated_at
	`,
		in.SubscriptionID, in.ParentID, name, in.Description, in.LabelOverride,
		in.Icon, in.Colour, in.AvatarURL,
		string(mode), in.ManualX, in.ManualY,
		collapsedDefault, in.Position,
	).Scan(
		&n.ID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
		&n.Icon, &n.Colour, &n.AvatarURL,
		&n.LayoutMode, &n.ManualX, &n.ManualY,
		&n.CollapsedDefault, &n.Position, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return Node{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Node{}, err
	}
	return n, nil
}

// RenameNode updates org_nodes.name. Subscription scope is enforced.
func (s *Service) RenameNode(ctx context.Context, subscriptionID, nodeID uuid.UUID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidName
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE org_nodes SET name = $1 WHERE id = $2`, name, nodeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MoveNode re-parents a node. newParentID nil moves to root. Refuses
// the move when newParentID is the node itself or one of its
// descendants (cycle prevention) — this is a hard server-side gate;
// the canvas UI is convenience-only.
func (s *Service) MoveNode(ctx context.Context, subscriptionID, nodeID uuid.UUID, newParentID *uuid.UUID) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
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
		err := tx.QueryRow(ctx, `
			WITH RECURSIVE up AS (
			    SELECT id, parent_id FROM org_nodes WHERE id = $1
			    UNION ALL
			    SELECT n.id, n.parent_id
			      FROM org_nodes n
			      JOIN up ON up.parent_id = n.id
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE id = $2)
		`, *newParentID, nodeID).Scan(&ancestorOfNew)
		if err != nil {
			return err
		}
		if ancestorOfNew {
			return ErrCycleDetected
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE org_nodes SET parent_id = $1 WHERE id = $2`, newParentID, nodeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ArchiveNode sets archived_at = NOW() on a node. The subtree stays
// in place — Topology renders archived subtrees in greyed-out limbo
// per the MVP decision in c_c_topology.md. Idempotent: archiving an
// already-archived node is a no-op.
func (s *Service) ArchiveNode(ctx context.Context, subscriptionID, nodeID uuid.UUID) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, true); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE org_nodes SET archived_at = NOW()
		 WHERE id = $1 AND archived_at IS NULL
	`, nodeID); err != nil {
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

// BulkPosition applies a batch of (position, layout_mode, manual_x,
// manual_y) updates in one tx. All updates must belong to
// subscriptionID — any mismatch aborts the whole batch.
func (s *Service) BulkPosition(ctx context.Context, subscriptionID uuid.UUID, updates []NodePositionUpdate) error {
	if len(updates) == 0 {
		return nil
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
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
		if _, err := tx.Exec(ctx, `
			UPDATE org_nodes
			   SET position = $1, layout_mode = $2, manual_x = $3, manual_y = $4
			 WHERE id = $5
		`, u.Position, string(mode), mx, my, u.NodeID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GrantRole inserts (or re-grants) an org_node_roles row. MVP
// constraint: at most one active admin grant per node — checked here
// before the INSERT and also enforced by the partial unique index in
// migration 083 (defence in depth). The same (node, user) cannot have
// two active rows; an existing active grant for the same user is a
// no-op (the existing row is returned).
func (s *Service) GrantRole(ctx context.Context, subscriptionID, nodeID, userID uuid.UUID, role Role, grantedBy uuid.UUID, canRedelegate bool) (uuid.UUID, error) {
	if !role.IsValid() {
		return uuid.Nil, ErrInvalidRole
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return uuid.Nil, err
	}

	// Idempotent: same (node, user) with an active grant returns it.
	var existingID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM org_node_roles
		 WHERE node_id = $1 AND user_id = $2 AND revoked_at IS NULL
		 LIMIT 1
	`, nodeID, userID).Scan(&existingID)
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
		err := tx.QueryRow(ctx, `
			SELECT EXISTS(
			    SELECT 1 FROM org_node_roles
			     WHERE node_id = $1 AND role = 'admin' AND revoked_at IS NULL
			)
		`, nodeID).Scan(&hasAdmin)
		if err != nil {
			return uuid.Nil, err
		}
		if hasAdmin {
			return uuid.Nil, ErrAdminAlreadyGranted
		}
	}

	var newID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO org_node_roles
		    (subscription_id, node_id, user_id, role, can_redelegate, granted_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, subscriptionID, nodeID, userID, string(role), canRedelegate, grantedBy).Scan(&newID)
	if err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return newID, nil
}

// RevokeRole stamps revoked_at + revoked_by on an active grant.
// Subscription scope is enforced. Already-revoked rows return
// ErrGrantNotFound (callers should treat the action as idempotent at
// the API layer if they want).
func (s *Service) RevokeRole(ctx context.Context, subscriptionID, grantID, revokedBy uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE org_node_roles
		   SET revoked_at = NOW(), revoked_by = $1
		 WHERE id = $2 AND subscription_id = $3 AND revoked_at IS NULL
	`, revokedBy, grantID, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	return nil
}

// SetViewState upserts the per-user collapse/expand record for a
// node. Subscription scope is enforced via the node load.
func (s *Service) SetViewState(ctx context.Context, subscriptionID, nodeID, userID uuid.UUID, collapsed bool) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, true); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO org_node_view_state
		    (subscription_id, node_id, user_id, collapsed, last_viewed_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (node_id, user_id)
		DO UPDATE SET collapsed = EXCLUDED.collapsed,
		              last_viewed_at = NOW()
	`, subscriptionID, nodeID, userID, collapsed); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Subtree returns every live descendant of rootID (including rootID
// itself) inside the given subscription, ordered depth-first by
// position. The recursive CTE is the same shape used by the clamp
// predicate so query plans stay symmetric.
func (s *Service) Subtree(ctx context.Context, subscriptionID, rootID uuid.UUID) ([]Node, error) {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE down AS (
		    SELECT n.*, ARRAY[n.position, 0]::INT[] AS path
		      FROM org_nodes n
		     WHERE n.id = $1 AND n.subscription_id = $2 AND n.archived_at IS NULL
		    UNION ALL
		    SELECT c.*, down.path || c.position
		      FROM org_nodes c
		      JOIN down ON c.parent_id = down.id
		     WHERE c.subscription_id = $2 AND c.archived_at IS NULL
		)
		SELECT id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, manual_x, manual_y,
		       collapsed_default, position, archived_at, created_at, updated_at
		  FROM down
		 ORDER BY path
	`, rootID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Node{}
	for rows.Next() {
		var n Node
		if err := rows.Scan(
			&n.ID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
			&n.Icon, &n.Colour, &n.AvatarURL,
			&n.LayoutMode, &n.ManualX, &n.ManualY,
			&n.CollapsedDefault, &n.Position, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
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
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE up AS (
		    SELECT n.*, 0 AS depth
		      FROM org_nodes n
		     WHERE n.id = $1 AND n.subscription_id = $2
		    UNION ALL
		    SELECT p.*, up.depth + 1
		      FROM org_nodes p
		      JOIN up ON up.parent_id = p.id
		     WHERE p.subscription_id = $2
		)
		SELECT id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, manual_x, manual_y,
		       collapsed_default, position, archived_at, created_at, updated_at
		  FROM up
		 ORDER BY depth DESC
	`, nodeID, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Node{}
	for rows.Next() {
		var n Node
		if err := rows.Scan(
			&n.ID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
			&n.Icon, &n.Colour, &n.AvatarURL,
			&n.LayoutMode, &n.ManualX, &n.ManualY,
			&n.CollapsedDefault, &n.Position, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ClampPredicate returns the set of live node IDs the user can see —
// the union of the subtrees rooted at every node they hold an active
// grant on. Empty result means "no Topology access" and should result
// in an empty list response from any clamped endpoint.
//
// Wired in as cross-cutting middleware on every list endpoint that
// touches portfolio_items or user_stories. Feature teams MUST NOT
// re-implement this — the docs/c_c_topology.md "Clamp predicate"
// section is the single contract.
func (s *Service) ClampPredicate(ctx context.Context, subscriptionID, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		WITH RECURSIVE grants AS (
		    SELECT n.id
		      FROM org_node_roles r
		      JOIN org_nodes n ON n.id = r.node_id
		     WHERE r.subscription_id = $1
		       AND r.user_id = $2
		       AND r.revoked_at IS NULL
		       AND n.archived_at IS NULL
		), reachable AS (
		    SELECT id FROM grants
		    UNION
		    SELECT c.id
		      FROM org_nodes c
		      JOIN reachable ON c.parent_id = reachable.id
		     WHERE c.subscription_id = $1 AND c.archived_at IS NULL
		)
		SELECT id FROM reachable
	`, subscriptionID, userID)
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
	err := tx.QueryRow(ctx, `
		SELECT id, subscription_id, parent_id, name, description, label_override,
		       icon, colour, avatar_url,
		       layout_mode, manual_x, manual_y,
		       collapsed_default, position, archived_at, created_at, updated_at
		  FROM org_nodes
		 WHERE id = $1
		 FOR UPDATE
	`, nodeID).Scan(
		&n.ID, &n.SubscriptionID, &n.ParentID, &n.Name, &n.Description, &n.LabelOverride,
		&n.Icon, &n.Colour, &n.AvatarURL,
		&n.LayoutMode, &n.ManualX, &n.ManualY,
		&n.CollapsedDefault, &n.Position, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
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

// validateManualXY enforces the same pair-or-null rule the migration
// 082 CHECK enforces, in Go, so we return a typed error instead of a
// raw constraint violation.
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
