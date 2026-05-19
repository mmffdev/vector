package librarydb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBundleNotFound is returned when no template row exists for the
// requested id. Post-R010 the library has a single substrate
// (portfolio_templates) — the legacy portfolio_models* family of tables
// was dropped, and with them the FetchByModelID / FetchLatestByFamily
// code paths (deleted 2026-05-19 / TD-LIB-010 closure).
var ErrBundleNotFound = errors.New("librarydb: bundle not found")

// FetchTemplateByID loads a portfolio_templates row and returns it as a
// Bundle so the adoption saga can consume it without knowing the source
// table changed. Workflows / Transitions / Artifacts / Terminology are
// empty — templates don't define them; the saga steps will be no-ops.
// Layer descriptions are resolved from portfolio_template_layer_definitions first;
// the JSONB layer description is used only as a fallback.
func FetchTemplateByID(ctx context.Context, pool *pgxpool.Pool, templateID uuid.UUID) (*Bundle, error) {
	tagDefs, err := loadTagDefinitions(ctx, pool)
	if err != nil {
		return nil, err
	}

	var (
		name      string
		desc      *string
		layersRaw []byte
	)
	err = pool.QueryRow(ctx, sqlSelectTemplateByID, templateID).
		Scan(&name, &desc, &layersRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrBundleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("librarydb: fetch template: %w", err)
	}

	var tLayers []TemplateLayer
	if err := json.Unmarshal(layersRaw, &tLayers); err != nil { //nolint:musttag
		return nil, fmt.Errorf("librarydb: unmarshal template layers: %w", err)
	}

	n := len(tLayers)
	layers := make([]Layer, n)
	for i, tl := range tLayers {
		isLeaf := i == n-1
		layerDesc := tagDefs[tl.Tag]
		if layerDesc == nil {
			layerDesc = tl.Description
		}
		layers[i] = Layer{
			ID:             uuid.New(),
			ModelID:        templateID,
			Name:           tl.Name,
			Tag:            tl.Tag,
			SortOrder:      int32((n-1-i) * 10), //nolint:gosec
			AllowsChildren: !isLeaf,
			IsLeaf:         isLeaf,
			DescriptionMD:  layerDesc,
		}
	}

	return &Bundle{
		Model: Model{
			ID:          templateID,
			Name:        name,
			Description: desc,
			Version:     1,
			Scope:       "system",
		},
		Layers:      layers,
		Workflows:   nil,
		Transitions: nil,
		Artifacts:   nil,
		Terminology: nil,
	}, nil
}

// loadTagDefinitions fetches all rows from portfolio_template_layer_definitions and returns
// a map of tag → *description for use during template synthesis.
func loadTagDefinitions(ctx context.Context, pool *pgxpool.Pool) (map[string]*string, error) {
	rows, err := pool.Query(ctx, sqlListTagDefinitions)
	if err != nil {
		return nil, fmt.Errorf("librarydb: load tag definitions: %w", err)
	}
	defer rows.Close()

	out := make(map[string]*string)
	for rows.Next() {
		var tag, desc string
		if err := rows.Scan(&tag, &desc); err != nil {
			return nil, fmt.Errorf("librarydb: scan tag definition: %w", err)
		}
		d := desc
		out[tag] = &d
	}
	return out, rows.Err()
}
