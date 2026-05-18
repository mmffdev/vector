package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/transport"
)

// Alerter is the small interface audit.Logger needs to fan an action
// out to an external alerter (B16.8 P5). A nil Alerter (or unset
// field) means "no fan-out" — the SQL INSERT stays the only side
// effect, preserving zero-config behaviour. The concrete implementation
// lives in `internal/alerting`; audit imports nothing from it (kept
// one-way so the package graph stays acyclic).
type Alerter interface {
	SendIfAllowed(action string, e AlertEvent)
}

// AlertEvent is the audit fields the Alerter receives. Mirrors the
// shape of Entry but uses plain types (no pgx) so the alerting
// package never has to import internal/audit's transitive deps.
type AlertEvent struct {
	Event          string
	Timestamp      string
	Action         string
	UserID         *uuid.UUID
	SubscriptionID *uuid.UUID
	IPAddress      *string
	Metadata       map[string]any
}

type Logger struct {
	pool    *pgxpool.Pool
	alerter Alerter
}

func New(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

// SetAlerter attaches a fan-out target. Pass nil to detach. Safe to
// call at startup before any Log fires. Not safe to mutate
// concurrently with Log (we don't need that today; revisit if hot-
// swappable alerting ever becomes a requirement).
func (l *Logger) SetAlerter(a Alerter) { l.alerter = a }

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
		INSERT INTO audit_logs (
			audit_logs_id_user, audit_logs_id_subscription,
			audit_logs_action, audit_logs_resource, audit_logs_resource_id,
			audit_logs_metadata, audit_logs_ip_address, audit_logs_source_transport
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		e.UserID, e.SubscriptionID, e.Action, e.Resource, e.ResourceID, meta, e.IPAddress, src,
	)
	// B16.8 P5 — fan selected actions out to the configured alerter.
	// SendIfAllowed is itself a no-op when the action isn't on the
	// allowlist; it dispatches its HTTP POST on a separate goroutine
	// so a slow webhook never blocks the request that triggered the
	// audit row.
	if l.alerter != nil {
		l.alerter.SendIfAllowed(e.Action, AlertEvent{
			Event:          "audit.alert",
			Timestamp:      time.Now().UTC().Format(time.RFC3339Nano),
			Action:         e.Action,
			UserID:         e.UserID,
			SubscriptionID: e.SubscriptionID,
			IPAddress:      e.IPAddress,
			Metadata:       e.Metadata,
		})
	}
}
