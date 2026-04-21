package audit

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Logger struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

type Entry struct {
	UserID     *uuid.UUID
	TenantID   *uuid.UUID
	Action     string
	Resource   *string
	ResourceID *string
	Metadata   map[string]any
	IPAddress  *string
}

func (l *Logger) Log(ctx context.Context, e Entry) {
	var meta []byte
	if e.Metadata != nil {
		meta, _ = json.Marshal(e.Metadata)
	}
	_, _ = l.pool.Exec(ctx, `
		INSERT INTO audit_log (user_id, tenant_id, action, resource, resource_id, metadata, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		e.UserID, e.TenantID, e.Action, e.Resource, e.ResourceID, meta, e.IPAddress,
	)
}
