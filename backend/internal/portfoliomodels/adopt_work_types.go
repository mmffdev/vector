package portfoliomodels

// PLA-0026 / Story 00494 (B5): adoption-saga step 3 — mirror the
// SYSTEM work-type seed (Story, Defect, Task, Epic, ...) into THIS
// workspace as scope='work' tenant rows.
//
// Unlike writeStrategyArtefactTypes, this writer does NOT consume the
// library bundle. Work-types come from the system seed at
//   db/vector_artefacts/schema/010_seed_system_artefact_types.sql
// (which seeds rows with workspace_id=NULL, source='system',
// scope='work' for the host subscription). At runtime we read those
// LIVE seeded rows and copy them per workspace as source='tenant' so
// the tenant can edit / archive their own copy without mutating the
// system template.
//
// Schema target: vector_artefacts.artefact_types (M1–M4)
//   subscription_id   — soft FK mmff_vector.subscriptions
//   workspace_id      — soft FK mmff_vector.workspaces  (NOT NULL)
//   scope             — 'work'
//   source            — 'tenant' (every per-workspace copy is editable)
//   name              — copied from system row
//   prefix            — copied from system row (US, DE, TA, EP, ...)
//   description       — copied from system row (may be NULL)
//   parent_type_id    — Phase 2 resolves via prefix→tenant_id map. The
//                       current system seed has no parent chain (work
//                       scope is flat per migration 003 CHECK
//                       artefact_types_work_no_parent), so Phase 2 is
//                       a defensive no-op today, but the pattern
//                       mirrors writeStrategyArtefactTypes for any
//                       future seed that introduces work hierarchy.
//   allows_children   — copied from system row
//   sort_order        — copied from system row
//   library_layer_id  — NULL (work-types have no library provenance)
//   library_layer_tag — NULL
//
// Idempotency key: UNIQUE (workspace_id, scope, prefix) WHERE archived_at IS NULL
// (uq_artefact_types_ws_scope_prefix from M4 / migration 019).
//
// User-edit safety: ON CONFLICT DO NOTHING means a re-run will not
// clobber a tenant's customised name/description/sort_order.

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// systemWorkType is an in-memory snapshot of one row from the system
// seed (source='system', scope='work'). We read these rows once at the
// start of the writer and use them as the template for the per-
// workspace tenant copies.
type systemWorkType struct {
	id             uuid.UUID
	parentID       *uuid.UUID
	name           string
	prefix         string
	description    *string
	allowsChildren bool
	sortOrder      int
}

// writeWorkArtefactTypes mirrors the system work-type seed (Story,
// Defect, Task, Epic, ...) into this workspace as scope='work' tenant
// rows. Two-phase topological insert handles the parent_type_id
// self-FK. Idempotent via uq_artefact_types_ws_scope_prefix.
//
// Source of truth: db/vector_artefacts/schema/010_seed_system_artefact_types.sql
// — but at runtime we read the LIVE seeded rows (source='system' AND
// scope='work') and copy them per workspace. This keeps the saga
// writer in lock-step with whatever the seed file contains today,
// without re-encoding the seed in Go.
func writeWorkArtefactTypes(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID, workspaceID uuid.UUID,
) error {
	// Phase 0: read the system template rows for this subscription. We
	// scope to subscription_id so each tenant gets the work-types that
	// were seeded for them (per 010_seed_system_artefact_types.sql,
	// which is invoked per subscription).
	systemRows, err := loadSystemWorkTypes(ctx, vaTx, subscriptionID)
	if err != nil {
		return err
	}
	if len(systemRows) == 0 {
		// Empty-seed case: fresh DB or this subscription was never
		// seeded. Nothing to mirror — the writer is a no-op.
		return nil
	}

	// Build system-id → prefix map for Phase 2 parent resolution.
	systemIDToPrefix := make(map[uuid.UUID]string, len(systemRows))
	for _, s := range systemRows {
		systemIDToPrefix[s.id] = s.prefix
	}

	// Phase 1: insert every system row as a tenant copy with
	// parent_type_id=NULL. ON CONFLICT DO NOTHING preserves any prior
	// tenant edits on re-run.
	for _, s := range systemRows {
		if _, err := vaTx.Exec(ctx, sqlInsertWorkArtefactTypeFromSystem,
			subscriptionID, workspaceID,
			s.name, s.prefix, s.description,
			s.allowsChildren, s.sortOrder,
		); err != nil {
			return fmt.Errorf("insert work artefact_type %q: %w", s.name, err)
		}
	}

	// Phase 2: reload tenant rows for this workspace and resolve any
	// parent chain via prefix. The current schema CHECK
	// artefact_types_work_no_parent forbids parent_type_id on work
	// rows, so this loop is a defensive no-op today — but if a future
	// system seed introduces hierarchy AND the CHECK is relaxed, the
	// writer will resolve parents correctly without code changes.
	tenantPrefixToID, err := loadWorkTenantPrefixMap(ctx, vaTx, workspaceID)
	if err != nil {
		return err
	}

	for _, s := range systemRows {
		if s.parentID == nil {
			continue
		}
		parentPrefix, ok := systemIDToPrefix[*s.parentID]
		if !ok {
			return fmt.Errorf("system work-type %q references unknown parent_type_id %s",
				s.name, *s.parentID)
		}
		newParentID, ok := tenantPrefixToID[parentPrefix]
		if !ok {
			// Parent's tenant copy missing — should not happen because
			// Phase 1 inserted every system row, but surface defensively.
			return fmt.Errorf("tenant copy of parent prefix %q missing for work-type %q",
				parentPrefix, s.name)
		}
		selfID, ok := tenantPrefixToID[s.prefix]
		if !ok {
			// Tenant copy of self missing — Phase 1 ON CONFLICT DO
			// NOTHING skipped a row that was already present in a
			// prior run; its parent should already be set, so nothing
			// to do here.
			continue
		}
		if _, err := vaTx.Exec(ctx, sqlUpdateWorkArtefactTypeParent,
			newParentID, selfID, workspaceID,
		); err != nil {
			return fmt.Errorf("set parent for work artefact_type %q: %w", s.name, err)
		}
	}
	return nil
}

// loadSystemWorkTypes returns every live system-seeded work-type row
// for the given subscription. These are the templates Phase 1 mirrors.
func loadSystemWorkTypes(
	ctx context.Context,
	vaTx pgx.Tx,
	subscriptionID uuid.UUID,
) ([]systemWorkType, error) {
	rows, err := vaTx.Query(ctx, sqlSelectSystemWorkTypes, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("load system work-types: %w", err)
	}
	defer rows.Close()
	var out []systemWorkType
	for rows.Next() {
		var s systemWorkType
		if err := rows.Scan(
			&s.id, &s.parentID, &s.name, &s.prefix, &s.description,
			&s.allowsChildren, &s.sortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan system work-type: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// loadWorkTenantPrefixMap returns prefix → artefact_type_id for every
// live work-scope tenant row in this workspace. Used by Phase 2 to
// resolve parent_type_id by stable-prefix lookup (system → tenant).
func loadWorkTenantPrefixMap(
	ctx context.Context,
	vaTx pgx.Tx,
	workspaceID uuid.UUID,
) (map[string]uuid.UUID, error) {
	rows, err := vaTx.Query(ctx, sqlSelectWorkTenantPrefixMap, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("load work tenant prefix map: %w", err)
	}
	defer rows.Close()
	m := make(map[string]uuid.UUID)
	for rows.Next() {
		var prefix string
		var id uuid.UUID
		if err := rows.Scan(&prefix, &id); err != nil {
			return nil, fmt.Errorf("scan work tenant prefix map: %w", err)
		}
		m[prefix] = id
	}
	return m, rows.Err()
}
