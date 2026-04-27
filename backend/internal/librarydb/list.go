package librarydb

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ModelSummary is the slim row returned by ListPublishedModels.
//
// Holds only the fields the padmin-facing list endpoint surfaces:
// the spine identity, display strings, and a comma-joined layer
// summary. Full bundle content (workflows, transitions, etc.) is
// served by FetchByModelID — this struct intentionally omits it
// so listing avoids the per-model 5-table fan-out.
type ModelSummary struct {
	ID            uuid.UUID
	Name          string
	Description   *string
	LayerSummary  string // comma-joined layer names in sort order; "" if no layers
	LayerCount    int32
	Version       int32
	ModelFamilyID uuid.UUID
}

// ListPublishedModels returns MMFF-published portfolio model bundles
// (scope='system', visibility='public', not archived) along with a
// short summary of each model's layers. Caller passes the RO pool.
//
// "MMFF-published" semantics — the AC for /api/portfolio-models —
// resolves to:
//   - scope = 'system'              (MMFF authors system bundles)
//   - visibility = 'public'         (entitlement gate; tenants may see)
//   - archived_at IS NULL           (live row only)
//
// Layer summary is a comma-joined list of layer names from
// portfolio_model_layers (also archived_at IS NULL), produced by a
// LEFT JOIN + GROUP BY so the result is always one row per model
// and we never N+1.
func ListPublishedModels(ctx context.Context, pool *pgxpool.Pool) ([]ModelSummary, error) {
	const q = `
		SELECT
			pm.id,
			pm.name,
			pm.description,
			COALESCE(string_agg(pml.name, ', ' ORDER BY pml.sort_order, pml.name)
				FILTER (WHERE pml.id IS NOT NULL), '') AS layer_summary,
			COUNT(pml.id)::int AS layer_count,
			pm.version,
			pm.model_family_id
		FROM portfolio_models pm
		LEFT JOIN portfolio_model_layers pml
			ON pml.model_id = pm.id
			AND pml.archived_at IS NULL
		WHERE pm.scope = 'system'
			AND pm.visibility = 'public'
			AND pm.archived_at IS NULL
		GROUP BY pm.id, pm.name, pm.description, pm.version, pm.model_family_id
		ORDER BY CASE WHEN pm.model_family_id = '00000000-0000-0000-0000-00000000a000' THEN 0 ELSE 1 END,
			pm.name, pm.version DESC`

	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("librarydb: list published models: %w", err)
	}
	defer rows.Close()

	var out []ModelSummary
	for rows.Next() {
		var s ModelSummary
		if err := rows.Scan(
			&s.ID,
			&s.Name,
			&s.Description,
			&s.LayerSummary,
			&s.LayerCount,
			&s.Version,
			&s.ModelFamilyID,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan model summary: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("librarydb: iter model summaries: %w", err)
	}
	return out, nil
}
