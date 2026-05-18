package workspaces

// Workspace mutation surface (PLA-0006 / story 00376). Every method
// below: gate on the matching workspace.* permission, run inside a
// transaction (multi-statement commands), audit-log the mutation,
// return a typed sentinel on the documented failure modes.
//
// The five permissions (migration 100):
//   workspace.create         → Create
//   workspace.rename         → Rename
//   workspace.archive        → Archive
//   workspace.restore        → Restore
//   workspace.view_archived  → ListBySubscription(includeArchived=true)
//
// Reads (Get / ListBySubscription with includeArchived=false) are
// not permission-gated at this layer — the route layer's clamp
// predicate decides what the actor sees. This matches orgdesign:
// reads do not log, writes always do.

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// slugRegex mirrors the workspaces.slug CHECK constraint in migration
// 098. Anchoring matches the SQL pattern verbatim.
var slugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// CreateInput collects the writable columns for a new workspace row.
// Description is optional; nil → NULL in the row.
type CreateInput struct {
	SubscriptionID uuid.UUID
	Name           string
	Slug           string
	Description    *string
	ActorID        uuid.UUID
}

// Create inserts a new workspace under subscriptionID. The slug must
// be unique among LIVE workspaces in the same subscription — the
// partial unique index workspaces_subscription_slug_live enforces it
// at the DB level, and we surface a typed ErrSlugTaken instead of a
// raw constraint-violation error.
//
// Permission gate: workspace.create.
func (s *Service) Create(ctx context.Context, in CreateInput) (Workspace, error) {
	if err := s.requirePermission(ctx, in.ActorID, permissions.Code("workspace.create")); err != nil {
		return Workspace{}, err
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Workspace{}, ErrInvalidName
	}
	slug := strings.TrimSpace(in.Slug)
	if !slugRegex.MatchString(slug) {
		return Workspace{}, ErrInvalidSlug
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Workspace{}, err
	}
	defer tx.Rollback(ctx)

	var w Workspace
	err = tx.QueryRow(ctx, sqlInsertWorkspace,
		in.SubscriptionID, name, slug, in.Description, in.ActorID,
	).Scan(
		&w.ID, &w.SubscriptionID, &w.Name, &w.Slug, &w.Description,
		&w.CreatedBy, &w.CreatedAt, &w.UpdatedAt, &w.ArchivedAt, &w.ArchivedBy,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return Workspace{}, ErrSlugTaken
		}
		return Workspace{}, err
	}

	// Seed creator-as-admin so the workspace clamp middleware
	// (orgdesign/middleware.go) lets the creator read their own
	// workspace immediately. Without this row the creator is locked
	// out of /topology by the no_workspace_role 403 path. Same
	// transaction as the workspace insert: a failed grant rolls the
	// workspace back. Migration 101 closes the matching gap for
	// pre-this-change rows.
	if _, err := tx.Exec(ctx, sqlInsertWorkspaceCreatorAdminGrant,
		in.SubscriptionID, w.ID, in.ActorID); err != nil {
		return Workspace{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Workspace{}, err
	}

	// Seed root topology node on vaPool (separate tx — cross-DB, non-atomic).
	// Failure is non-fatal: the workspace row exists; topology seed can be
	// retried via the dev seed script or a future repair job.
	if s.topoSeeder != nil && s.VAPool != nil {
		if vaTx, err := s.VAPool.Begin(ctx); err == nil {
			if seedErr := s.topoSeeder.SeedRootNode(ctx, w.ID, in.SubscriptionID, w.Name, vaTx); seedErr != nil {
				_ = vaTx.Rollback(ctx)
			} else {
				_ = vaTx.Commit(ctx)
			}
		}
	}

	// Seed 5 default work types on vaPool (non-atomic, non-fatal).
	if s.atSeeder != nil {
		_ = s.atSeeder.SeedDefaultWorkspaceTypes(ctx, in.SubscriptionID, w.ID)
	}

	wid := w.ID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &in.ActorID,
		SubscriptionID: &in.SubscriptionID,
		Action:         "workspace.created",
		Resource:       strPtr("workspace"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"name": w.Name,
			"slug": w.Slug,
		},
	})
	return w, nil
}

// CreateDefault inserts the canonical "Default" workspace (slug
// "default") for a freshly-created tenant. It is the API surface
// that a future tenant-signup endpoint MUST call inside the same
// transaction as the subscriptions INSERT, so a tenant is never
// observable without exactly one live workspace (PLA-0006 / 00382
// AC #3).
//
// Differences vs Create:
//
//   - Skips the workspace.create permission gate. Signup runs as a
//     bootstrap path: the actor (the new tenant's first gadmin)
//     does not yet hold any role grants, so the standard gate
//     would reject the call. This mirrors the migration-time
//     bootstrap exception documented in service.go (the migration
//     099 seed is the same hole at the SQL layer).
//   - Uses the caller-supplied transaction (tx pgx.Tx) so the
//     Default workspace lands in the SAME transaction as the
//     subscriptions row. A failed signup MUST roll the workspace
//     back; commit/rollback ownership stays with the caller.
//   - Audit-logs through s.auditLog (nil-safe) for parity with
//     Create — but only after the caller commits, so callers MUST
//     pass an audit logger that can tolerate the row not yet being
//     visible to readers when the entry fires. In practice the
//     signup flow logs after Commit; the audit hook here is a
//     belt-and-braces marker that the bootstrap happened.
//
// Slug is fixed at "default"; the partial unique index
// workspaces_subscription_slug_live (subscription_id, slug) WHERE
// archived_at IS NULL guarantees a tenant cannot wind up with two
// live "default" workspaces no matter how the signup endpoint is
// retried. A duplicate INSERT surfaces as ErrSlugTaken — callers
// should treat that as a programming error (signup ran twice
// inside one txn) and abort the txn.
//
// firstUserID is the row id of the new tenant's first user (the
// signup endpoint creates this in the same transaction). It is
// stamped into both workspaces.created_by and the audit entry's
// actor — there is no "system" user in this codebase, and using
// the bootstrapped gadmin keeps the FK to users(id) honest.
func (s *Service) CreateDefault(
	ctx context.Context,
	tx pgx.Tx,
	subscriptionID, firstUserID uuid.UUID,
) (Workspace, error) {
	const (
		defaultName = "Default"
		defaultSlug = "default"
		defaultDesc = "Default workspace created at tenant signup."
	)

	desc := defaultDesc

	var w Workspace
	err := tx.QueryRow(ctx, sqlInsertWorkspace,
		subscriptionID, defaultName, defaultSlug, desc, firstUserID,
	).Scan(
		&w.ID, &w.SubscriptionID, &w.Name, &w.Slug, &w.Description,
		&w.CreatedBy, &w.CreatedAt, &w.UpdatedAt, &w.ArchivedAt, &w.ArchivedBy,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return Workspace{}, ErrSlugTaken
		}
		return Workspace{}, err
	}

	// Seed firstUser-as-admin on the same tx so the new tenant's
	// gadmin can immediately read /topology after signup. Without
	// this row the tenant is observable but unreadable — clamp 403s
	// every topology call. Caller owns commit, so a roll-back of the
	// signup also rolls back the role grant.
	if _, err := tx.Exec(ctx, sqlInsertWorkspaceCreatorAdminGrant,
		subscriptionID, w.ID, firstUserID); err != nil {
		return Workspace{}, err
	}

	wid := w.ID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &firstUserID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.created",
		Resource:       strPtr("workspace"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"name":      w.Name,
			"slug":      w.Slug,
			"bootstrap": "tenant_signup",
		},
	})
	return w, nil
}

// Rename updates the workspace name. Slug is immutable in MVP; a
// future story can add a Reslug command if the product needs it.
//
// Permission gate: workspace.rename.
func (s *Service) Rename(ctx context.Context, subscriptionID, workspaceID uuid.UUID, newName string, actorID uuid.UUID) error {
	if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.rename")); err != nil {
		return err
	}
	name := strings.TrimSpace(newName)
	if name == "" {
		return ErrInvalidName
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	w, err := s.loadWorkspace(ctx, tx, workspaceID, subscriptionID, true)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, sqlRenameWorkspace, name, workspaceID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Sync the topology root node name in vector_artefacts (non-fatal;
	// the workspace row is already committed). Routed through
	// TopologySeeder so the writer-boundary lint stays green — only the
	// topology package writes topology_nodes SQL.
	if s.topoSeeder != nil {
		_ = s.topoSeeder.RenameWorkspaceRootNode(ctx, workspaceID, name)
	}

	wid := workspaceID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &actorID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.renamed",
		Resource:       strPtr("workspace"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"old_name": w.Name,
			"new_name": name,
		},
	})
	return nil
}

// Archive flips the workspace into limbo. Per AC #102, the row's
// workspace_roles and child org_nodes are left untouched — the
// archive is purely a flag flip on the workspace row.
//
// Refuses to archive the last live workspace in a subscription
// (ErrCannotArchiveLastLive): a tenant must always have ≥1 live
// workspace so org_nodes.workspace_id stays satisfiable.
//
// Permission gate: workspace.archive.
func (s *Service) Archive(ctx context.Context, subscriptionID, workspaceID, actorID uuid.UUID) error {
	if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.archive")); err != nil {
		return err
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	w, err := s.loadWorkspace(ctx, tx, workspaceID, subscriptionID, true)
	if err != nil {
		return err
	}
	if w.IsArchived() {
		return ErrAlreadyArchived
	}

	// Last-live guard. Counts every other live workspace in this
	// subscription; refuses the archive when the count is zero.
	var liveSiblings int
	if err := tx.QueryRow(ctx, sqlCountLiveSiblingsExcluding,
		subscriptionID, workspaceID).Scan(&liveSiblings); err != nil {
		return err
	}
	if liveSiblings == 0 {
		return ErrCannotArchiveLastLive
	}

	if _, err := tx.Exec(ctx, sqlArchiveWorkspace, actorID, workspaceID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Archive topology nodes in vector_artefacts so grants/me stops returning
	// them. Non-fatal: workspace row is already committed. Routed through
	// TopologySeeder for writer-boundary discipline.
	if s.topoSeeder != nil {
		_ = s.topoSeeder.ArchiveWorkspaceTopology(ctx, workspaceID)
	}

	wid := workspaceID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &actorID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.archived",
		Resource:       strPtr("workspace"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"name": w.Name,
			"slug": w.Slug,
		},
	})
	return nil
}

// Restore lifts a workspace out of limbo. The slug must still be
// available among live siblings (the partial unique index does not
// cover archived rows, so slug collisions can occur on restore);
// when a collision exists, ErrSlugTaken surfaces and the caller is
// expected to either rename or restore-with-rename in a follow-up.
//
// Permission gate: workspace.restore.
func (s *Service) Restore(ctx context.Context, subscriptionID, workspaceID, actorID uuid.UUID) error {
	if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.restore")); err != nil {
		return err
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	w, err := s.loadWorkspace(ctx, tx, workspaceID, subscriptionID, true)
	if err != nil {
		return err
	}
	if !w.IsArchived() {
		return ErrNotArchived
	}

	// Slug-collision guard before the UPDATE. The partial unique
	// index would also fire here, but a typed sentinel is friendlier.
	var collide bool
	if err := tx.QueryRow(ctx, sqlExistsLiveSlugCollision,
		subscriptionID, w.Slug).Scan(&collide); err != nil {
		return err
	}
	if collide {
		return ErrSlugTaken
	}

	if _, err := tx.Exec(ctx, sqlRestoreWorkspace, workspaceID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	// Restore topology nodes in vector_artefacts so the workspace re-appears
	// in grants/me. Non-fatal: workspace row is already committed. Routed
	// through TopologySeeder for writer-boundary discipline.
	if s.topoSeeder != nil {
		_ = s.topoSeeder.RestoreWorkspaceTopology(ctx, workspaceID)
	}

	wid := workspaceID.String()
	s.auditLog(ctx, audit.Entry{
		UserID:         &actorID,
		SubscriptionID: &subscriptionID,
		Action:         "workspace.restored",
		Resource:       strPtr("workspace"),
		ResourceID:     &wid,
		Metadata: map[string]any{
			"name": w.Name,
			"slug": w.Slug,
		},
	})
	return nil
}

// Get returns a single workspace by id, scoped to subscriptionID.
// Cross-tenant access returns ErrNotFound (no existence leak).
//
// Reads are not permission-gated here — the calling route is
// expected to apply its own clamp before invoking Get. Mirrors
// roles.Service.Get.
func (s *Service) Get(ctx context.Context, subscriptionID, workspaceID uuid.UUID) (Workspace, error) {
	var w Workspace
	err := s.Pool.QueryRow(ctx, sqlSelectWorkspaceByIDInTenant,
		workspaceID, subscriptionID).Scan(
		&w.ID, &w.SubscriptionID, &w.Name, &w.Slug, &w.Description,
		&w.CreatedBy, &w.CreatedAt, &w.UpdatedAt, &w.ArchivedAt, &w.ArchivedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, err
	}
	return w, nil
}

// ListBySubscription returns every workspace in subscriptionID.
// When includeArchived=false the result is the live set only;
// when true it includes archived rows AND requires the caller to
// hold workspace.view_archived (otherwise ErrPermissionDenied).
//
// Ordered by created_at ASC so the Default workspace (seeded by
// migration 099) lands first in every tenant's list.
func (s *Service) ListBySubscription(ctx context.Context, subscriptionID uuid.UUID, includeArchived bool, actorID uuid.UUID) ([]Workspace, error) {
	if includeArchived {
		if err := s.requirePermission(ctx, actorID, permissions.Code("workspace.view_archived")); err != nil {
			return nil, err
		}
	}

	archivedClause := ""
	if !includeArchived {
		archivedClause = ` AND archived_at IS NULL`
	}
	q := fmt.Sprintf(sqlListWorkspacesTemplate, archivedClause)

	rows, err := s.Pool.Query(ctx, q, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Workspace{}
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(
			&w.ID, &w.SubscriptionID, &w.Name, &w.Slug, &w.Description,
			&w.CreatedBy, &w.CreatedAt, &w.UpdatedAt, &w.ArchivedAt, &w.ArchivedBy,
		); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers — only this file (and roles.go) may issue write SQL
// against the two boundary tables.
// ─────────────────────────────────────────────────────────────────────

// loadWorkspace SELECTs … FOR UPDATE on a workspace row, returning
// ErrNotFound when missing or in another subscription.
// allowArchived=false additionally rejects archived rows; =true
// accepts them (idempotent archive, restore).
func (s *Service) loadWorkspace(ctx context.Context, tx pgx.Tx, workspaceID, subscriptionID uuid.UUID, allowArchived bool) (Workspace, error) {
	var w Workspace
	err := tx.QueryRow(ctx, sqlLoadWorkspaceForUpdate, workspaceID).Scan(
		&w.ID, &w.SubscriptionID, &w.Name, &w.Slug, &w.Description,
		&w.CreatedBy, &w.CreatedAt, &w.UpdatedAt, &w.ArchivedAt, &w.ArchivedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrNotFound
	}
	if err != nil {
		return Workspace{}, err
	}
	if w.SubscriptionID != subscriptionID {
		// Don't leak existence to a different tenant.
		return Workspace{}, ErrNotFound
	}
	if !allowArchived && w.IsArchived() {
		return Workspace{}, ErrNotFound
	}
	return w, nil
}

// isUniqueViolation reports whether err carries pgx's SQLSTATE 23505
// (unique_violation). Same shape as the helper in roles/service.go;
// duplicating here keeps the package free of an internal "shared
// helpers" import for one tiny function.
func isUniqueViolation(err error) bool {
	type sqlStater interface{ SQLState() string }
	var s sqlStater
	if errors.As(err, &s) {
		return s.SQLState() == "23505"
	}
	return false
}

// strPtr returns a pointer to s. Same one-liner roles.Service uses.
func strPtr(s string) *string { return &s }
