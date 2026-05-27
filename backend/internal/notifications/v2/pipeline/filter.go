package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
)

// candidateChannels returns the default set of channels to attempt delivery on
// when no rule overrides are applied. Channels in this set are candidates only —
// each still passes through the full filter chain.
//
// Default set: in_app + sse + email (the three channels with live platform status).
// push/slack/sms are excluded because they have no dispatcher in this PLA.
func candidateChannels() []domain.Channel {
	return []domain.Channel{
		domain.ChannelInApp,
		domain.ChannelSSE,
		domain.ChannelEmail,
	}
}

// ── userSettings ──────────────────────────────────────────────────────────────

// userSettings holds the quiet-hours window for one user.
type userSettings struct {
	QuietHoursStart *time.Time // local time-of-day; nil = no quiet hours set
	QuietHoursEnd   *time.Time // local time-of-day
	QuietHoursTZ    string     // IANA timezone; empty = use UTC
}

// loadUserSettings fetches users_notifications_settings for userID.
// Returns a zero-value struct (no quiet hours) if no row exists.
func loadUserSettings(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (userSettings, error) {
	const q = `
		SELECT
			users_notifications_settings_quiet_hours_start,
			users_notifications_settings_quiet_hours_end,
			users_notifications_settings_quiet_hours_tz
		FROM users_notifications_settings
		WHERE users_notifications_settings_id_user = $1
	`
	var s userSettings
	// pgx maps time NULL columns to *time.Time when scanning into a pointer.
	var start, end *time.Time
	var tz *string
	err := pool.QueryRow(ctx, q, userID).Scan(&start, &end, &tz)
	if err == pgx.ErrNoRows {
		return userSettings{}, nil
	}
	if err != nil {
		return userSettings{}, fmt.Errorf("loadUserSettings: %w", err)
	}
	s.QuietHoursStart = start
	s.QuietHoursEnd = end
	if tz != nil {
		s.QuietHoursTZ = *tz
	}
	return s, nil
}

// isInQuietHours returns true when now falls within the user's quiet hours window.
// Returns (false, nil, nil) when no quiet hours are set.
// Returns (true, quietEnd, err) when inside the window; quietEnd is the wall-clock
// time at which the quiet window ends, used to set scheduled_for.
func isInQuietHours(s userSettings, now time.Time) (inside bool, quietEnd *time.Time, err error) {
	if s.QuietHoursStart == nil || s.QuietHoursEnd == nil {
		return false, nil, nil
	}
	tz := time.UTC
	if s.QuietHoursTZ != "" {
		loc, lerr := time.LoadLocation(s.QuietHoursTZ)
		if lerr != nil {
			// Bad IANA string — treat as UTC; don't crash the pipeline.
			// A malformed tz string is a user-data problem, not a system error.
			tz = time.UTC
		} else {
			tz = loc
		}
	}

	local := now.In(tz)
	startH, startM := s.QuietHoursStart.Hour(), s.QuietHoursStart.Minute()
	endH, endM := s.QuietHoursEnd.Hour(), s.QuietHoursEnd.Minute()

	startOfDay := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, tz)
	windowStart := startOfDay.Add(time.Duration(startH)*time.Hour + time.Duration(startM)*time.Minute)
	windowEnd := startOfDay.Add(time.Duration(endH)*time.Hour + time.Duration(endM)*time.Minute)

	// Handle overnight window (e.g. 22:00–06:00).
	if windowEnd.Before(windowStart) {
		// Check if we're after start (this evening) or before end (next morning).
		if local.After(windowStart) || local.Before(windowEnd) {
			if local.After(windowStart) {
				// Push end to tomorrow.
				windowEnd = windowEnd.Add(24 * time.Hour)
			}
			t := windowEnd.UTC()
			return true, &t, nil
		}
		return false, nil, nil
	}

	// Normal window (start < end, same day).
	if (local.Equal(windowStart) || local.After(windowStart)) && local.Before(windowEnd) {
		t := windowEnd.UTC()
		return true, &t, nil
	}
	return false, nil, nil
}

// ── platformChannelStatus ─────────────────────────────────────────────────────

// platformChannelStatus holds the enabled state for one channel from
// notifications_platform_channels.
type platformChannelStatus struct {
	Enabled bool
	Status  string // live / degraded / disabled / unimplemented
}

// loadPlatformChannels loads all rows from notifications_platform_channels.
// Returns a map keyed by channel name.
func loadPlatformChannels(ctx context.Context, pool *pgxpool.Pool) (map[domain.Channel]platformChannelStatus, error) {
	const q = `
		SELECT
			notifications_platform_channels_channel,
			notifications_platform_channels_enabled,
			notifications_platform_channels_status
		FROM notifications_platform_channels
	`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("loadPlatformChannels: %w", err)
	}
	defer rows.Close()

	out := make(map[domain.Channel]platformChannelStatus)
	for rows.Next() {
		var ch string
		var enabled bool
		var status string
		if err := rows.Scan(&ch, &enabled, &status); err != nil {
			return nil, fmt.Errorf("loadPlatformChannels: scan: %w", err)
		}
		out[domain.Channel(ch)] = platformChannelStatus{Enabled: enabled, Status: status}
	}
	return out, rows.Err()
}

// ── filterCtx — per-event state assembled once and reused per recipient ───────

// filterCtx holds data that is fetched once per ProcessEvent call and shared
// across all recipient evaluations. This avoids redundant DB queries.
type filterCtx struct {
	// matchedRules is the result of rules.Evaluator.MatchEvent — called once per event.
	matchedRules []rules.Rule

	// platformChannels is the kill-switch state for all channels.
	platformChannels map[domain.Channel]platformChannelStatus
}

// buildFilterCtx fetches the event-level filter data (rules + platform channels).
func buildFilterCtx(ctx context.Context, pool *pgxpool.Pool, evaluator rules.Evaluator, event domain.Event) (filterCtx, error) {
	matched, err := evaluator.MatchEvent(ctx, event)
	if err != nil {
		return filterCtx{}, fmt.Errorf("filter: rules.MatchEvent: %w", err)
	}
	platforms, err := loadPlatformChannels(ctx, pool)
	if err != nil {
		return filterCtx{}, fmt.Errorf("filter: platform channels: %w", err)
	}
	return filterCtx{matchedRules: matched, platformChannels: platforms}, nil
}

// ── applyRules — merges rule outputs onto the candidate decision set ───────────

// ruleDecision is the per-channel output of rule application.
type ruleDecision struct {
	Channels           []domain.Channel
	EffectivePriority  domain.Priority
	TemplateOverrideID *uuid.UUID
	Schedule           rules.Schedule
}

// applyRules processes matchedRules to produce the merged rule outcome.
// Conflict resolution: apply rules in evaluator order; later rule wins for
// priority/template/schedule scalars; channel set is unioned across all rules.
func applyRules(base domain.Priority, matched []rules.Rule) ruleDecision {
	out := ruleDecision{
		EffectivePriority: base,
		Schedule:          rules.ScheduleImmediate,
	}
	channelSet := make(map[domain.Channel]struct{})

	for _, r := range matched {
		// Union channels across all matching rules.
		for _, ch := range r.Channels {
			channelSet[ch] = struct{}{}
		}
		// Later rule wins for priority override.
		if r.PriorityOverride != nil {
			out.EffectivePriority = *r.PriorityOverride
		}
		// Later rule wins for template override.
		if r.TemplateOverrideID != nil {
			out.TemplateOverrideID = r.TemplateOverrideID
		}
		// Later rule wins for schedule.
		if r.Schedule != "" {
			out.Schedule = r.Schedule
		}
	}

	for ch := range channelSet {
		out.Channels = append(out.Channels, ch)
	}
	return out
}

// ── filterRecipient — main entry point ───────────────────────────────────────

// filterRecipient produces one Decision per candidate channel for a recipient.
// The seven sub-functions are applied in order:
//  1. Sentinel clamp verification (recipient has access to the event's artefact scope)
//  2. Prefs check (user enabled this channel for this event type)
//  3. Priority floor (event priority >= user's minimum floor)
//  4. Rule application (may add channels, override priority/template/schedule)
//  5. Quiet hours (defer non-critical to next window end)
//  6. Platform channel kill switch (suppress if channel disabled)
//  7. Critical bypass (in_app + email always delivered for critical events,
//     even if prefs said disabled; platform kill still wins)
//
// Defence/finance HARD RULE: step 1 is server-side. The pipeline is not an
// HTTP handler, so it uses SubscriptionID from the event to verify tenant
// scoping. A future story may add per-artefact sentinel resolution; for now
// we verify that the event's subscription matches the recipient's subscription.
func filterRecipient(
	ctx context.Context,
	pool *pgxpool.Pool,
	event domain.Event,
	recipient Recipient,
	fctx filterCtx,
) ([]Decision, error) {
	// ── Step 1: Sentinel clamp verification ──────────────────────────────────
	// The pipeline runs out-of-request; there is no HTTP context.
	// We verify tenant scoping: ensure the recipient is a member of the
	// event's subscription. This is the defence/finance server-is-the-gate check.
	if event.FanoutMode != domain.FanoutPlatform && event.SubscriptionID != nil {
		isMember, err := verifyRecipientTenantMembership(ctx, pool, recipient.UserID, *event.SubscriptionID)
		if err != nil {
			return nil, fmt.Errorf("filter: sentinel clamp: %w", err)
		}
		if !isMember {
			// Recipient does not belong to this subscription.
			// Suppress all channels with a sentinel reason.
			return suppressAll(event.Priority, fctx, rules.ScheduleImmediate, "sentinel_scope_mismatch", ""), nil
		}
	}

	// ── Steps 2–7: Determine decisions per channel ───────────────────────────

	// Apply rules to get effective priority, template override, schedule, and
	// any additional channels. candidateChannels() is the base set.
	ruleOut := applyRules(event.Priority, fctx.matchedRules)

	// Build the working channel set: default candidates + rule-added channels.
	candidates := mergeChannels(candidateChannels(), ruleOut.Channels)

	// Load user quiet hours once per recipient.
	settings, err := loadUserSettings(ctx, pool, recipient.UserID)
	if err != nil {
		return nil, fmt.Errorf("filter: user settings: %w", err)
	}

	prefs := newPrefsResolver(pool)
	now := time.Now().UTC()

	var decisions []Decision

	for _, ch := range candidates {
		d, err := evaluateChannel(ctx, prefs, event, recipient, ch, ruleOut, settings, fctx, now)
		if err != nil {
			return nil, fmt.Errorf("filter: evaluate channel %s: %w", ch, err)
		}
		decisions = append(decisions, d)
	}
	return decisions, nil
}

// evaluateChannel applies steps 2–7 for one (recipient, channel) pair.
func evaluateChannel(
	ctx context.Context,
	prefs *prefsResolver,
	event domain.Event,
	recipient Recipient,
	ch domain.Channel,
	ruleOut ruleDecision,
	settings userSettings,
	fctx filterCtx,
	now time.Time,
) (Decision, error) {
	effectivePriority := ruleOut.EffectivePriority
	isCritical := effectivePriority == domain.PriorityCritical

	// ── Step 2: Prefs check ───────────────────────────────────────────────────
	pref, err := prefs.resolve(ctx, recipient.UserID, event.SubscriptionID, event.Type.String(), ch)
	if err != nil {
		return Decision{}, fmt.Errorf("prefs.resolve: %w", err)
	}

	// Critical bypass for in_app + email: skip prefs check.
	bypassReason := ""
	prefsSuppressed := !pref.Enabled
	if prefsSuppressed && isCritical && isCriticalBypassChannel(ch) {
		prefsSuppressed = false
		bypassReason = "critical_priority"
	}
	if prefsSuppressed {
		return Decision{Channel: ch, Action: ActionSuppress, SuppressReason: "prefs_disabled", EffectivePriority: effectivePriority}, nil
	}

	// ── Step 3: Priority floor ────────────────────────────────────────────────
	belowFloor := !priorityGTE(effectivePriority, pref.PriorityFloor)
	// Critical bypass applies to floor check too for in_app + email.
	if belowFloor && isCritical && isCriticalBypassChannel(ch) {
		belowFloor = false
		if bypassReason == "" {
			bypassReason = "critical_priority"
		}
	}
	if belowFloor {
		return Decision{Channel: ch, Action: ActionSuppress, SuppressReason: "priority_below_floor", EffectivePriority: effectivePriority}, nil
	}

	// ── Step 6: Platform channel kill switch ──────────────────────────────────
	// Platform kill is NOT bypassed by critical priority (vendor outage > urgency).
	if status, ok := fctx.platformChannels[ch]; ok {
		if !status.Enabled {
			return Decision{Channel: ch, Action: ActionSuppress, SuppressReason: "channel_disabled_platform", EffectivePriority: effectivePriority}, nil
		}
	}

	// ── Step 5: Quiet hours ───────────────────────────────────────────────────
	// Critical bypasses quiet hours for in_app + email.
	if !isCritical || !isCriticalBypassChannel(ch) {
		inside, quietEnd, qerr := isInQuietHours(settings, now)
		if qerr != nil {
			return Decision{}, fmt.Errorf("isInQuietHours: %w", qerr)
		}
		if inside {
			if ruleOut.Schedule == rules.ScheduleNextQuietHoursEnd || ruleOut.Schedule == rules.ScheduleImmediate {
				// Defer to quiet hours end.
				return Decision{
					Channel:            ch,
					Action:             ActionSchedule,
					ScheduledFor:       quietEnd,
					TemplateOverrideID: ruleOut.TemplateOverrideID,
					EffectivePriority:  effectivePriority,
					BypassReason:       bypassReason,
				}, nil
			}
		}
	}

	// ── Step 4: Rule schedule override ───────────────────────────────────────
	switch ruleOut.Schedule {
	case rules.ScheduleDigest:
		bucket := digestBucketKey(recipient.UserID, settings)
		dueAt := digestDueAt(settings, now)
		return Decision{
			Channel:            ch,
			Action:             ActionDigest,
			DigestBucket:       bucket,
			ScheduledFor:       &dueAt,
			TemplateOverrideID: ruleOut.TemplateOverrideID,
			EffectivePriority:  effectivePriority,
			BypassReason:       bypassReason,
		}, nil

	case rules.ScheduleNextQuietHoursEnd:
		inside, quietEnd, qerr := isInQuietHours(settings, now)
		if qerr != nil {
			return Decision{}, fmt.Errorf("isInQuietHours (rule): %w", qerr)
		}
		if inside && quietEnd != nil {
			return Decision{
				Channel:            ch,
				Action:             ActionSchedule,
				ScheduledFor:       quietEnd,
				TemplateOverrideID: ruleOut.TemplateOverrideID,
				EffectivePriority:  effectivePriority,
				BypassReason:       bypassReason,
			}, nil
		}
		// Not currently in quiet hours — deliver immediately.
		fallthrough
	default:
		// Immediate delivery.
		return Decision{
			Channel:            ch,
			Action:             ActionDeliver,
			TemplateOverrideID: ruleOut.TemplateOverrideID,
			EffectivePriority:  effectivePriority,
			BypassReason:       bypassReason,
		}, nil
	}
}

// ── helpers ───────────────────────────────────────────────────────────────────

// isCriticalBypassChannel returns true for channels that critical events are
// always delivered on, even when user prefs say disabled and quiet hours say defer.
// Platform kill switch is NOT overridden (spec §Critical-priority bypass).
func isCriticalBypassChannel(ch domain.Channel) bool {
	return ch == domain.ChannelInApp || ch == domain.ChannelEmail
}

// suppressAll returns one ActionSuppress Decision per channel in candidates.
func suppressAll(priority domain.Priority, fctx filterCtx, _ rules.Schedule, reason, bypassReason string) []Decision {
	channels := candidateChannels()
	out := make([]Decision, 0, len(channels))
	for _, ch := range channels {
		out = append(out, Decision{
			Channel:           ch,
			Action:            ActionSuppress,
			SuppressReason:    reason,
			BypassReason:      bypassReason,
			EffectivePriority: priority,
		})
	}
	_ = fctx // suppress unused warning; fctx is passed for future extension
	return out
}

// mergeChannels returns the union of a and b, preserving a's order and
// appending unique elements from b.
func mergeChannels(a, b []domain.Channel) []domain.Channel {
	seen := make(map[domain.Channel]struct{}, len(a))
	out := make([]domain.Channel, 0, len(a)+len(b))
	for _, ch := range a {
		seen[ch] = struct{}{}
		out = append(out, ch)
	}
	for _, ch := range b {
		if _, ok := seen[ch]; !ok {
			seen[ch] = struct{}{}
			out = append(out, ch)
		}
	}
	return out
}

// verifyRecipientTenantMembership checks that the user belongs to the given
// subscription. This is the server-side sentinel clamp for the out-of-request
// pipeline context (defence/finance HARD RULE: server is the gate).
func verifyRecipientTenantMembership(ctx context.Context, pool *pgxpool.Pool, userID, subscriptionID uuid.UUID) (bool, error) {
	// Users are linked to a subscription via users_stakeholders or the users table
	// (users_id_subscription). We use the simplest available join: check
	// users.users_id_subscription directly.
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM users
			WHERE users_id = $1
			  AND users_id_subscription = $2
			  AND users_is_active = true
		)
	`
	var ok bool
	if err := pool.QueryRow(ctx, q, userID, subscriptionID).Scan(&ok); err != nil {
		return false, fmt.Errorf("verifyRecipientTenantMembership: %w", err)
	}
	return ok, nil
}

// digestBucketKey returns the PendingStore bucket key for a user's digest window.
// Format: "<userID>:immediate" (cadence from users_notifications_settings when
// that is available; for S06 we use "immediate" as the bucket — S12 extends this).
func digestBucketKey(userID uuid.UUID, _ userSettings) string {
	// TD: extend to use settings.DigestCadence when S12 adds the digest scheduler.
	return userID.String() + ":digest"
}

// digestDueAt returns when the digest entry should be flushed.
// For S06 (no real digest scheduler): schedule 1 hour from now.
// S12 replaces this with the proper cadence calculation.
func digestDueAt(_ userSettings, now time.Time) time.Time {
	return now.Add(1 * time.Hour)
}
