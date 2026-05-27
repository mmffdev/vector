package broadcast

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// BroadcastRequest describes a broadcast event to be fired.
// The Service validates mode-specific fields before auth/resolve.
type BroadcastRequest struct {
	// SentByUserID is the human actor who composed the broadcast.
	// Set to uuid.Nil when sent_by_system=true.
	SentByUserID uuid.UUID
	// SentBySystem flags system-originated broadcasts (SentByUserID must be zero).
	SentBySystem bool
	// EventType in <domain>.<action> form.
	EventType domain.EventType
	// Priority for this broadcast event.
	Priority domain.Priority
	// Data is the payload merged into the event row.
	Data map[string]any
	// Mode determines the fan-out scope. One of the five broadcast modes
	// (workspace, topology_node, topology_subtree, tenant, platform).
	Mode domain.FanoutMode
	// SubscriptionID — required for all modes except FanoutPlatform.
	SubscriptionID *uuid.UUID
	// WorkspaceID — required for FanoutWorkspace mode.
	WorkspaceID *uuid.UUID
	// TopologyNodeID — required for topology_node and topology_subtree modes.
	TopologyNodeID *uuid.UUID
	// TenantID is the subscription UUID used for auth checks (sentinel.GrantOnNode).
	// Matches SubscriptionID for all non-platform modes; uuid.Nil for platform.
	TenantID uuid.UUID
	// ActorRoleID is the actor's role UUID passed to GrantOnNode for the gadmin
	// short-circuit. Set from the sentinel Clamp at the handler boundary (S11).
	ActorRoleID uuid.UUID
	// EventKey is the producer-supplied idempotency key. Required; non-empty.
	EventKey string
	// DryRun — when true, auth + resolve happen but no DB writes occur.
	// BroadcastResult.EventID will be uuid.Nil.
	DryRun bool
}

// BroadcastResult is returned by Service.Broadcast.
type BroadcastResult struct {
	// EventID is the PK of the written notifications_events_v2 row.
	// uuid.Nil when DryRun=true.
	EventID uuid.UUID
	// RecipientCount is the number of resolved recipients.
	// Populated for both live and dry-run calls.
	RecipientCount int
}

// Service is the entry point for broadcast events. Callers are S11
// broadcast handlers (and in tests, any code with a *pgxpool.Pool).
//
// Responsibilities:
//  1. Auth check (mode-appropriate)
//  2. Recipient resolution via Resolver (inverse-Sentinel)
//  3. Atomic DB write: events_v2 row + N event_recipients rows
//
// S03 does NOT go through Producer — broadcasts write directly to
// notifications_events_v2 because they have a different fan-out shape
// (no id_recipient_user on the event row itself; N recipient rows instead).
type Service interface {
	// Broadcast fires the event. Returns the written event ID and resolved
	// recipient count. If req.DryRun, returns count only (no DB write).
	Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastResult, error)

	// PreviewRecipientCount performs auth + resolve only. Returns the
	// count of users who would receive the broadcast. No DB writes.
	PreviewRecipientCount(ctx context.Context, req BroadcastRequest) (int, error)
}

// service is the production implementation of Service.
type service struct {
	pool     *pgxpool.Pool
	resolver Resolver
	roles    RoleChecker
	grants   GrantChecker
}

// NewService constructs a Service wired to the given pool, resolver and
// auth checkers. The pool must target vector_artefacts.
//
// roles and grants are injected so tests can stub auth without a real DB.
func NewService(pool *pgxpool.Pool, resolver Resolver, roles RoleChecker, grants GrantChecker) Service {
	return &service{
		pool:     pool,
		resolver: resolver,
		roles:    roles,
		grants:   grants,
	}
}

// Broadcast implements Service.Broadcast.
func (s *service) Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastResult, error) {
	if err := validateRequest(req); err != nil {
		return BroadcastResult{}, fmt.Errorf("broadcast: invalid request: %w", err)
	}

	// 1. Auth check
	if err := s.checkAuth(ctx, req); err != nil {
		return BroadcastResult{}, err
	}

	// 2. Resolve recipients
	users, err := s.resolve(ctx, req)
	if err != nil {
		return BroadcastResult{}, fmt.Errorf("broadcast: resolve recipients: %w", err)
	}

	if req.DryRun {
		return BroadcastResult{RecipientCount: len(users)}, nil
	}

	// 3. Write event + recipients atomically
	eventID, err := s.writeAtomic(ctx, req, users)
	if err != nil {
		return BroadcastResult{}, fmt.Errorf("broadcast: write: %w", err)
	}

	return BroadcastResult{
		EventID:        eventID,
		RecipientCount: len(users),
	}, nil
}

// PreviewRecipientCount implements Service.PreviewRecipientCount.
func (s *service) PreviewRecipientCount(ctx context.Context, req BroadcastRequest) (int, error) {
	if err := validateRequest(req); err != nil {
		return 0, fmt.Errorf("broadcast: invalid request: %w", err)
	}

	if err := s.checkAuth(ctx, req); err != nil {
		return 0, err
	}

	users, err := s.resolve(ctx, req)
	if err != nil {
		return 0, fmt.Errorf("broadcast: resolve recipients: %w", err)
	}

	return len(users), nil
}

// checkAuth routes to the correct auth function based on the fan-out mode.
func (s *service) checkAuth(ctx context.Context, req BroadcastRequest) error {
	actorID := req.SentByUserID
	if req.SentBySystem {
		// System-originated broadcasts skip role checks.
		return nil
	}

	switch req.Mode {
	case domain.FanoutPlatform:
		return CheckPlatformAuth(ctx, actorID, s.roles)

	case domain.FanoutTopologyNode, domain.FanoutTopologySubtree:
		if req.TopologyNodeID == nil {
			return fmt.Errorf("broadcast: topology mode requires TopologyNodeID")
		}
		return CheckTopologyAuth(ctx, actorID, *req.TopologyNodeID, req.TenantID, req.ActorRoleID, s.roles, s.grants)

	case domain.FanoutWorkspace:
		if req.WorkspaceID == nil {
			return fmt.Errorf("broadcast: workspace mode requires WorkspaceID")
		}
		// Workspace broadcast uses topology auth (pAdmin+ownership).
		// The handler (S11) provides the workspace root node; for S03
		// we use WorkspaceID as a proxy — S11 will provide the real root.
		// Auth is conservative: if the actor can't do topology auth at all
		// (not pAdmin/gadmin), reject.
		return CheckTopologyAuth(ctx, actorID, *req.WorkspaceID, req.TenantID, req.ActorRoleID, s.roles, s.grants)

	case domain.FanoutTenant:
		if req.SubscriptionID == nil {
			return fmt.Errorf("broadcast: tenant mode requires SubscriptionID")
		}
		return CheckTenantAuth(ctx, actorID, *req.SubscriptionID, s.roles)

	default:
		return fmt.Errorf("broadcast: unsupported fan-out mode: %s", req.Mode)
	}
}

// resolve routes to the correct Resolver method based on the fan-out mode.
func (s *service) resolve(ctx context.Context, req BroadcastRequest) ([]uuid.UUID, error) {
	switch req.Mode {
	case domain.FanoutTopologyNode:
		return s.resolver.UsersForTopologyNode(ctx, *req.TopologyNodeID, false)
	case domain.FanoutTopologySubtree:
		return s.resolver.UsersForTopologyNode(ctx, *req.TopologyNodeID, true)
	case domain.FanoutWorkspace:
		return s.resolver.UsersForWorkspace(ctx, *req.WorkspaceID)
	case domain.FanoutTenant:
		return s.resolver.UsersForSubscription(ctx, *req.SubscriptionID)
	case domain.FanoutPlatform:
		return s.resolver.UsersForPlatform(ctx)
	default:
		return nil, fmt.Errorf("broadcast: unsupported mode for resolve: %s", req.Mode)
	}
}

// writeAtomic writes the event row + N recipient rows in a single transaction.
// Returns the new event UUID. The recipient slice is sorted before INSERT
// for deterministic ordering.
func (s *service) writeAtomic(ctx context.Context, req BroadcastRequest, users []uuid.UUID) (uuid.UUID, error) {
	// Sort users for deterministic INSERT order (property pinned by tests).
	sortedUsers := make([]uuid.UUID, len(users))
	copy(sortedUsers, users)
	sort.Slice(sortedUsers, func(i, j int) bool {
		return sortedUsers[i].String() < sortedUsers[j].String()
	})

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck — rollback on early return

	// Build the event INSERT
	now := time.Now().UTC()
	count := len(sortedUsers)
	eventID := uuid.New()

	var (
		sentByUserID    *uuid.UUID
		subscriptionID  *uuid.UUID
		workspaceID     *uuid.UUID
		topologyNodeID  *uuid.UUID
	)

	if !req.SentBySystem && req.SentByUserID != uuid.Nil {
		u := req.SentByUserID
		sentByUserID = &u
	}
	subscriptionID = req.SubscriptionID
	workspaceID = req.WorkspaceID
	topologyNodeID = req.TopologyNodeID

	dataJSON := req.Data
	if dataJSON == nil {
		dataJSON = map[string]any{}
	}

	_, err = tx.Exec(ctx, sqlInsertEvent,
		eventID,
		req.EventKey,
		req.EventType.String(),
		string(req.Priority),
		string(req.Mode),
		subscriptionID,
		workspaceID,
		topologyNodeID,
		sentByUserID,
		req.SentBySystem,
		dataJSON,
		count,
		now, // resolved_at = now() — snapshot complete at fire time (decision #12)
	)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert event: %w", err)
	}

	// resolvedReason maps the fanout mode to the string stored per recipient row.
	resolvedReason := modeToResolvedReason(req.Mode)

	// INSERT N recipient rows — one per user.
	for _, userID := range sortedUsers {
		_, err = tx.Exec(ctx, sqlInsertRecipient,
			uuid.New(),
			eventID,
			userID,
			now,
			resolvedReason,
		)
		if err != nil {
			return uuid.Nil, fmt.Errorf("insert recipient (user=%s): %w", userID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, fmt.Errorf("commit: %w", err)
	}

	return eventID, nil
}

// modeToResolvedReason maps the fanout mode to the
// notifications_event_recipients_resolved_reason value.
// These values match the spec's "resolved_reason" description.
func modeToResolvedReason(mode domain.FanoutMode) string {
	switch mode {
	case domain.FanoutTopologyNode:
		return "topology_node"
	case domain.FanoutTopologySubtree:
		return "topology_subtree"
	case domain.FanoutWorkspace:
		return "workspace_clamp"
	case domain.FanoutTenant:
		return "tenant_member"
	case domain.FanoutPlatform:
		return "platform_member"
	default:
		return string(mode)
	}
}

// validateRequest performs mode-specific structural validation before any
// DB or auth calls. Mirrors the CHECK constraints on notifications_events_v2.
func validateRequest(req BroadcastRequest) error {
	if req.EventKey == "" {
		return fmt.Errorf("event_key must not be empty")
	}

	switch req.Mode {
	case domain.FanoutWorkspace:
		if req.WorkspaceID == nil {
			return fmt.Errorf("workspace mode requires WorkspaceID")
		}
		if req.SubscriptionID == nil {
			return fmt.Errorf("workspace mode requires SubscriptionID")
		}
	case domain.FanoutTopologyNode, domain.FanoutTopologySubtree:
		if req.TopologyNodeID == nil {
			return fmt.Errorf("topology mode requires TopologyNodeID")
		}
		if req.SubscriptionID == nil {
			return fmt.Errorf("topology mode requires SubscriptionID")
		}
	case domain.FanoutTenant:
		if req.SubscriptionID == nil {
			return fmt.Errorf("tenant mode requires SubscriptionID")
		}
	case domain.FanoutPlatform:
		if req.SubscriptionID != nil {
			return fmt.Errorf("platform mode must not have SubscriptionID (decision #2)")
		}
	case domain.FanoutDirect:
		return fmt.Errorf("broadcast.Service does not handle direct mode; use Producer")
	default:
		return fmt.Errorf("unknown fanout mode: %s", req.Mode)
	}

	switch req.Priority {
	case domain.PriorityLow, domain.PriorityMedium, domain.PriorityHigh, domain.PriorityCritical:
		// valid
	default:
		return fmt.Errorf("invalid priority: %s", req.Priority)
	}

	if req.SentBySystem && req.SentByUserID != uuid.Nil {
		return fmt.Errorf("sent_by_system=true requires SentByUserID to be zero")
	}

	return nil
}

// ---- SQL ----

// sqlInsertEvent writes one row to notifications_events_v2.
// resolved_at is set immediately — broadcast recipients are resolved
// synchronously at fire time (spec locked decision #12).
//
// $1  notifications_events_v2_id
// $2  notifications_events_v2_event_key
// $3  notifications_events_v2_type
// $4  notifications_events_v2_priority
// $5  notifications_events_v2_fanout_mode
// $6  notifications_events_v2_id_subscription
// $7  notifications_events_v2_id_workspace
// $8  notifications_events_v2_id_topology_node
// $9  notifications_events_v2_id_sent_by_user
// $10 notifications_events_v2_sent_by_system
// $11 notifications_events_v2_data
// $12 notifications_events_v2_recipient_count
// $13 notifications_events_v2_resolved_at
const sqlInsertEvent = `
	INSERT INTO notifications_events_v2 (
		notifications_events_v2_id,
		notifications_events_v2_event_key,
		notifications_events_v2_type,
		notifications_events_v2_priority,
		notifications_events_v2_fanout_mode,
		notifications_events_v2_id_subscription,
		notifications_events_v2_id_workspace,
		notifications_events_v2_id_topology_node,
		notifications_events_v2_id_sent_by_user,
		notifications_events_v2_sent_by_system,
		notifications_events_v2_data,
		notifications_events_v2_recipient_count,
		notifications_events_v2_resolved_at
	) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`

// sqlInsertRecipient writes one row to notifications_event_recipients.
//
// $1 notifications_event_recipients_id
// $2 notifications_event_recipients_id_event
// $3 notifications_event_recipients_id_user
// $4 notifications_event_recipients_resolved_at
// $5 notifications_event_recipients_resolved_reason
const sqlInsertRecipient = `
	INSERT INTO notifications_event_recipients (
		notifications_event_recipients_id,
		notifications_event_recipients_id_event,
		notifications_event_recipients_id_user,
		notifications_event_recipients_resolved_at,
		notifications_event_recipients_resolved_reason
	) VALUES ($1, $2, $3, $4, $5)
`
