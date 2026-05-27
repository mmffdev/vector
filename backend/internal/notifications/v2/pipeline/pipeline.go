package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ProcessEvent implements Processor.
//
// Flow per event:
//  1. Load event row from notifications_events_v2.
//  2. Load all recipient rows from notifications_event_recipients.
//  3. Enrich event.Data with canonical metadata.
//  4. Build filter context (rules + platform channels) — once per event.
//  5. For each recipient:
//     a. Filter → []Decision
//     b. For each Decision: route (outbox / pending / suppression) in its own tx.
//  6. Return aggregate Result.
func (p *processorImpl) ProcessEvent(ctx context.Context, eventID uuid.UUID) (Result, error) {
	// ── Step 1: Load event ────────────────────────────────────────────────────
	event, err := loadEvent(ctx, p.deps.Pool, eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrEventNotFound
	}
	if err != nil {
		return Result{}, fmt.Errorf("ProcessEvent: loadEvent: %w", err)
	}

	// ── Step 2: Load recipients ───────────────────────────────────────────────
	recipients, err := loadRecipients(ctx, p.deps.Pool, eventID)
	if err != nil {
		return Result{}, fmt.Errorf("ProcessEvent: loadRecipients: %w", err)
	}
	if len(recipients) == 0 {
		return Result{}, ErrNoRecipients
	}

	// ── Step 3: Enrich event ──────────────────────────────────────────────────
	event = enrichEvent(event)

	// ── Step 4: Build filter context (once per event) ─────────────────────────
	fctx, err := buildFilterCtx(ctx, p.deps.Pool, p.deps.Rules, event)
	if err != nil {
		return Result{}, fmt.Errorf("ProcessEvent: buildFilterCtx: %w", err)
	}

	// ── Step 5: Process each recipient ────────────────────────────────────────
	var result Result
	result.RecipientsTotal = len(recipients)

	for _, r := range recipients {
		r := r // copy for safety
		decisions, ferr := filterRecipient(ctx, p.deps.Pool, event, r, fctx)
		if ferr != nil {
			slog.Error("pipeline: filterRecipient failed",
				"event_id", eventID,
				"recipient_user_id", r.UserID,
				"err", ferr,
			)
			result.Errors++
			continue
		}

		for _, d := range decisions {
			outbox, pending, suppressed, rerr := routeInTx(ctx, p.deps, event, r, d)
			if rerr != nil {
				slog.Error("pipeline: routeDecision failed",
					"event_id", eventID,
					"recipient_user_id", r.UserID,
					"channel", d.Channel,
					"action", d.Action,
					"err", rerr,
				)
				result.Errors++
				continue
			}
			if outbox {
				result.OutboxRowsWritten++
			}
			if pending {
				result.PendingEntriesPushed++
			}
			if suppressed {
				result.SuppressionsWritten++
			}
		}
	}

	return result, nil
}

// routeInTx wraps routeDecision in its own transaction so one recipient's
// failure does not corrupt another recipient's writes (Task 10.1).
func routeInTx(
	ctx context.Context,
	deps Deps,
	event domain.Event,
	recipient Recipient,
	d Decision,
) (outboxWritten, pendingPushed, suppressionWritten bool, err error) {
	tx, err := deps.Pool.Begin(ctx)
	if err != nil {
		return false, false, false, fmt.Errorf("routeInTx: begin: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	outbox, pending, suppressed, rerr := routeDecision(ctx, tx, event, recipient, d, deps.Templates, deps.Pending)
	if rerr != nil {
		return false, false, false, rerr
	}

	if cerr := tx.Commit(ctx); cerr != nil {
		return false, false, false, fmt.Errorf("routeInTx: commit: %w", cerr)
	}
	return outbox, pending, suppressed, nil
}

// ── Event loading ─────────────────────────────────────────────────────────────

// loadEvent reads one notifications_events_v2 row into a domain.Event.
// Returns pgx.ErrNoRows when the event does not exist.
func loadEvent(ctx context.Context, pool querier, eventID uuid.UUID) (domain.Event, error) {
	const q = `
		SELECT
			notifications_events_v2_id,
			notifications_events_v2_event_key,
			notifications_events_v2_type,
			notifications_events_v2_priority,
			notifications_events_v2_fanout_mode,
			notifications_events_v2_id_subscription,
			notifications_events_v2_id_workspace,
			notifications_events_v2_id_topology_node,
			notifications_events_v2_id_recipient_user,
			notifications_events_v2_id_sent_by_user,
			notifications_events_v2_sent_by_system,
			notifications_events_v2_data,
			notifications_events_v2_created_at
		FROM notifications_events_v2
		WHERE notifications_events_v2_id = $1
	`
	row := pool.QueryRow(ctx, q, eventID)
	return scanEvent(row)
}

// querier is a minimal interface satisfied by *pgxpool.Pool and pgx.Tx.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// scanEvent scans a notifications_events_v2 row into domain.Event.
func scanEvent(row pgx.Row) (domain.Event, error) {
	var (
		e             domain.Event
		eventTypeStr  string
		priorityStr   string
		fanoutModeStr string
		dataJSON      []byte
	)
	err := row.Scan(
		&e.ID,
		&e.EventKey,
		&eventTypeStr,
		&priorityStr,
		&fanoutModeStr,
		&e.SubscriptionID,
		&e.WorkspaceID,
		&e.TopologyNodeID,
		&e.RecipientUserID,
		&e.SentByUserID,
		&e.SentBySystem,
		&dataJSON,
		&e.CreatedAt,
	)
	if err != nil {
		return domain.Event{}, err
	}

	et, err := domain.ParseEventType(eventTypeStr)
	if err != nil {
		return domain.Event{}, fmt.Errorf("scanEvent: parse event type %q: %w", eventTypeStr, err)
	}
	e.Type = et
	e.Priority = domain.Priority(priorityStr)
	e.FanoutMode = domain.FanoutMode(fanoutModeStr)

	// Decode JSONB data into map.
	if len(dataJSON) > 0 && string(dataJSON) != "null" {
		if err := json.Unmarshal(dataJSON, &e.Data); err != nil {
			return domain.Event{}, fmt.Errorf("scanEvent: decode data: %w", err)
		}
	}
	if e.Data == nil {
		e.Data = make(map[string]any)
	}
	return e, nil
}

// ── Recipients loading ────────────────────────────────────────────────────────

// loadRecipients reads all notifications_event_recipients rows for eventID.
func loadRecipients(ctx context.Context, pool querier, eventID uuid.UUID) ([]Recipient, error) {
	const q = `
		SELECT
			notifications_event_recipients_id,
			notifications_event_recipients_id_event,
			notifications_event_recipients_id_user,
			notifications_event_recipients_resolved_reason
		FROM notifications_event_recipients
		WHERE notifications_event_recipients_id_event = $1
		ORDER BY notifications_event_recipients_resolved_at ASC
	`
	rows, err := pool.Query(ctx, q, eventID)
	if err != nil {
		return nil, fmt.Errorf("loadRecipients: %w", err)
	}
	defer rows.Close()

	var out []Recipient
	for rows.Next() {
		var r Recipient
		if err := rows.Scan(&r.ID, &r.EventID, &r.UserID, &r.ResolvedReason); err != nil {
			return nil, fmt.Errorf("loadRecipients: scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
