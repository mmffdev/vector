package workspaces

// PLA-0026 / story 00502 (B13). Cross-DB orphan-row guard for the
// workspace-deletion code path.
//
// Background. Postgres cannot enforce a foreign key across two
// databases on the same cluster. Every row in vector_artefacts that
// carries `workspace_id` is therefore an APP-ENFORCED soft FK back to
// `mmff_vector.workspaces.id` — the database does NOT cascade-delete
// or RESTRICT-block when the workspace row goes away. Per R047 §12.1
// the deletion handler must scan vector_artefacts BEFORE touching the
// workspaces row and refuse with 409 Conflict if any reference exists.
//
// This file lives in the workspaces package because it is consulted
// EXCLUSIVELY by the workspace-delete code path; it is not a generic
// cross-DB referential-integrity scanner. It is read-only by design:
// no INSERT/UPDATE/DELETE against vector_artefacts is issued here, so
// the writer-boundary lint in dev/scripts/lint_writer_boundary.py
// stays happy.
//
// The set of tables to scan mirrors the canary test in
// internal/portfoliomodels/cross_db_canary_test.go (verified live
// 2026-05-07 against vector_artefacts):
//
//	artefacts_types              — has archived_at, scan live rows only
//	workspaces_fields   — admit-row, lifetime = workspace
//	artefacts                   — has archived_at, scan live rows only
//	master_record_portfolios     — PK = workspace_id, lifetime = workspace
//	sprints                     — has archived_at, scan live rows only
//
// For tables with archived_at, we scan only live rows. Archived rows
// are tombstones — workspace deletion is allowed to leave dangling
// references from rows that the application has already retired. For
// PK-lifetime tables (master_record_portfolios, workspaces_fields)
// any row blocks deletion: their lifetime equals the workspace's by
// definition, so a live row IS a live reference.
//
// When VAPool is nil (no VECTOR_ARTEFACTS_DB_URL configured, or unit
// tests) the scan is a documented no-op: it returns an empty slice.
// In that mode the workspace-deletion code path is unguarded by
// definition — the operator opted out of the cutover DB and is
// responsible for any orphan management themselves.

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// OrphanReport is one row of CheckCrossDBOrphans's result. Table is
// the unqualified vector_artefacts table name (e.g. "artefacts_types"),
// Count is the number of LIVE rows in that table whose workspace_id
// equals the workspace under inspection. Tables with zero matching
// rows are omitted from the result slice.
type OrphanReport struct {
	Table string `json:"table"`
	Count int    `json:"count"`
}

// vaWorkspaceTables is the authoritative list of vector_artefacts
// tables whose workspace_id column references a mmff_vector.workspaces
// row. Mirror of vaCanaryTables in
// internal/portfoliomodels/cross_db_canary_test.go — keep the two
// lists in lockstep when a new VA table is added.
//
// hasArchivedAt = true means the scan filters out archived rows
// (archived rows are tombstones and do not block workspace deletion).
// PK-lifetime tables (admit-row + master_record_portfolios) have no
// archived_at column; any row blocks deletion.
var vaWorkspaceTables = []struct {
	name           string
	workspaceIDCol string // varies per table after RF1.4.2 column-prefix.
	archivedAtCol  string // empty when the table has no archived_at.
}{
	{"artefacts_types", "workspace_id", "archived_at"},
	{"workspaces_fields", "workspace_id", ""}, // admit-row; lifetime = workspace
	{"artefacts", "workspace_id", "archived_at"},
	{"master_record_portfolios", "master_record_portfolios_id_workspace", ""}, // PK = workspace; renamed by RF1.4.2.master_record
	{"timeboxes_sprints", "timeboxes_sprints_id_workspace", "timeboxes_sprints_archived_at"},
}

// CheckCrossDBOrphans scans every vector_artefacts table that carries
// workspace_id and reports the count of LIVE rows referencing
// workspaceID. The scan is read-only and idempotent.
//
// Returns a stable-ordered slice (vaWorkspaceTables order) of
// OrphanReport entries; tables with zero matches are omitted. An
// empty slice means "nothing references this workspace — deletion is
// safe from the cross-DB perspective".
//
// When s.VAPool is nil the method short-circuits with (nil, nil): the
// guard is disabled by definition (no cutover DB configured). The
// caller (Delete handler) is responsible for documenting that this
// makes the workspace-deletion path unguarded in that mode.
//
// Plumbing errors (pool acquire failure, query failure) propagate up
// untouched — the caller maps them to 500.
func (s *Service) CheckCrossDBOrphans(ctx context.Context, workspaceID uuid.UUID) ([]OrphanReport, error) {
	if s.VAPool == nil {
		// Guard disabled. Documented no-op — see file header.
		return nil, nil
	}

	out := make([]OrphanReport, 0, len(vaWorkspaceTables))
	for _, tbl := range vaWorkspaceTables {
		// Table name + workspace-id column name come from the hard-coded
		// allow-list above; never user input, so the %s interpolation is
		// safe. workspace_id value is parameterised through pgx.
		archivedClause := ""
		if tbl.archivedAtCol != "" {
			archivedClause = ` AND ` + tbl.archivedAtCol + ` IS NULL`
		}
		q := fmt.Sprintf(sqlCountOrphansForWorkspaceTemplate, tbl.name, tbl.workspaceIDCol, archivedClause)
		var n int
		if err := s.VAPool.QueryRow(ctx, q, workspaceID).Scan(&n); err != nil {
			return nil, fmt.Errorf("workspaces: cross-DB orphan scan on %s: %w", tbl.name, err)
		}
		if n > 0 {
			out = append(out, OrphanReport{Table: tbl.name, Count: n})
		}
	}
	return out, nil
}
