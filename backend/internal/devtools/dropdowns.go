package devtools

// dropdowns.go — read-only query helpers that feed the cascading UI dropdowns
// on the Dev Setup page (Subscription → Workspace → Topology Node → Artefact
// Type). Each helper is a single SELECT with one WHERE filter; the SQL literals
// live in sql.go (sql-in-sqlfile-only lint). Operates directly on a
// *pgxpool.Pool — these are reads with no transaction semantics, so the caller
// passes the pool rather than a Tx.
//
// Every level below subscriptions is live-only (archived_at IS NULL) and scoped
// to its parent's id, mirroring the top-down cascade the Scope resolver
// (scope.go) consumes. The returned Option is a flat {id, name} the frontend
// renders as <option> rows.

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Option is one selectable row in a cascading dropdown.
type Option struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// scanOptions runs a query that yields (id, name) rows and collects them into a
// []Option. All four list helpers share this shape, so the row loop lives once.
func scanOptions(ctx context.Context, pool *pgxpool.Pool, query string, args ...any) ([]Option, error) {
	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("devtools: query options: %w", err)
	}
	defer rows.Close()

	var out []Option
	for rows.Next() {
		var o Option
		if err := rows.Scan(&o.ID, &o.Name); err != nil {
			return nil, fmt.Errorf("devtools: scan option row: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("devtools: iterate option rows: %w", err)
	}
	return out, nil
}

// ListSubscriptions returns every subscription, ordered by name. This is the
// top level of the cascade and is unfiltered.
func ListSubscriptions(ctx context.Context, pool *pgxpool.Pool) ([]Option, error) {
	return scanOptions(ctx, pool, sqlListSubscriptions)
}

// ListWorkspaces returns the live workspaces of one subscription, ordered by
// name.
func ListWorkspaces(ctx context.Context, pool *pgxpool.Pool, subscriptionID uuid.UUID) ([]Option, error) {
	return scanOptions(ctx, pool, sqlListWorkspaces, subscriptionID)
}

// ListTopologyNodes returns the live topology nodes of one workspace, ordered
// by name.
func ListTopologyNodes(ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) ([]Option, error) {
	return scanOptions(ctx, pool, sqlListTopologyNodes, workspaceID)
}

// ListArtefactTypes returns the live artefact types of one workspace, ordered
// by name.
func ListArtefactTypes(ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) ([]Option, error) {
	return scanOptions(ctx, pool, sqlListArtefactTypes, workspaceID)
}
