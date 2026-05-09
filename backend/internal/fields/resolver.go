// Package fields owns the scope resolution layer for the EAV substrate
// (PLA-0026 / Story 00491, B2). Given a (workspace, tenant, field)
// triple it answers admit/deny by walking the artefact_field_library
// scope discriminator and consulting the artefact_workspace_fields
// whitelist for workspace-scoped entries.
//
// The package is read-only against vector_artefacts: it does NOT write
// to artefact_field_library or artefact_workspace_fields. Whitelist
// curation is owned by a separate admin surface (out of scope for B2).
//
// Resolution rules per R047 §5:
//
//  1. scope=global                                    → admit
//  2. scope=tenant   AND subscription_id matches      → admit
//  3. scope=tenant   AND subscription_id mismatches   → deny
//  4. scope=workspace AND whitelist row exists        → admit
//  5. scope=workspace AND no whitelist row            → deny
//
// Plus: field not found (or archived) → deny with ErrFieldNotFound.
// Unknown scope value → deny with ErrUnknownScope (defensive — the
// CHECK constraint on artefact_field_library.scope makes this
// unreachable in production, but the resolver must not panic).
package fields

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Decision is the resolver verdict.
type Decision int

const (
	// Deny — the field is not visible to this (workspace, tenant) pair.
	Deny Decision = iota
	// Admit — the field is in scope and may be read/written.
	Admit
)

func (d Decision) String() string {
	if d == Admit {
		return "admit"
	}
	return "deny"
}

var (
	// ErrFieldNotFound is returned when the field_library row does not
	// exist or has been archived.
	ErrFieldNotFound = errors.New("field not found")
	// ErrUnknownScope is returned when the field row carries a scope
	// value outside {'global','tenant','workspace'}. Defensive — the
	// DB CHECK constraint forbids this.
	ErrUnknownScope = errors.New("unknown field scope")
	// ErrPoolMissing is returned when the artefacts pool was not
	// configured at boot.
	ErrPoolMissing = errors.New("vector_artefacts pool not configured")
)

// Resolver answers field-scope questions.
type Resolver struct {
	pool *pgxpool.Pool
}

// New builds a Resolver backed by the vector_artefacts pool. Pass nil
// to construct a no-op Resolver that returns ErrPoolMissing on every
// call — symmetric with artefactitemsv2 and portfolio's null-pool path.
func New(pool *pgxpool.Pool) *Resolver { return &Resolver{pool: pool} }

// fieldRow is the minimum projection needed to resolve scope.
type fieldRow struct {
	scope          string
	subscriptionID *uuid.UUID
}

// ResolveField answers admit/deny for (workspaceID, subscriptionID,
// fieldLibraryID). subscriptionID is the tenant the caller is acting
// within (typically from auth). All three IDs must be non-nil — passing
// uuid.Nil for any of them yields Deny without a DB round-trip.
func (r *Resolver) ResolveField(
	ctx context.Context,
	workspaceID, subscriptionID, fieldLibraryID uuid.UUID,
) (Decision, error) {
	if r.pool == nil {
		return Deny, ErrPoolMissing
	}
	if workspaceID == uuid.Nil || subscriptionID == uuid.Nil || fieldLibraryID == uuid.Nil {
		return Deny, nil
	}

	row, err := r.loadField(ctx, fieldLibraryID)
	if err != nil {
		return Deny, err
	}

	switch row.scope {
	case "global":
		return Admit, nil
	case "tenant":
		if row.subscriptionID == nil || *row.subscriptionID != subscriptionID {
			return Deny, nil
		}
		return Admit, nil
	case "workspace":
		// Tenant boundary still applies: a workspace-scoped field
		// belongs to one tenant. Cross-tenant whitelisting is not
		// possible because the workspace_id PK in
		// artefact_workspace_fields refers to mmff_vector.workspaces
		// (one tenant per workspace), but we re-check tenant match
		// here for defence in depth.
		if row.subscriptionID == nil || *row.subscriptionID != subscriptionID {
			return Deny, nil
		}
		ok, err := r.workspaceHasField(ctx, workspaceID, fieldLibraryID)
		if err != nil {
			return Deny, err
		}
		if !ok {
			return Deny, nil
		}
		return Admit, nil
	default:
		return Deny, ErrUnknownScope
	}
}

func (r *Resolver) loadField(ctx context.Context, fieldLibraryID uuid.UUID) (*fieldRow, error) {
	var row fieldRow
	err := r.pool.QueryRow(ctx, `
		SELECT scope, subscription_id
		  FROM artefact_field_library
		 WHERE id = $1 AND archived_at IS NULL`,
		fieldLibraryID,
	).Scan(&row.scope, &row.subscriptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFieldNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Resolver) workspaceHasField(ctx context.Context, workspaceID, fieldLibraryID uuid.UUID) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM artefact_workspace_fields
			 WHERE workspace_id = $1 AND field_library_id = $2
		)`,
		workspaceID, fieldLibraryID,
	).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}
