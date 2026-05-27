package pipeline

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ── Priority ordering ─────────────────────────────────────────────────────────

// priorityOrder maps domain.Priority to a numeric rank for comparison.
// Higher rank = higher urgency.
var priorityOrder = map[domain.Priority]int{
	domain.PriorityLow:      0,
	domain.PriorityMedium:   1,
	domain.PriorityHigh:     2,
	domain.PriorityCritical: 3,
}

// priorityGTE returns true if a >= b in urgency order.
func priorityGTE(a, b domain.Priority) bool {
	return priorityOrder[a] >= priorityOrder[b]
}

// ── Pref resolution result ────────────────────────────────────────────────────

// prefResult is the resolved preference for one (user, event_type, channel).
type prefResult struct {
	// Enabled indicates whether the user wants this channel for this event type.
	Enabled bool

	// PriorityFloor is the minimum event priority required for delivery.
	// Delivery is suppressed when event.Priority < PriorityFloor.
	PriorityFloor domain.Priority

	// Source records which tier supplied the result (for logging/TD).
	// Values: "user", "tier_default", "system_default", "hard_fallback".
	Source string
}

// ── Hard fallback ─────────────────────────────────────────────────────────────

// hardFallbackPref returns the built-in default for a channel when no DB row
// exists at any tier. Values are chosen to match v1 channel availability:
//
//   - in_app:  enabled, floor=low   (irreducible floor — always delivered)
//   - sse:     enabled, floor=low   (in-process, no vendor dependency)
//   - email:   enabled, floor=medium (opt-out style — on by default at medium+)
//   - push/slack/sms: disabled      (unimplemented dispatchers in this PLA)
//
// TD: replace with data-driven system_defaults seed when the validator
// requires it (brief §Risks row 3).
func hardFallbackPref(ch domain.Channel) prefResult {
	switch ch {
	case domain.ChannelInApp:
		return prefResult{Enabled: true, PriorityFloor: domain.PriorityLow, Source: "hard_fallback"}
	case domain.ChannelSSE:
		return prefResult{Enabled: true, PriorityFloor: domain.PriorityLow, Source: "hard_fallback"}
	case domain.ChannelEmail:
		return prefResult{Enabled: true, PriorityFloor: domain.PriorityMedium, Source: "hard_fallback"}
	default:
		// push, slack, sms — unimplemented dispatchers.
		return prefResult{Enabled: false, PriorityFloor: domain.PriorityCritical, Source: "hard_fallback"}
	}
}

// ── prefsResolver ─────────────────────────────────────────────────────────────

// prefsResolver performs 3-tier pref resolution against vector_artefacts.
type prefsResolver struct {
	pool *pgxpool.Pool
}

// newPrefsResolver constructs a resolver backed by pool.
func newPrefsResolver(pool *pgxpool.Pool) *prefsResolver {
	return &prefsResolver{pool: pool}
}

// resolve returns the effective pref for (userID, subscriptionID, eventType, channel).
//
// Tier order:
//  1. User row from users_notifications_prefs_v2.
//  2. Tier default from notifications_prefs_tier_defaults (requires subscription tier lookup).
//  3. System default from notifications_prefs_system_defaults.
//  4. Hard fallback (built-in constants above).
func (r *prefsResolver) resolve(
	ctx context.Context,
	userID uuid.UUID,
	subscriptionID *uuid.UUID,
	eventType string,
	channel domain.Channel,
) (prefResult, error) {
	// Tier 1 — user pref.
	if p, ok, err := r.loadUserPref(ctx, userID, eventType, string(channel)); err != nil {
		return prefResult{}, fmt.Errorf("prefs.resolve: user pref: %w", err)
	} else if ok {
		return p, nil
	}

	// Tier 2 — subscription tier default (only if subscription is available).
	if subscriptionID != nil {
		tier, err := r.loadSubscriptionTier(ctx, *subscriptionID)
		if err != nil {
			return prefResult{}, fmt.Errorf("prefs.resolve: subscription tier: %w", err)
		}
		if tier != "" {
			if p, ok, err := r.loadTierDefault(ctx, tier, eventType, string(channel)); err != nil {
				return prefResult{}, fmt.Errorf("prefs.resolve: tier default: %w", err)
			} else if ok {
				return p, nil
			}
		}
	}

	// Tier 3 — system default.
	if p, ok, err := r.loadSystemDefault(ctx, eventType, string(channel)); err != nil {
		return prefResult{}, fmt.Errorf("prefs.resolve: system default: %w", err)
	} else if ok {
		return p, nil
	}

	// Tier 4 — hard fallback.
	return hardFallbackPref(channel), nil
}

// loadUserPref queries users_notifications_prefs_v2.
func (r *prefsResolver) loadUserPref(ctx context.Context, userID uuid.UUID, eventType, channel string) (prefResult, bool, error) {
	const q = `
		SELECT
			users_notifications_prefs_v2_enabled,
			users_notifications_prefs_v2_priority_floor
		FROM users_notifications_prefs_v2
		WHERE users_notifications_prefs_v2_id_user    = $1
		  AND users_notifications_prefs_v2_event_type = $2
		  AND users_notifications_prefs_v2_channel    = $3
	`
	var enabled bool
	var floor string
	err := r.pool.QueryRow(ctx, q, userID, eventType, channel).Scan(&enabled, &floor)
	if err == pgx.ErrNoRows {
		return prefResult{}, false, nil
	}
	if err != nil {
		return prefResult{}, false, err
	}
	return prefResult{Enabled: enabled, PriorityFloor: domain.Priority(floor), Source: "user"}, true, nil
}

// loadSubscriptionTier fetches subscriptions_tier from the subscriptions table.
// Returns "" if the subscription is not found (platform events have no subscription).
func (r *prefsResolver) loadSubscriptionTier(ctx context.Context, subscriptionID uuid.UUID) (string, error) {
	const q = `SELECT subscriptions_tier FROM subscriptions WHERE subscriptions_id = $1`
	var tier string
	err := r.pool.QueryRow(ctx, q, subscriptionID).Scan(&tier)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return tier, err
}

// loadTierDefault queries notifications_prefs_tier_defaults.
func (r *prefsResolver) loadTierDefault(ctx context.Context, tier, eventType, channel string) (prefResult, bool, error) {
	const q = `
		SELECT
			notifications_prefs_tier_defaults_enabled,
			notifications_prefs_tier_defaults_priority_floor
		FROM notifications_prefs_tier_defaults
		WHERE notifications_prefs_tier_defaults_subscription_tier = $1
		  AND notifications_prefs_tier_defaults_event_type        = $2
		  AND notifications_prefs_tier_defaults_channel           = $3
	`
	var enabled bool
	var floor string
	err := r.pool.QueryRow(ctx, q, tier, eventType, channel).Scan(&enabled, &floor)
	if err == pgx.ErrNoRows {
		return prefResult{}, false, nil
	}
	if err != nil {
		return prefResult{}, false, err
	}
	return prefResult{Enabled: enabled, PriorityFloor: domain.Priority(floor), Source: "tier_default"}, true, nil
}

// loadSystemDefault queries notifications_prefs_system_defaults.
func (r *prefsResolver) loadSystemDefault(ctx context.Context, eventType, channel string) (prefResult, bool, error) {
	const q = `
		SELECT
			notifications_prefs_system_defaults_enabled,
			notifications_prefs_system_defaults_priority_floor
		FROM notifications_prefs_system_defaults
		WHERE notifications_prefs_system_defaults_event_type = $1
		  AND notifications_prefs_system_defaults_channel    = $2
	`
	var enabled bool
	var floor string
	err := r.pool.QueryRow(ctx, q, eventType, channel).Scan(&enabled, &floor)
	if err == pgx.ErrNoRows {
		return prefResult{}, false, nil
	}
	if err != nil {
		return prefResult{}, false, err
	}
	return prefResult{Enabled: enabled, PriorityFloor: domain.Priority(floor), Source: "system_default"}, true, nil
}
