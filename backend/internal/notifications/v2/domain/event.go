// Package domain contains the zero-dependency types for notifications v2.
// Every other v2 package imports from here; this package never imports
// from any other v2 package or from v1 notifications.
package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Priority is the urgency level of a notification event.
type Priority string

const (
	PriorityLow      Priority = "low"
	PriorityMedium   Priority = "medium"
	PriorityHigh     Priority = "high"
	PriorityCritical Priority = "critical"
)

// FanoutMode controls how the event is delivered to its recipients.
type FanoutMode string

const (
	// FanoutDirect targets a single user (RecipientUserID required).
	FanoutDirect FanoutMode = "direct"
	// FanoutWorkspace targets all users in a workspace.
	FanoutWorkspace FanoutMode = "workspace"
	// FanoutTopologyNode targets all users assigned to a topology node.
	FanoutTopologyNode FanoutMode = "topology_node"
	// FanoutTopologySubtree targets all users in a topology subtree.
	FanoutTopologySubtree FanoutMode = "topology_subtree"
	// FanoutTenant targets all users in a subscription (tenant).
	FanoutTenant FanoutMode = "tenant"
	// FanoutPlatform targets all users across the platform (gadmin broadcasts only).
	FanoutPlatform FanoutMode = "platform"
)

// Channel identifies the delivery transport.
type Channel string

const (
	ChannelInApp Channel = "in_app"
	ChannelSSE   Channel = "sse"
	ChannelEmail Channel = "email"
	ChannelPush  Channel = "push"
	ChannelSlack Channel = "slack"
	ChannelSMS   Channel = "sms"
)

// EventType represents a "<domain>.<action>" event name (locked decision #3).
// Both Domain and Action must be non-empty.
type EventType struct {
	Domain string
	Action string
}

// String returns the canonical "<domain>.<action>" form.
func (et EventType) String() string {
	return et.Domain + "." + et.Action
}

// ParseEventType parses a "<domain>.<action>" string into an EventType.
// Returns an error if the string is empty, has no dot, or has an empty
// domain or action component.
func ParseEventType(s string) (EventType, error) {
	if s == "" {
		return EventType{}, errors.New("event type must not be empty")
	}
	idx := strings.IndexByte(s, '.')
	if idx < 0 {
		return EventType{}, fmt.Errorf("event type %q missing dot separator (must be <domain>.<action>)", s)
	}
	domain := s[:idx]
	action := s[idx+1:]
	if domain == "" {
		return EventType{}, fmt.Errorf("event type %q has empty domain component", s)
	}
	if action == "" {
		return EventType{}, fmt.Errorf("event type %q has empty action component", s)
	}
	return EventType{Domain: domain, Action: action}, nil
}

// Event is the canonical input to producer.Producer.Enqueue / EnqueueTx.
//
// Pointer fields model optional scope (nil → NULL in the DB). The ID and
// CreatedAt fields are populated by the producer, never by callers.
//
// EventKey is the producer-supplied idempotency key. Re-enqueuing with the
// same (SubscriptionID, EventKey) returns the original event ID without
// inserting a duplicate row.
type Event struct {
	// ID is set by the producer; callers leave this as zero-value.
	ID uuid.UUID

	// CreatedAt is set by the producer; callers leave this as zero-value.
	CreatedAt time.Time

	// EventKey is the producer-supplied idempotency key (required).
	// Must be unique within a subscription.
	EventKey string

	// Type is the "<domain>.<action>" event name.
	Type EventType

	// Priority controls urgency; critical bypasses user prefs and quiet hours.
	Priority Priority

	// FanoutMode determines how recipients are resolved.
	FanoutMode FanoutMode

	// SubscriptionID scopes the event to a tenant. Required for all fanout
	// modes except FanoutPlatform (where it must be nil).
	SubscriptionID *uuid.UUID

	// WorkspaceID is optional context. Required for FanoutWorkspace in practice
	// (the broadcast service sets this). May be nil for direct events.
	WorkspaceID *uuid.UUID

	// TopologyNodeID is required for FanoutTopologyNode and FanoutTopologySubtree.
	TopologyNodeID *uuid.UUID

	// RecipientUserID is required for FanoutDirect.
	RecipientUserID *uuid.UUID

	// SentByUserID is the human author. Mutually exclusive with SentBySystem.
	SentByUserID *uuid.UUID

	// SentBySystem flags that the event was sent by an automated process.
	// When true, SentByUserID must be nil.
	SentBySystem bool

	// Data is a free-form JSON payload hydrated by the pipeline's enrich step.
	// Callers may populate it at fire time with context the producer knows cheaply.
	Data map[string]any
}

// Validate enforces the CHECK constraints from migration 120 at the Go level
// (fail-fast before the DB round-trip). Returns the first validation failure.
func (e Event) Validate() error {
	// EventKey is mandatory for idempotency.
	if e.EventKey == "" {
		return errors.New("event_key must not be empty")
	}

	// Priority must be one of the four valid values.
	switch e.Priority {
	case PriorityLow, PriorityMedium, PriorityHigh, PriorityCritical:
		// ok
	default:
		return fmt.Errorf("invalid priority %q: must be low, medium, high, or critical", e.Priority)
	}

	// FanoutMode constraints mirror the DB CHECK constraints exactly.
	switch e.FanoutMode {
	case FanoutDirect:
		// direct fanout requires a recipient user.
		if e.RecipientUserID == nil {
			return errors.New("fanout_mode=direct requires RecipientUserID")
		}
		// direct requires subscription scope (all non-platform modes do).
		if e.SubscriptionID == nil {
			return errors.New("fanout_mode=direct requires SubscriptionID")
		}

	case FanoutWorkspace:
		if e.SubscriptionID == nil {
			return errors.New("fanout_mode=workspace requires SubscriptionID")
		}

	case FanoutTopologyNode, FanoutTopologySubtree:
		if e.TopologyNodeID == nil {
			return fmt.Errorf("fanout_mode=%s requires TopologyNodeID", e.FanoutMode)
		}
		if e.SubscriptionID == nil {
			return fmt.Errorf("fanout_mode=%s requires SubscriptionID", e.FanoutMode)
		}

	case FanoutTenant:
		if e.SubscriptionID == nil {
			return errors.New("fanout_mode=tenant requires SubscriptionID")
		}

	case FanoutPlatform:
		// platform events must have no subscription (gadmin broadcasts only).
		if e.SubscriptionID != nil {
			return errors.New("fanout_mode=platform must not have SubscriptionID")
		}

	default:
		return fmt.Errorf("invalid fanout_mode %q", e.FanoutMode)
	}

	// sent_by_system=true and a user sender are mutually exclusive.
	if e.SentBySystem && e.SentByUserID != nil {
		return errors.New("sent_by_system=true is mutually exclusive with SentByUserID")
	}

	return nil
}
