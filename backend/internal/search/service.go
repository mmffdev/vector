// Package search exposes the POST /search query endpoint backed by the
// vector_artefacts fulltext (tsvector) and semantic (pgvector) columns.
package search

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultLimit = 20
const maxLimit = 100

// Result is one search hit returned to the caller.
type Result struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	// Public identifier, e.g. "US-42". Empty when the type has no prefix.
	PublicID    string  `json:"public_id,omitempty"`
	TypeName    string  `json:"type_name"`
	TypePrefix  string  `json:"type_prefix"`
	WorkspaceID string  `json:"workspace_id"`
	FlowStateID *string `json:"flow_state_id,omitempty"`
	Rank        float64 `json:"rank"`
}

// Query holds the parameters for a search request.
type Query struct {
	Q           string
	WorkspaceID string
	// TypeIDs restricts results to specific artefact type UUIDs (optional).
	TypeIDs []string
	Limit   int
}

// Service runs search queries against vector_artefacts.
type Service struct {
	pool *pgxpool.Pool
}

// New creates a Service backed by the given vector_artefacts pool.
func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Search runs a fulltext query. Results are ranked by ts_rank.
// Returns an empty slice (never nil) when nothing matches.
func (s *Service) Search(ctx context.Context, q Query) ([]Result, error) {
	if strings.TrimSpace(q.Q) == "" {
		return []Result{}, nil
	}
	limit := q.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}

	args := []any{q.Q, q.WorkspaceID, limit}
	n := 4

	typeFilter := ""
	if len(q.TypeIDs) > 0 {
		placeholders := make([]string, len(q.TypeIDs))
		for i, id := range q.TypeIDs {
			placeholders[i] = fmt.Sprintf("$%d", n)
			args = append(args, id)
			n++
		}
		typeFilter = fmt.Sprintf("AND a.artefact_type_id IN (%s)", strings.Join(placeholders, ","))
	}

	sql := fmt.Sprintf(`
		SELECT
			a.id,
			a.title,
			a.description,
			CASE WHEN at.artefacts_types_prefix <> '' THEN at.artefacts_types_prefix || '-' || a.number::text ELSE '' END AS public_id,
			at.artefacts_types_name   AS type_name,
			at.artefacts_types_prefix AS type_prefix,
			a.workspace_id::text,
			a.flow_state_id::text,
			ts_rank(a.search_index, plainto_tsquery('english', $1)) AS rank
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		WHERE a.workspace_id = $2::uuid
		  AND a.archived_at IS NULL
		  AND a.search_index @@ plainto_tsquery('english', $1)
		  %s
		ORDER BY rank DESC
		LIMIT $3`, typeFilter)

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()

	results := []Result{}
	for rows.Next() {
		var r Result
		if err := rows.Scan(
			&r.ID, &r.Title, &r.Description,
			&r.PublicID, &r.TypeName, &r.TypePrefix,
			&r.WorkspaceID, &r.FlowStateID, &r.Rank,
		); err != nil {
			return nil, fmt.Errorf("scan search row: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}
