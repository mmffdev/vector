// Dev reset handlers — POST /_site/admin/dev/adoption-reset
//                       POST /_site/admin/dev/master-reset
//                       POST /_site/admin/dev/seed-risks
//
// Gadmin-only tools for resetting a subscription's data in dev/staging.
// Hard deletes only — no audit trail for these dev-only operations.
//
// Card 00054 (Phase 5)
package portfoliomodels

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// DevResetHandler holds both DB pools and the topology service for dev operations.
type DevResetHandler struct {
	VectorPool  *pgxpool.Pool    // mmff_vector
	VAPool      *pgxpool.Pool    // vector_artefacts (may be nil)
	TopologySvc *topology.Service
}

func NewDevResetHandler(vectorPool *pgxpool.Pool, vaPool *pgxpool.Pool, topologySvc *topology.Service) *DevResetHandler {
	return &DevResetHandler{VectorPool: vectorPool, VAPool: vaPool, TopologySvc: topologySvc}
}

// ResetAdoptionState — POST /_site/admin/dev/adoption-reset
//
// Legacy adoption-only reset: clears mirror tables and portfolio model
// state. Leaves artefacts, topology, workspaces, and master_record_workspaces
// (settings sidecar in vector_artefacts) untouched. Prefer MasterReset for
// a full testbed rebuild.
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
// re-seeds vector_artefacts.master_record_workspaces (the workspace
// settings sidecar) + one root topology node.
//
// Cleared (mmff_vector):
//   - master_record_workspaces + roles_workspaces (all workspaces — anchor identity)
//   - o_flow_tenant overrides
//   (mmff_vector.master_record_tenants is vestigial since M2 — not reset here)
//
// Cleared (vector_artefacts):
//   - artefacts_adoption_states (per-workspace adoption state)
//
// Cleared (vector_artefacts):
//   - artefacts_fields_values, artefacts, artefacts_number_sequences
//   - tenant artefacts_types (source='tenant' only; system rows preserved)
//   - timeboxes_sprints, timeboxes_releases
//   - users_roles_topology_nodes, topology_view_states, topology_nodes
//   - master_record_portfolios
//
// Re-seeded (vector_artefacts):
//   - master_record_workspaces: ACME Bank testbed identity
//   - topology_nodes: single root node "ACME Bank"
//
// NOT touched: users, sessions, roles, permissions, pages, nav prefs,
//              subscriptions, tenants, system artefacts_types.
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

// ArtefactsCount — GET /_site/admin/dev/artefacts-count
//
// Pre-flight for the `<artefacts> -d` skill. Returns live / archived /
// total artefact counts for the caller's subscription on vector_artefacts.
// Read-only — surfaces the blast radius before the destructive call.
func (h *DevResetHandler) ArtefactsCount(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.VAPool == nil {
		http.Error(w, "vector_artefacts pool unavailable", http.StatusServiceUnavailable)
		return
	}

	var live, archived, total int64
	err := h.VAPool.QueryRow(r.Context(), sqlCountArtefactsForSubscription, u.SubscriptionID).
		Scan(&live, &archived, &total)
	if err != nil {
		http.Error(w, fmt.Sprintf("count failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"subscription_id": u.SubscriptionID,
		"live":            live,
		"archived":        archived,
		"total":           total,
	})
}

// ArtefactsWipe — POST /_site/admin/dev/artefacts-wipe
//
// Tenant-scoped hard-delete of every artefact (live + archived) for the
// caller's subscription on vector_artefacts. Cascades:
//   - artefacts_fields_values (ON DELETE CASCADE via FK)
//   - artefacts_search_outbox (ON DELETE CASCADE via FK)
//
// Also clears artefacts_number_sequences so a fresh seed restarts at 1.
//
// PRESERVED: artefacts_types, topology_nodes, flows*, timeboxes_*,
//            artefacts_fields_library, master_record_workspaces, users,
//            roles, permissions, workspaces.
//
// Single transaction; rollback on any failure. Gadmin-only via the route
// permission gate (same group as the other /dev/* tools). Body must
// contain {"confirm":"yes"} — server-side double-check on top of the
// skill's prompt; mismatched body → 400.
//
// Returns the deleted row counts so the skill can report back.
func (h *DevResetHandler) ArtefactsWipe(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.VAPool == nil {
		http.Error(w, "vector_artefacts pool unavailable", http.StatusServiceUnavailable)
		return
	}

	var body struct {
		Confirm string `json:"confirm"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Confirm != "yes" {
		http.Error(w, `{"error":"confirm field must be \"yes\""}`, http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		http.Error(w, fmt.Sprintf("begin tx: %v", err), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	fvTag, err := tx.Exec(ctx, sqlDeleteAllArtefactFieldValuesForSubscription, u.SubscriptionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("artefacts_fields_values: %v", err), http.StatusInternalServerError)
		return
	}
	aTag, err := tx.Exec(ctx, sqlDeleteAllArtefactsForSubscription, u.SubscriptionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("artefacts: %v", err), http.StatusInternalServerError)
		return
	}
	nsTag, err := tx.Exec(ctx, sqlDeleteArtefactNumberSequenceForSubscription, u.SubscriptionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("artefacts_number_sequences: %v", err), http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, fmt.Sprintf("commit: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":                          true,
		"subscription_id":                  u.SubscriptionID,
		"artefacts_deleted":                aTag.RowsAffected(),
		"artefacts_fields_values_deleted":  fvTag.RowsAffected(),
		"artefacts_number_sequences_reset": nsTag.RowsAffected(),
		"message":                          "Artefacts wiped. Types, topology, flows, timeboxes, fields-library preserved.",
	})
}

// ApiAudit — GET /_site/admin/dev/api-audit
//
// Serves the API-touchpoint audit snapshot produced by
// dev/scripts/audit_api_touchpoints.sh. The snapshot is regenerated on
// demand by re-running the script; this handler just reads the latest
// dev/audits/api-touchpoints.json and returns it.
//
// Returns 404 if the snapshot file is missing (script never run).
//
// The page that consumes this lives at /dev/api-audit (rail2 Dev Tools).
// SOC2 narrative: every site DB-touch must route via apiSite; this page
// is the standing evidence that the rule is being measured.
func (h *DevResetHandler) ApiAudit(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Anchor on the repo root regardless of where the binary was started.
	// In dev, the working dir is usually the project root or backend/.
	candidates := []string{
		"dev/audits/api-touchpoints.json",
		"../dev/audits/api-touchpoints.json",
		"../../dev/audits/api-touchpoints.json",
	}
	var data []byte
	var err error
	var found string
	for _, c := range candidates {
		abs, _ := filepath.Abs(c)
		if _, statErr := os.Stat(abs); statErr == nil {
			data, err = os.ReadFile(abs)
			found = abs
			break
		}
	}
	if found == "" || err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"snapshot not found","hint":"run bash dev/scripts/audit_api_touchpoints.sh"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

// SeedRisks — POST /_site/admin/dev/seed-risks
//
// Inserts N Risk artefacts assigned to the chosen user (default: the caller).
// Mirrors db/vector_artefacts/dev-seeds/seed_risks.sql. Returns the number
// of rows inserted plus the resolved risk type / workspace ids for sanity.
//
// Body (all optional):
//   { "count": 200, "assignee_id": "<uuid>" }
//
// Defaults: count=200; assignee_id = caller's user id.
func (h *DevResetHandler) SeedRisks(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.VAPool == nil {
		http.Error(w, "vector_artefacts pool unavailable", http.StatusServiceUnavailable)
		return
	}

	var body struct {
		Count      int     `json:"count"`
		AssigneeID *string `json:"assignee_id"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Count <= 0 {
		body.Count = 200
	}
	if body.Count > 5000 {
		body.Count = 5000
	}

	assignee := u.ID
	if body.AssigneeID != nil && *body.AssigneeID != "" {
		parsed, perr := uuid.Parse(*body.AssigneeID)
		if perr != nil {
			http.Error(w, "invalid assignee_id", http.StatusBadRequest)
			return
		}
		assignee = parsed
	}

	ctx := r.Context()

	// Resolve workspace_id + risk artefact type for this subscription.
	var workspaceID, riskTypeID uuid.UUID
	if err := h.VAPool.QueryRow(ctx, sqlResolveRiskTypeForSubscription, u.SubscriptionID).
		Scan(&riskTypeID, &workspaceID); err != nil {
		http.Error(w, fmt.Sprintf("no Risk artefact type for subscription: %v", err), http.StatusNotFound)
		return
	}

	var inserted int
	if err := h.VAPool.QueryRow(ctx, sqlSeedRisks, u.SubscriptionID, workspaceID, riskTypeID, assignee, body.Count).
		Scan(&inserted); err != nil {
		http.Error(w, fmt.Sprintf("seed-risks failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"inserted":     inserted,
		"workspace_id": workspaceID,
		"risk_type_id": riskTypeID,
		"assignee_id":  assignee,
		"message":      fmt.Sprintf("Inserted %d risk(s) assigned to %s.", inserted, assignee),
	})
}

// SeedWorkspace — POST /_site/admin/dev/seed-workspace
//
// Inserts a fresh workspace + root topology node for the caller's subscription.
// Each call produces a distinct workspace (random UUID). Name defaults to
// "Dev Workspace <timestamp>"; override via body { "name": "..." }.
// Mirrors dev/scripts/seed_workspace.go — used by the Workspaces admin UI button.
func (h *DevResetHandler) SeedWorkspace(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.VAPool == nil {
		http.Error(w, "vector_artefacts pool unavailable", http.StatusServiceUnavailable)
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Name == "" {
		body.Name = "Dev Workspace " + uuid.NewString()[:8]
	}

	ctx := r.Context()

	// Insert workspace on mmff_vector.
	var workspaceID uuid.UUID
	err := h.VectorPool.QueryRow(ctx, sqlDevSeedWorkspace,
		u.SubscriptionID,
		body.Name,
		devWorkspaceSlug(body.Name),
		u.ID,
	).Scan(&workspaceID)
	if err != nil {
		http.Error(w, fmt.Sprintf("insert workspace: %v", err), http.StatusInternalServerError)
		return
	}

	// Grant the caller admin access so the workspace clamp middleware lets them in.
	if _, err := h.VectorPool.Exec(ctx, sqlDevSeedWorkspaceCreatorGrant,
		u.SubscriptionID, workspaceID, u.ID,
	); err != nil {
		http.Error(w, fmt.Sprintf("insert workspace grant: %v", err), http.StatusInternalServerError)
		return
	}

	// Seed root topology node on vector_artefacts.
	vaTx, err := h.VAPool.Begin(ctx)
	if err != nil {
		http.Error(w, fmt.Sprintf("begin va tx: %v", err), http.StatusInternalServerError)
		return
	}
	if seedErr := h.TopologySvc.SeedRootNode(ctx, workspaceID, u.SubscriptionID, body.Name, vaTx); seedErr != nil {
		_ = vaTx.Rollback(ctx)
		http.Error(w, fmt.Sprintf("seed topology root: %v", seedErr), http.StatusInternalServerError)
		return
	}
	if err := vaTx.Commit(ctx); err != nil {
		http.Error(w, fmt.Sprintf("commit va tx: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"workspace_id": workspaceID,
		"name":         body.Name,
	})
}

// devWorkspaceSlug converts a name to a slug safe for the workspace slug CHECK constraint.
func devWorkspaceSlug(name string) string {
	slug := make([]byte, 0, len(name))
	for _, c := range []byte(name) {
		switch {
		case c >= 'A' && c <= 'Z':
			slug = append(slug, c+32)
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			slug = append(slug, c)
		default:
			if len(slug) > 0 && slug[len(slug)-1] != '-' {
				slug = append(slug, '-')
			}
		}
	}
	for len(slug) > 0 && slug[len(slug)-1] == '-' {
		slug = slug[:len(slug)-1]
	}
	if len(slug) == 0 {
		return "dev-workspace"
	}
	return string(slug)
}

// ─── private ─────────────────────────────────────────────────────────────────

// resetAdoptionTables — adoption-only clear (used by ResetAdoptionState).
//
// PLA-0023 cutover (2026-05-13): all six legacy mmff_vector mirror tables
// have been dropped. Adoption state now lives exclusively on
// vector_artefacts.artefacts_adoption_states, so this reset is a single VA
// DELETE. No-op when VAPool is unavailable.
func (h *DevResetHandler) resetAdoptionTables(ctx context.Context, subscriptionID uuid.UUID) error {
	if h.VAPool == nil {
		return nil
	}
	_, err := h.VAPool.Exec(ctx, sqlDeleteAllAdoptionStateForSubscription, subscriptionID)
	return err
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

	// 0. Adoption state — must clear before artefacts_types since the
	//    PLA-0023 cutover replaced the legacy mmff_vector mirror table.
	if _, err = tx.Exec(ctx, sqlDeleteAllAdoptionStateForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts_adoption_states: %w", err)
	}

	// 1. Artefact field values (child — delete first).
	if _, err = tx.Exec(ctx, sqlDeleteAllArtefactFieldValuesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts_fields_values: %w", err)
	}

	// 2. Artefacts.
	if _, err = tx.Exec(ctx, sqlDeleteAllArtefactsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts: %w", err)
	}

	// 3. Number sequence counters.
	if _, err = tx.Exec(ctx, sqlDeleteArtefactNumberSequenceForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts_number_sequences: %w", err)
	}

	// 4. Tenant-authored artefact types (source='tenant' only).
	if _, err = tx.Exec(ctx, sqlDeleteTenantArtefactTypesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts_types: %w", err)
	}

	// 5. Timeboxes.
	if _, err = tx.Exec(ctx, sqlDeleteAllTimeboxSprintsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("timeboxes_sprints: %w", err)
	}
	if _, err = tx.Exec(ctx, sqlDeleteAllTimeboxReleasesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("timeboxes_releases: %w", err)
	}

	// 6. Topology — delegated to topology.Service to preserve sole-writer boundary.
	if err = h.TopologySvc.PurgeTenantTopologyData(ctx, subscriptionID, tx); err != nil {
		return fmt.Errorf("topology purge: %w", err)
	}

	// 7. Master record portfolio (adoption snapshot).
	if _, err = tx.Exec(ctx, sqlDeleteMasterRecordPortfolioForWorkspace, devWorkspaceID); err != nil {
		return fmt.Errorf("master_record_portfolios: %w", err)
	}

	// 8. Upsert master_record_workspaces with ACME Bank testbed identity.
	if _, err = tx.Exec(ctx, sqlUpsertTestbedTenantRecord, devWorkspaceID, ownerUserID); err != nil {
		return fmt.Errorf("master_record_workspaces upsert: %w", err)
	}

	// 9. Seed root topology node "ACME Bank".
	if err = h.TopologySvc.SeedRootNode(ctx, devWorkspaceID, subscriptionID, "ACME Bank", tx); err != nil {
		return fmt.Errorf("topology root node: %w", err)
	}

	// 10. Re-seed starter strategy artefacts via the SQL function installed by
	//     db/vector_artefacts/schema/052_seed_dev_strategy_artefacts.sql. Safe no-op
	//     if the five strategy artefacts_types don't exist (e.g. before the
	//     user has adopted a portfolio model). Idempotent — the seed uses
	//     ON CONFLICT against the unique (subscription_id, type, number) index.
	if _, err = tx.Exec(ctx, sqlSeedDevStrategyArtefactsFn, subscriptionID, devWorkspaceID); err != nil {
		return fmt.Errorf("seed_dev_strategy_artefacts: %w", err)
	}

	return tx.Commit(ctx)
}

// masterResetVector clears tenant data from mmff_vector.
// Note: mmff_vector.master_record_tenants is vestigial (superseded by
// vector_artefacts.master_record_workspaces in M2 — renamed from
// master_record_tenants by migration 067 on 2026-05-15) — not written here.
func (h *DevResetHandler) masterResetVector(ctx context.Context, subscriptionID uuid.UUID) error {
	tx, err := h.VectorPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// PLA-0023 cutover (2026-05-13): legacy adoption mirror tables on
	// mmff_vector are dropped. Adoption state is cleared via the VA path
	// in masterResetVA above (DELETE FROM artefacts_adoption_states). This
	// tx now only handles workspaces + role grants on mmff_vector.

	// Workspace role grants before workspaces (FK child).
	if _, err = tx.Exec(ctx, sqlDeleteRolesWorkspacesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("roles_workspaces: %w", err)
	}

	if _, err = tx.Exec(ctx, sqlDeleteAllWorkspacesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("master_record_workspaces: %w", err)
	}

	return tx.Commit(ctx)
}
