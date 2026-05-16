package workspacemasterrecord

// PLA-0051 / Story 3.5 — production wiring for the inheritance
// merge. The core service (Service.mergeInheritance) is dep-free:
// it consumes the SubscriptionResolver + TenantDefaultsReader
// interfaces. This file ships the two production implementations
// that read from the live DB so main.go can call them.
//
// FDWSubscriptionResolver reads fdw_workspaces (FDW shadow over
// mmff_vector.master_record_workspaces, populated by mig 067)
// living in vector_artefacts. So it shares the same pool the
// service already uses — no second DB connection.
//
// PGTenantDefaultsReader reads master_record_tenants directly
// (vector_artefacts), bypassing tenantmasterrecord.Service.Get
// because that service's Settings struct uses value types for
// inheritable columns and would scan NULL as the zero value
// (empty string / false / nil-but-typed) — losing the signal
// the merge needs. Same pool. Tests use the equivalent
// dbTenantReader shape in service_inheritance_test.go.

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── SubscriptionResolver: workspace → subscription via FDW ─────────────

// FDWSubscriptionResolver implements SubscriptionResolver by reading
// the fdw_workspaces FDW shadow in vector_artefacts.
type FDWSubscriptionResolver struct{ Pool *pgxpool.Pool }

func NewFDWSubscriptionResolver(pool *pgxpool.Pool) *FDWSubscriptionResolver {
	return &FDWSubscriptionResolver{Pool: pool}
}

// SubscriptionFor returns the subscription_id that owns the given
// workspace. Single-purpose lookup against fdw_workspaces (FDW shadow
// over mmff_vector.master_record_workspaces).
//
// The defensive subscription_id→subscription_id fallback that used to
// live here (capping TD-WS-001) was removed on 2026-05-16 once the
// handler started resolving an explicit workspace_id via
// ActiveWorkspaceResolver. Re-introducing the fallback would mask any
// future "wrong ID handed to merge" regression.
//
// Returns ErrNotFound when the workspace row doesn't exist — Service.
// mergeInheritance treats that as "no tenant tier" and falls through
// to schema defaults.
func (r *FDWSubscriptionResolver) SubscriptionFor(ctx context.Context, workspaceID uuid.UUID) (uuid.UUID, error) {
	var subID uuid.UUID
	err := r.Pool.QueryRow(ctx,
		`SELECT subscription_id FROM fdw_workspaces WHERE id = $1`,
		workspaceID,
	).Scan(&subID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("resolve subscription via workspace: %w", err)
	}
	return subID, nil
}

// ─── ActiveWorkspaceResolver: subscription → active workspace ──────────

// FDWActiveWorkspaceResolver implements ActiveWorkspaceResolver by
// finding the workspace owned by a given subscription via fdw_workspaces.
//
// Today: one workspace per subscription, so this is a single-row lookup.
// When multi-workspace tenants land, this becomes "the workspace the
// caller is permitted to act on by their topology assignment + user
// prefs" — but the surface stays the same (subscription → workspace),
// so handlers don't change and the URL never grows a workspace param.
//
// See: .claude/memory/project_workspace_scope_invisible.md
type FDWActiveWorkspaceResolver struct{ Pool *pgxpool.Pool }

func NewFDWActiveWorkspaceResolver(pool *pgxpool.Pool) *FDWActiveWorkspaceResolver {
	return &FDWActiveWorkspaceResolver{Pool: pool}
}

// ActiveWorkspaceFor returns the workspace_id owned by subscriptionID.
// Single-workspace assumption holds today (mig 067 era); LIMIT 1 with
// a stable ORDER BY id keeps the choice deterministic if a stray
// second row ever appears so production behaviour doesn't flap.
func (r *FDWActiveWorkspaceResolver) ActiveWorkspaceFor(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	var wsID uuid.UUID
	err := r.Pool.QueryRow(ctx,
		`SELECT id FROM fdw_workspaces WHERE subscription_id = $1 ORDER BY id LIMIT 1`,
		subscriptionID,
	).Scan(&wsID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNoActiveWorkspace
		}
		return uuid.Nil, fmt.Errorf("resolve active workspace: %w", err)
	}
	return wsID, nil
}

// ─── TenantDefaultsReader: NULL-aware read of master_record_tenants ────

// PGTenantDefaultsReader implements TenantDefaultsReader by reading
// master_record_tenants directly with pointer-typed inheritable
// columns so NULL is detectable. Production main.go wires this in
// preference to adapting tenantmasterrecord.Service.Get which loses
// the NULL signal.
type PGTenantDefaultsReader struct{ Pool *pgxpool.Pool }

func NewPGTenantDefaultsReader(pool *pgxpool.Pool) *PGTenantDefaultsReader {
	return &PGTenantDefaultsReader{Pool: pool}
}

const sqlTenantDefaultsSelect = `
	SELECT master_record_tenants_data_region,
	       master_record_tenants_timezone,
	       master_record_tenants_date_format,
	       master_record_tenants_datetime_format,
	       master_record_tenants_workdays,
	       master_record_tenants_week_start,
	       master_record_tenants_rank_method,
	       master_record_tenants_build_changeset_tracking,
	       master_record_tenants_primary_contact_email,
	       master_record_tenants_description,
	       master_record_tenants_notes,
	       master_record_tenants_archived_at
	  FROM master_record_tenants
	 WHERE master_record_tenants_id_subscription = $1`

func (r *PGTenantDefaultsReader) Get(ctx context.Context, subscriptionID uuid.UUID) (*tenantSettings, error) {
	var t tenantSettings
	err := r.Pool.QueryRow(ctx, sqlTenantDefaultsSelect, subscriptionID).Scan(
		&t.DataRegion, &t.Timezone, &t.DateFormat, &t.DatetimeFormat,
		&t.Workdays, &t.WeekStart, &t.RankMethod, &t.BuildChangesetTracking,
		&t.PrimaryContactEmail, &t.Description, &t.Notes,
		&t.ArchivedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("read tenant defaults: %w", err)
	}
	return &t, nil
}
