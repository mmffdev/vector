package topology

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/roles"
)

// CanReadScope answers "may this user read artefacts clamped to
// targetNodeID?" — the PLA-0043 gate guarding artefact list reads.
//
// Rule: a grant on a node reaches that node AND every descendant
// (grant-inherits-down). A grant on a child never reaches the parent.
// So the question reduces to "does the user hold an active grant on
// targetNodeID or any of its ancestors?"
//
// gadmin is the platform-level support role and bypasses scope checks
// entirely (mirrors ListMyGrants gadmin override). Any other role must
// have a matching grant.
//
// ErrNodeNotFound is returned if targetNodeID is missing or in another
// tenant — callers should translate this to 404.
//
// A boolean false (no error) means "node exists, but no grant covers
// it" — callers should translate this to 403 and emit a
// scope_read_denied audit row.
func (s *Service) CanReadScope(
	ctx context.Context,
	subscriptionID, userID, targetNodeID uuid.UUID,
	actorRoleID uuid.UUID,
) (bool, error) {
	if actorRoleID == roles.SystemGrpGlobalID {
		// Confirm node exists in tenant so a bogus ?scope= still 404s.
		tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			return false, err
		}
		defer tx.Rollback(ctx)
		if _, err := s.loadNodeReadOnly(ctx, tx, targetNodeID, subscriptionID, false); err != nil {
			return false, err
		}
		return true, nil
	}

	tx, err := s.vaPool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if _, err := s.loadNodeReadOnly(ctx, tx, targetNodeID, subscriptionID, false); err != nil {
		return false, err
	}

	// Walk UP from targetNodeID through parent_id. Return true the
	// moment we hit a node the user holds an active grant on.
	var hit bool
	err = tx.QueryRow(ctx, sqlAncestorsHasGrantOnTargetOrAncestor,
		targetNodeID, subscriptionID, userID).Scan(&hit)
	if err != nil {
		return false, err
	}
	return hit, nil
}
