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
// workspace. Two-step lookup with a defensive fallback:
//
//  1. Treat the input as a workspace_id and look it up in fdw_workspaces.
//     This is the canonical path.
//  2. If the workspace lookup misses, treat the input as a subscription_id
//     and verify it exists in fdw_subscriptions. This guards against the
//     pre-existing /_site/workspace-settings handler bug (TD-WS-NNN) where
//     it passes user.SubscriptionID where workspace_id was intended. Until
//     that handler is rewired to carry an explicit active-workspace, this
//     fallback keeps inheritance working for the single-workspace-per-
//     subscription common case.
//
// Returns ErrNotFound only when neither lookup matches — Service.merge-
// Inheritance then falls to schema defaults so the surface degrades
// gracefully rather than crashes.
func (r *FDWSubscriptionResolver) SubscriptionFor(ctx context.Context, workspaceOrSubID uuid.UUID) (uuid.UUID, error) {
	var subID uuid.UUID
	err := r.Pool.QueryRow(ctx,
		`SELECT subscription_id FROM fdw_workspaces WHERE id = $1`,
		workspaceOrSubID,
	).Scan(&subID)
	if err == nil {
		return subID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("resolve subscription via workspace: %w", err)
	}
	// Fallback: maybe the caller handed us a subscription_id directly.
	var found uuid.UUID
	err = r.Pool.QueryRow(ctx,
		`SELECT id FROM fdw_subscriptions WHERE id = $1`,
		workspaceOrSubID,
	).Scan(&found)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("resolve subscription direct: %w", err)
	}
	return found, nil
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
