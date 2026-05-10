// Dev reset handlers — POST /_site/admin/dev/adoption-reset
//                       POST /_site/admin/dev/master-reset
//
// Gadmin-only tools for resetting a subscription's data in dev/staging.
// Hard deletes only — no audit trail for these dev-only operations.
//
// Card 00054 (Phase 5)
package portfoliomodels

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// DevResetHandler holds both DB pools for dev operations.
type DevResetHandler struct {
	VectorPool *pgxpool.Pool // mmff_vector
	VAPool     *pgxpool.Pool // vector_artefacts (may be nil)
}

func NewDevResetHandler(vectorPool *pgxpool.Pool, vaPool *pgxpool.Pool) *DevResetHandler {
	return &DevResetHandler{VectorPool: vectorPool, VAPool: vaPool}
}

// ResetAdoptionState — POST /_site/admin/dev/adoption-reset
//
// Legacy adoption-only reset: clears mirror tables and portfolio model
// state. Leaves artefacts, topology, workspaces, and master_record_tenant
// untouched. Prefer MasterReset for a full testbed rebuild.
func (h *DevResetHandler) ResetAdoptionState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.resetAdoptionTables(r.Context(), u.SubscriptionID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Portfolio adoption state reset to zero.",
	})
}

// MasterReset — POST /_site/admin/dev/master-reset
//
// Full testbed reset. Clears all tenant data across both DBs and
// re-seeds master_record_tenant + one root topology node.
//
// Cleared (mmff_vector):
//   - master_record_workspaces + roles_workspaces (all workspaces)
//   - subscription_portfolio_model_state
//   - adoption mirror tables (source_library_id rows only)
//   - o_flow_tenant overrides
//   (mmff_vector.master_record_tenant is vestigial since M2 — not reset here)
//
// Cleared (vector_artefacts):
//   - artefact_field_values, artefacts, artefact_number_sequence
//   - tenant artefact_types (source='tenant' only; system rows preserved)
//   - timebox_sprints, timebox_releases
//   - topology_role_grants, topology_view_state, topology_nodes
//   - master_record_portfolio
//
// Re-seeded (vector_artefacts):
//   - master_record_tenant: ACME Bank testbed identity
//   - topology_nodes: single root node "ACME Bank"
//
// NOT touched: users, sessions, roles, permissions, pages, nav prefs,
//              subscriptions, tenants, system artefact_types.
func (h *DevResetHandler) MasterReset(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()

	// Part A — vector_artefacts
	if h.VAPool != nil {
		if err := h.masterResetVA(ctx, u.SubscriptionID, u.ID); err != nil {
			http.Error(w, fmt.Sprintf("master-reset (vector_artefacts) failed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	// Part B — mmff_vector
	if err := h.masterResetVector(ctx, u.SubscriptionID); err != nil {
		http.Error(w, fmt.Sprintf("master-reset (mmff_vector) failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Master reset complete. Tenant data cleared and testbed defaults applied.",
	})
}

// ─── private ─────────────────────────────────────────────────────────────────

// resetAdoptionTables — legacy adoption-only clear (used by ResetAdoptionState).
// Each delete targets rows with source_library_id IS NOT NULL to avoid
// touching hand-authored subscription data.
func (h *DevResetHandler) resetAdoptionTables(ctx context.Context, subscriptionID uuid.UUID) error {
	steps := []string{
		`DELETE FROM subscription_artifacts           WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_terminology         WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_workflow_transitions WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_workflows           WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM obj_strategy_types_layers        WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_portfolio_model_state WHERE subscription_id = $1`,
	}
	for _, sql := range steps {
		if _, err := h.VectorPool.Exec(ctx, sql, subscriptionID); err != nil {
			return err
		}
	}
	return nil
}

// masterResetVA clears and re-seeds vector_artefacts for the subscription.
func (h *DevResetHandler) masterResetVA(ctx context.Context, subscriptionID uuid.UUID, ownerUserID uuid.UUID) error {
	// Well-known dev workspace UUID — matches the constant in 010_master_reset.sql.
	// This workspace row is created by the workspace seed; the UUID is stable
	// and agreed with the seed script.
	devWorkspaceID := uuid.MustParse("00000000-0000-0000-0000-000000000010")

	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Artefact field values (child — delete first).
	if _, err = tx.Exec(ctx, `DELETE FROM artefact_field_values WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("artefact_field_values: %w", err)
	}

	// 2. Artefacts.
	if _, err = tx.Exec(ctx, `DELETE FROM artefacts WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("artefacts: %w", err)
	}

	// 3. Number sequence counters.
	if _, err = tx.Exec(ctx, `DELETE FROM artefact_number_sequence WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("artefact_number_sequence: %w", err)
	}

	// 4. Tenant-authored artefact types (source='tenant' only).
	if _, err = tx.Exec(ctx, `DELETE FROM artefact_types WHERE subscription_id = $1 AND source = 'tenant'`, subscriptionID); err != nil {
		return fmt.Errorf("artefact_types: %w", err)
	}

	// 5. Timeboxes.
	if _, err = tx.Exec(ctx, `DELETE FROM timebox_sprints WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("timebox_sprints: %w", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM timebox_releases WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("timebox_releases: %w", err)
	}

	// 6. Topology — clear role grants and view state first, then detach
	//    parent_id self-references before deleting nodes (avoids ON DELETE
	//    RESTRICT firing on the parent_id FK during a cascading delete).
	if _, err = tx.Exec(ctx, `DELETE FROM topology_role_grants WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("topology_role_grants: %w", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM topology_view_state WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("topology_view_state: %w", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE topology_nodes SET parent_id = NULL WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("topology_nodes parent detach: %w", err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM topology_nodes WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("topology_nodes: %w", err)
	}

	// 7. Master record portfolio (adoption snapshot).
	if _, err = tx.Exec(ctx, `DELETE FROM master_record_portfolio WHERE workspace_id = $1`, devWorkspaceID); err != nil {
		return fmt.Errorf("master_record_portfolio: %w", err)
	}

	// 8. Upsert master_record_tenant with ACME Bank testbed identity.
	if _, err = tx.Exec(ctx, `
		INSERT INTO master_record_tenant (
			workspace_id,
			tenant_name,
			tenant_description,
			tenant_owner_user_id,
			tenant_data_region,
			tenant_timezone,
			tenant_date_format,
			tenant_datetime_format,
			tenant_workdays,
			tenant_week_start,
			tenant_rank_method,
			tenant_build_changeset_tracking,
			tenant_primary_contact_email
		) VALUES (
			$1, 'ACME Bank', 'MMFFDev Testbed', $2,
			'euw2', 'Europe/London', 'DD/MM/YYYY', 'DD/MM/YYYY HH:mm',
			ARRAY['mon','tue','wed','thu','fri']::text[],
			'mon', 'manual', FALSE, 'cookra@me.com'
		)
		ON CONFLICT (workspace_id) DO UPDATE
		   SET tenant_name                     = EXCLUDED.tenant_name,
		       tenant_description              = EXCLUDED.tenant_description,
		       tenant_owner_user_id            = EXCLUDED.tenant_owner_user_id,
		       tenant_data_region              = EXCLUDED.tenant_data_region,
		       tenant_timezone                 = EXCLUDED.tenant_timezone,
		       tenant_date_format              = EXCLUDED.tenant_date_format,
		       tenant_datetime_format          = EXCLUDED.tenant_datetime_format,
		       tenant_workdays                 = EXCLUDED.tenant_workdays,
		       tenant_week_start               = EXCLUDED.tenant_week_start,
		       tenant_rank_method              = EXCLUDED.tenant_rank_method,
		       tenant_build_changeset_tracking = EXCLUDED.tenant_build_changeset_tracking,
		       tenant_primary_contact_email    = EXCLUDED.tenant_primary_contact_email,
		       tenant_updated_at               = now()
	`, devWorkspaceID, ownerUserID); err != nil {
		return fmt.Errorf("master_record_tenant upsert: %w", err)
	}

	// 9. Seed root topology node "ACME Bank".
	if _, err = tx.Exec(ctx, `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id,
			name, description, layout_mode, collapsed_default, sort_order
		) VALUES (
			gen_random_uuid(), $1, $2, NULL,
			'ACME Bank', '', 'auto-horizontal', FALSE, 0
		)
	`, devWorkspaceID, subscriptionID); err != nil {
		return fmt.Errorf("topology root node: %w", err)
	}

	return tx.Commit(ctx)
}

// masterResetVector clears tenant data from mmff_vector.
// Note: mmff_vector.master_record_tenant is vestigial (superseded by
// vector_artefacts.master_record_tenant in M2) — not written here.
func (h *DevResetHandler) masterResetVector(ctx context.Context, subscriptionID uuid.UUID) error {
	tx, err := h.VectorPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Adoption mirror tables (FK-safe order).
	steps := []string{
		`DELETE FROM subscription_workflow_transitions WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_workflows           WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM obj_strategy_types_layers        WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_terminology         WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_artifacts           WHERE subscription_id = $1 AND source_library_id IS NOT NULL`,
		`DELETE FROM subscription_portfolio_model_state WHERE subscription_id = $1`,
		`DELETE FROM o_flow_tenant                    WHERE subscription_id = $1`,
	}
	for _, sql := range steps {
		if _, err = tx.Exec(ctx, sql, subscriptionID); err != nil {
			return fmt.Errorf("%s: %w", sql[:40], err)
		}
	}

	// Workspace role grants before workspaces (FK child).
	if _, err = tx.Exec(ctx, `
		DELETE FROM roles_workspaces
		 WHERE workspace_id IN (
		     SELECT id FROM master_record_workspaces WHERE subscription_id = $1
		 )
	`, subscriptionID); err != nil {
		return fmt.Errorf("roles_workspaces: %w", err)
	}

	if _, err = tx.Exec(ctx, `DELETE FROM master_record_workspaces WHERE subscription_id = $1`, subscriptionID); err != nil {
		return fmt.Errorf("master_record_workspaces: %w", err)
	}

	return tx.Commit(ctx)
}
