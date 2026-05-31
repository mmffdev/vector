package vectorfields

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ vaPool *pgxpool.Pool }

func NewService(vaPool *pgxpool.Pool) *Service { return &Service{vaPool: vaPool} }

// ContextForType returns the CUSTOM field entries bound to (tenant, kind,
// typeID) — including universal (NULL-type) bindings. Core entries are added
// by the caller (formlayouts) from columns.go until core seeding lands.
func (s *Service) ContextForType(
	ctx context.Context, tenantID uuid.UUID, kind string, typeID uuid.UUID,
) ([]FieldEntry, error) {
	rows, err := s.vaPool.Query(ctx, sqlContextForType, tenantID, kind, typeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FieldEntry
	for rows.Next() {
		var id, name, label, dtype string
		var required, compulsory bool
		var position int
		if err := rows.Scan(&id, &name, &label, &dtype, &required, &compulsory, &position); err != nil {
			return nil, err
		}
		out = append(out, FieldEntry{
			FieldKey:      "custom:" + id,
			Label:         label,
			DataType:      dtype,
			Kind:          "custom",
			Required:      required,
			IsCompulsory:  compulsory,
			Position:      position,
			ValueLocation: "eav",
		})
	}
	return out, rows.Err()
}
