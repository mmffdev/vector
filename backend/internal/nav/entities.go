package nav

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// EntityRow is the wire shape for /api/nav/entities. Tiny on purpose:
// only the fields needed to render a "Pin" UI on a list of entities.
type EntityRow struct {
	Kind EntityKind `json:"kind"`
	ID   uuid.UUID  `json:"id"`
	Name string     `json:"name"`
}

// EntitiesService lists portfolios and products in a tenant. Lives in
// the nav package only because the nav UI is currently the sole consumer;
// once a real entities/portfolio package exists this should move there.
type EntitiesService struct {
	Pool *pgxpool.Pool
}

func NewEntitiesService(pool *pgxpool.Pool) *EntitiesService {
	return &EntitiesService{Pool: pool}
}

// ListInTenant returns active (non-archived) portfolios and products
// for the tenant, sorted by kind then name. No paging — the demo data
// volume is tiny; revisit when we cross a few hundred rows.
func (s *EntitiesService) ListInTenant(ctx context.Context, tenantID uuid.UUID) ([]EntityRow, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT 'portfolio' AS kind, id, name FROM portfolio
		 WHERE tenant_id = $1 AND archived_at IS NULL
		UNION ALL
		SELECT 'product' AS kind, id, name FROM product
		 WHERE tenant_id = $1 AND archived_at IS NULL
		ORDER BY kind, name`, tenantID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return []EntityRow{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := make([]EntityRow, 0, 8)
	for rows.Next() {
		var e EntityRow
		var kind string
		if err := rows.Scan(&kind, &e.ID, &e.Name); err != nil {
			return nil, err
		}
		e.Kind = EntityKind(kind)
		out = append(out, e)
	}
	return out, rows.Err()
}

// EntitiesHandler exposes ListInTenant over HTTP. Wired by main.go.
type EntitiesHandler struct{ Svc *EntitiesService }

func NewEntitiesHandler(s *EntitiesService) *EntitiesHandler { return &EntitiesHandler{Svc: s} }

type entitiesResp struct {
	Entities []EntityRow `json:"entities"`
}

// GET /api/nav/entities — portfolios + products in caller's tenant.
func (h *EntitiesHandler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	rows, err := h.Svc.ListInTenant(r.Context(), u.TenantID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(entitiesResp{Entities: rows})
}
