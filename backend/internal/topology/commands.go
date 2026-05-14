package topology

// Commands added for the Topology canvas-management UX track
// (PLA-0006 stories 00310, 00312, 00320, 00322).
//
// Lives alongside service.go inside the sole-writer boundary —
// every INSERT/UPDATE here counts toward the package's monopoly
// on writes to topology_nodes / topology_role_grants /
// topology_view_state / topology_commits (all vector_artefacts).
//
// PLA-0023 P6 (2026-05-13): the commit-checkpoint moved from
// subscriptions.topology_committed_at/_by (mmff_vector, dropped
// in mig 180) into vector_artefacts.topology_commits. Every
// topology read/write now goes through s.vaPool; s.pool is
// retained on the Service only for membership/auth lookups.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PatchNodeInput collects the editable display fields. Only
// non-nil fields are applied. Used by write-through field edits
// from the flyout (story 00312).
type PatchNodeInput struct {
	Name          *string
	Description   *string
	LabelOverride *string
	Icon          *string
	Colour        *string
	AvatarURL     *string
}

// PatchNode applies a partial update to the editable display
// fields of a node. At least one field must be set; an empty
// patch returns ErrInvalidName (treated as "nothing to do" by
// the caller). Description, label_override, icon, colour,
// avatar_url accept empty strings → stored as NULL so users can
// clear a field.
func (s *Service) PatchNode(ctx context.Context, subscriptionID, nodeID uuid.UUID, in PatchNodeInput) error {
	if in.Name == nil && in.Description == nil && in.LabelOverride == nil &&
		in.Icon == nil && in.Colour == nil && in.AvatarURL == nil {
		return ErrInvalidName
	}
	if in.Name != nil {
		if strings.TrimSpace(*in.Name) == "" {
			return ErrInvalidName
		}
	}

	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false); err != nil {
		return err
	}

	// Build a sparse UPDATE — only touch supplied columns.
	parts := []string{}
	args := []any{}
	idx := 1
	add := func(col string, v any) {
		parts = append(parts, col+" = $"+itoa(idx))
		args = append(args, v)
		idx++
	}
	if in.Name != nil {
		add("name", strings.TrimSpace(*in.Name))
	}
	if in.Description != nil {
		// PLA-0006/00312: column is NOT NULL DEFAULT ''. Pass the raw
		// string through (including '') so clearing the field stores
		// the empty default rather than violating NOT NULL.
		add("description", *in.Description)
	}
	if in.LabelOverride != nil {
		add("label_override", nullIfEmpty(*in.LabelOverride))
	}
	if in.Icon != nil {
		add("icon", nullIfEmpty(*in.Icon))
	}
	if in.Colour != nil {
		add("colour", nullIfEmpty(*in.Colour))
	}
	if in.AvatarURL != nil {
		add("avatar_url", nullIfEmpty(*in.AvatarURL))
	}
	args = append(args, nodeID)
	sql := fmt.Sprintf(sqlPatchNodeTemplate, strings.Join(parts, ", "), "$"+itoa(idx))

	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DisconnectNode detaches a node from its parent without
// archiving it (story 00320). The node and its entire subtree
// stay live and reachable; the node's parent_id is set to NULL,
// promoting it to a root in the disconnected tray (story 00321).
//
// Reversible via the standard MoveNode call once a new parent is
// chosen. Idempotent when called on an already-detached root
// (it's a no-op).
//
// Note: legacy org_levels-based depth refresh was removed at
// M6.2.7 — vector_artefacts has no level_id column, depth is
// derived on the fly by the renderer from parent_id chains.
func (s *Service) DisconnectNode(ctx context.Context, subscriptionID, nodeID uuid.UUID) error {
	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	n, err := s.loadNode(ctx, tx, nodeID, subscriptionID, false)
	if err != nil {
		return err
	}
	if n.ParentID == nil {
		// Already a root — nothing to do.
		return tx.Commit(ctx)
	}

	if _, err := tx.Exec(ctx, sqlSetNodeParentNull, nodeID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListDisconnected returns every live node whose parent_id is NULL,
// excluding the canonical root (the lowest-sort_order root). The
// disconnected tray (story 00321) renders this list so a user can
// re-attach orphaned subtrees.
//
// "Canonical root" is defined as the lowest-sort_order parent_id-NULL
// node. Tenants will normally have exactly one root; multi-root
// data is treated as: first root = canonical, the rest = disconnected.
//
// Workspace clamp (story 00378): when WorkspaceIDFromCtx is set,
// "canonical root" is reinterpreted as "the canonical root within
// this workspace" and disconnected returns the workspace's other
// orphan roots — never roots from a sibling workspace in the same
// tenant. Without a clamp the query falls back to subscription-only
// scoping.
func (s *Service) ListDisconnected(ctx context.Context, subscriptionID uuid.UUID) ([]Node, error) {
	// The disconnected tray's two topology_nodes references both need the
	// same workspace_id, so we bind it once and re-splice via the
	// `slot` returned from workspaceClause.
	wsClauseRoots, args, slot := workspaceClause(ctx, "topology_nodes", []any{subscriptionID})
	wsClauseN := workspaceClauseAt("n", slot)
	rows, err := s.vaPool.Query(ctx,
		fmt.Sprintf(sqlListDisconnectedRootsTemplate, wsClauseRoots, wsClauseN),
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
		); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// CommitStatus captures the current commit state for the canvas
// header banner. DirtySinceCommit is true when the working model
// has been edited since the last commit (or has never been
// committed).
type CommitStatus struct {
	CommittedAt      *time.Time `json:"committed_at"`
	CommittedBy      *uuid.UUID `json:"committed_by"`
	LastNodeUpdate   *time.Time `json:"last_node_update"`
	DirtySinceCommit bool       `json:"dirty_since_commit"`
}

// GetCommitStatus reads the current commit checkpoint and
// computes whether the working model is dirty (any node updated
// after the commit timestamp, or never committed).
//
// PLA-0023 P6: checkpoint moved from mmff_vector.subscriptions
// (topology_committed_at/_by columns, dropped in mig 180) to
// vector_artefacts.topology_commits. Both the checkpoint read and
// the MAX(updated_at) freshness probe now go through vaPool, so
// orgdesign no longer reads from mmff_vector for topology I/O.
func (s *Service) GetCommitStatus(ctx context.Context, subscriptionID uuid.UUID) (CommitStatus, error) {
	var st CommitStatus
	err := s.vaPool.QueryRow(ctx, sqlSelectCommitStatus, subscriptionID).
		Scan(&st.CommittedAt, &st.CommittedBy)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return CommitStatus{}, err
	}
	// pgx.ErrNoRows is the "never committed" path — leave both fields nil.

	var lastUpdate *time.Time
	if err := s.vaPool.QueryRow(ctx, sqlSelectMaxNodeUpdatedAt, subscriptionID).
		Scan(&lastUpdate); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return CommitStatus{}, err
	}
	st.LastNodeUpdate = lastUpdate

	if st.CommittedAt == nil {
		st.DirtySinceCommit = lastUpdate != nil
	} else if lastUpdate != nil && lastUpdate.After(*st.CommittedAt) {
		st.DirtySinceCommit = true
	}
	return st, nil
}

// Commit stamps the topology working-model commit checkpoint into
// topology_commits (vector_artefacts). Only gadmin may call —
// actorRole is the caller's user.role string. Returns the new
// CommitStatus so the frontend can swap the banner immediately.
//
// PLA-0023 P6: checkpoint moved from mmff_vector.subscriptions to
// vector_artefacts.topology_commits. Single-row-per-subscription
// upsert; subsequent Commits overwrite committed_at + committed_by
// and bump updated_at.
func (s *Service) Commit(ctx context.Context, subscriptionID, actorID uuid.UUID, actorRole string) (CommitStatus, error) {
	if actorRole != "gadmin" {
		return CommitStatus{}, ErrCommitForbidden
	}
	if _, err := s.vaPool.Exec(ctx, sqlUpsertCommit, subscriptionID, actorID); err != nil {
		return CommitStatus{}, err
	}
	return s.GetCommitStatus(ctx, subscriptionID)
}

// ResetCanvas archives every live topology_nodes row in a
// subscription so the gadmin can start over (story 00310). Role
// grants stay intact (so a re-build with the same delegated
// padmins doesn't require re-granting); view-state rows are left
// alone too — they're per-user and reset themselves on re-collapse.
// Audit-logged at the handler layer.
//
// Only gadmin may call. Idempotent: re-running on an already
// empty canvas is a no-op.
func (s *Service) ResetCanvas(ctx context.Context, subscriptionID, actorID uuid.UUID, actorRole string) (int, error) {
	if actorRole != "gadmin" {
		return 0, ErrResetForbidden
	}
	tag, err := s.vaPool.Exec(ctx, sqlArchiveAllLiveNodes, subscriptionID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// nullIfEmpty returns nil for the empty/whitespace string so
// callers can clear a column by passing "".
func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// derefStr returns *p, or "" when p is nil. PLA-0006/00312 uses this
// to coerce optional Description input into the empty-string default
// expected by the NOT NULL column.
func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
