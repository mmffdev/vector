package audit

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/transport"
)

type Logger struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

// SetPool atomically swaps the underlying pool. Used during startup to repoint
// the early-bound Logger at vaPool once it is initialised, without re-threading
// the reference through every service constructor.
func (l *Logger) SetPool(p *pgxpool.Pool) { l.pool = p }

type Entry struct {
	UserID         *uuid.UUID
	SubscriptionID *uuid.UUID
	Action         string
	Resource       *string
	ResourceID     *string
	Metadata       map[string]any
	IPAddress      *string
}

func (l *Logger) Log(ctx context.Context, e Entry) {
	var meta []byte
	if e.Metadata != nil {
		meta, _ = json.Marshal(e.Metadata)
	}
	// source_transport is derived from context when available (PLA-0039).
	// Legacy callers (pre-transport-tagging) leave it NULL.
	var src *string
	if t, ok := transport.FromContext(ctx); ok {
		s := t.String()
		src = &s
	}
	_, _ = l.pool.Exec(ctx, `
		INSERT INTO audit_log (user_id, subscription_id, action, resource, resource_id, metadata, ip_address, source_transport)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		e.UserID, e.SubscriptionID, e.Action, e.Resource, e.ResourceID, meta, e.IPAddress, src,
	)
}
