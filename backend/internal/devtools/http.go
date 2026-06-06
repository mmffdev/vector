package devtools

// handler.go — the HTTP surface of the devtools framework. Mounts under
// /_site/admin/dev/scope-actions/* inside the existing permission-gated dev
// route group (PortfolioList) in cmd/server/main.go. Every handler is
// additionally fail-closed on DevEnvAllowed() (defence-in-depth on top of the
// route's permission gate) and on a non-nil VAPool.
//
// Read endpoints (the cascading dropdowns) run directly on the pool. The two
// preview endpoints open a tx, count, and ALWAYS roll back (they mutate
// nothing). The two run endpoints require {"confirm":"yes"}, then inside a
// single tx: snapshot the affected tables to timestamped backup tables (STEP 0,
// before any mutation, so the op is reversible), run the engine action, and
// commit. The backup-table timestamp suffix is returned so the operator knows
// the restore point.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler is the chi-style HTTP handler for the devtools scope-actions surface.
type Handler struct {
	VAPool *pgxpool.Pool // vector_artefacts (may be nil pre-cutover)
}

// NewHandler constructs the devtools HTTP handler over the vector_artefacts pool.
func NewHandler(vaPool *pgxpool.Pool) *Handler {
	return &Handler{VAPool: vaPool}
}

// writeJSON is a package-local copy of the portfoliomodels helper (that one is
// unexported and lives in another package). Encodes v as JSON with the status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// guard is the fail-closed gate for every endpoint: it rejects with 403 unless
// the process is in a recognised dev environment AND a vector_artefacts pool is
// wired. Returns true when the caller may proceed.
func (h *Handler) guard(w http.ResponseWriter) bool {
	if !DevEnvAllowed() || h.VAPool == nil {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "devtools scope-actions are disabled (dev-env-only, requires vector_artefacts)",
		})
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Cascading dropdowns (read-only, run on the pool)
// ---------------------------------------------------------------------------

// Subscriptions — GET /_site/admin/dev/scope-actions/subscriptions
func (h *Handler) Subscriptions(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	opts, err := ListSubscriptions(r.Context(), h.VAPool)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": opts})
}

// Workspaces — GET /_site/admin/dev/scope-actions/workspaces?subscription_id=UUID
func (h *Handler) Workspaces(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	subID, ok := parseQueryUUID(w, r, "subscription_id")
	if !ok {
		return
	}
	opts, err := ListWorkspaces(r.Context(), h.VAPool, subID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": opts})
}

// TopologyNodes — GET /_site/admin/dev/scope-actions/topology-nodes?workspace_id=UUID
func (h *Handler) TopologyNodes(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	wsID, ok := parseQueryUUID(w, r, "workspace_id")
	if !ok {
		return
	}
	opts, err := ListTopologyNodes(r.Context(), h.VAPool, wsID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": opts})
}

// ArtefactTypes — GET /_site/admin/dev/scope-actions/artefact-types?workspace_id=UUID
func (h *Handler) ArtefactTypes(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	wsID, ok := parseQueryUUID(w, r, "workspace_id")
	if !ok {
		return
	}
	opts, err := ListArtefactTypes(r.Context(), h.VAPool, wsID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"options": opts})
}

// parseQueryUUID reads a required UUID query param, writing 400 + false if it is
// missing or unparseable.
func parseQueryUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing " + name})
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid " + name})
		return uuid.Nil, false
	}
	return id, true
}

// ---------------------------------------------------------------------------
// Flow reseed
// ---------------------------------------------------------------------------

// scopeRunBody is the shared request shape for the flow-reseed endpoints.
type scopeRunBody struct {
	Scope              Scope  `json:"scope"`
	IncludeCustomFlows bool   `json:"include_custom_flows"`
	Confirm            string `json:"confirm"`
}

// FlowReseedPreview — POST /_site/admin/dev/scope-actions/flow-reseed/preview
//
// Read-only. Opens a tx, counts what a reseed WOULD do, and ALWAYS rolls back
// (never commits — a preview must not mutate). Returns the ReseedPreview.
func (h *Handler) FlowReseedPreview(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body scopeRunBody
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if err := body.Scope.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	ctx := r.Context()
	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "begin tx: " + err.Error()})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck — preview is intentionally read-only

	preview, err := PreviewReseed(ctx, tx, body.Scope, body.IncludeCustomFlows)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// No commit — defer rollback discards the (empty) tx.
	writeJSON(w, http.StatusOK, map[string]any{
		"preview":      preview,
		"whole_tenant": body.Scope.IsWholeTenant(),
	})
}

// FlowReseedRun — POST /_site/admin/dev/scope-actions/flow-reseed/run
//
// Mutating. Requires {"confirm":"yes"}. Opens a tx, snapshots the flow tables
// (STEP 0) to timestamped backups, reseeds the scope, commits, and returns the
// result plus the backup-table suffix (restore point).
func (h *Handler) FlowReseedRun(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body scopeRunBody
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Confirm != "yes" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": `confirm field must be "yes"`})
		return
	}
	if err := body.Scope.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	ctx := r.Context()
	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "begin tx: " + err.Error()})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck — committed on success; rollback is a no-op then

	// STEP 0 — snapshot the flow tables before any mutation.
	suffix, err := backupFlowTables(ctx, tx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "backup: " + err.Error()})
		return
	}

	result, err := ReseedScope(ctx, tx, body.Scope, body.IncludeCustomFlows)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "commit: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"result":        result,
		"backup_suffix": suffix,
		"backup_tables": flowBackupTableNames(suffix),
	})
}

// ---------------------------------------------------------------------------
// Fixture cleanup
// ---------------------------------------------------------------------------

// confirmBody is the request shape for the fixture-cleanup run endpoint.
type confirmBody struct {
	Confirm string `json:"confirm"`
}

// FixtureCleanupPreview — POST /_site/admin/dev/scope-actions/fixture-cleanup/preview
//
// Read-only. Opens a tx, counts the two fixture clusters, ALWAYS rolls back.
func (h *Handler) FixtureCleanupPreview(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ctx := r.Context()
	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "begin tx: " + err.Error()})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck — preview is intentionally read-only

	preview, err := PreviewFixtureCleanup(ctx, tx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"preview": preview})
}

// FixtureCleanupRun — POST /_site/admin/dev/scope-actions/fixture-cleanup/run
//
// Mutating. Requires {"confirm":"yes"}. Opens a tx, snapshots the full
// artefacts + artefacts_types + flow tables (STEP 0), runs the cleanup, commits,
// and returns the result plus the backup-table suffix.
func (h *Handler) FixtureCleanupRun(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body confirmBody
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if body.Confirm != "yes" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": `confirm field must be "yes"`})
		return
	}

	ctx := r.Context()
	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "begin tx: " + err.Error()})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck — committed on success; rollback is a no-op then

	// STEP 0 — snapshot the full artefacts + types + flow tables before mutating.
	suffix, err := backupFixtureCleanupTables(ctx, tx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "backup: " + err.Error()})
		return
	}

	result, err := RunFixtureCleanup(ctx, tx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "commit: " + err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"result":        result,
		"backup_suffix": suffix,
		"backup_tables": fixtureCleanupBackupTableNames(suffix),
	})
}

// ---------------------------------------------------------------------------
// Backup helpers (STEP 0)
// ---------------------------------------------------------------------------

// backupSuffix is the timestamp suffix shared by all backup tables of one run.
// It is [A-Za-z0-9_] by construction (UTC, YYYYMMDD_HHMMSS), so interpolating it
// into the CREATE TABLE templates in sql.go via fmt.Sprintf is injection-safe.
func backupSuffix() string {
	return time.Now().UTC().Format("20060102_150405")
}

// backupFlowTables snapshots the six flow definition tables + the slim artefacts
// flow-state snapshot to timestamped backup tables, returning the suffix used.
func backupFlowTables(ctx context.Context, tx pgx.Tx) (string, error) {
	ts := backupSuffix()
	stmts := []string{
		fmt.Sprintf(sqlBackupFlows, ts),
		fmt.Sprintf(sqlBackupFlowsStates, ts),
		fmt.Sprintf(sqlBackupFlowsTransitions, ts),
		fmt.Sprintf(sqlBackupFlowsDefaults, ts),
		fmt.Sprintf(sqlBackupFlowsStatesDefaults, ts),
		fmt.Sprintf(sqlBackupFlowsTransitionsDefaults, ts),
		fmt.Sprintf(sqlBackupArtefactsFlowState, ts),
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s); err != nil {
			return "", fmt.Errorf("devtools: flow backup (%s): %w", ts, err)
		}
	}
	return ts, nil
}

// flowBackupTableNames returns the names of the backup tables created by
// backupFlowTables for a given suffix, so the response can name the restore set.
func flowBackupTableNames(ts string) []string {
	return []string{
		"flows_bak_" + ts,
		"flows_states_bak_" + ts,
		"flows_transitions_bak_" + ts,
		"flows_defaults_bak_" + ts,
		"flows_states_defaults_bak_" + ts,
		"flows_transitions_defaults_bak_" + ts,
		"artefacts_flowstate_bak_" + ts,
	}
}

// backupFixtureCleanupTables snapshots the full artefacts + artefacts_types
// tables plus the six flow tables before a fixture cleanup, returning the suffix.
func backupFixtureCleanupTables(ctx context.Context, tx pgx.Tx) (string, error) {
	ts := backupSuffix()
	stmts := []string{
		fmt.Sprintf(sqlBackupArtefactsFull, ts),
		fmt.Sprintf(sqlBackupArtefactsTypes, ts),
		fmt.Sprintf(sqlBackupFlows, ts),
		fmt.Sprintf(sqlBackupFlowsStates, ts),
		fmt.Sprintf(sqlBackupFlowsTransitions, ts),
		fmt.Sprintf(sqlBackupFlowsDefaults, ts),
		fmt.Sprintf(sqlBackupFlowsStatesDefaults, ts),
		fmt.Sprintf(sqlBackupFlowsTransitionsDefaults, ts),
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s); err != nil {
			return "", fmt.Errorf("devtools: fixture-cleanup backup (%s): %w", ts, err)
		}
	}
	return ts, nil
}

// fixtureCleanupBackupTableNames returns the names of the backup tables created
// by backupFixtureCleanupTables for a given suffix.
func fixtureCleanupBackupTableNames(ts string) []string {
	return []string{
		"artefacts_bak_" + ts,
		"artefacts_types_bak_" + ts,
		"flows_bak_" + ts,
		"flows_states_bak_" + ts,
		"flows_transitions_bak_" + ts,
		"flows_defaults_bak_" + ts,
		"flows_states_defaults_bak_" + ts,
		"flows_transitions_defaults_bak_" + ts,
	}
}
