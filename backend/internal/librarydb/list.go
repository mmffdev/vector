package librarydb

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TemplateLayer is one entry in a portfolio template's layer stack.
// Index 0 = top tier (strategy), last = leaf (feature/execution).
type TemplateLayer struct {
	Tag  string `json:"tag"`
	Name string `json:"name"`
}

// ModelSummary is the slim row returned by ListPublishedModels.
type ModelSummary struct {
	ID          uuid.UUID
	Name        string
	Description *string
	Layers      []TemplateLayer
}

// ListPublishedModels returns all rows from portfolio_templates, ordered
// with Vector Standard first then alphabetically.
func ListPublishedModels(ctx context.Context, pool *pgxpool.Pool) ([]ModelSummary, error) {
	const q = `
		SELECT id, name, description, layers
		FROM portfolio_templates
		ORDER BY CASE WHEN id = '00000000-0000-0000-0000-00000000aa01' THEN 0 ELSE 1 END,
			name`

	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("librarydb: list published models: %w", err)
	}
	defer rows.Close()

	var out []ModelSummary
	for rows.Next() {
		var s ModelSummary
		var layersRaw []byte
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &layersRaw); err != nil {
			return nil, fmt.Errorf("librarydb: scan model summary: %w", err)
		}
		if err := json.Unmarshal(layersRaw, &s.Layers); err != nil { //nolint:musttag
			return nil, fmt.Errorf("librarydb: unmarshal layers for %s: %w", s.ID, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("librarydb: iter model summaries: %w", err)
	}
	return out, nil
}
