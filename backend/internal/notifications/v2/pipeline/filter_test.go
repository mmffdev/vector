package pipeline

import (
	"testing"
	"time"

	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
)

// ── isCriticalBypassChannel ───────────────────────────────────────────────────

func TestIsCriticalBypassChannel(t *testing.T) {
	cases := []struct {
		ch   domain.Channel
		want bool
	}{
		{domain.ChannelInApp, true},
		{domain.ChannelEmail, true},
		{domain.ChannelSSE, false},
		{domain.ChannelPush, false},
		{domain.ChannelSlack, false},
		{domain.ChannelSMS, false},
	}
	for _, c := range cases {
		if got := isCriticalBypassChannel(c.ch); got != c.want {
			t.Errorf("isCriticalBypassChannel(%s): want %v, got %v", c.ch, c.want, got)
		}
	}
}

// ── mergeChannels ─────────────────────────────────────────────────────────────

func TestMergeChannels(t *testing.T) {
	a := []domain.Channel{domain.ChannelInApp, domain.ChannelSSE}
	b := []domain.Channel{domain.ChannelSSE, domain.ChannelEmail} // SSE is a dup

	merged := mergeChannels(a, b)
	if len(merged) != 3 {
		t.Fatalf("want 3 channels (no dups), got %d: %v", len(merged), merged)
	}
	// Order: a's channels first, then new from b.
	if merged[0] != domain.ChannelInApp {
		t.Errorf("merged[0]: want in_app, got %s", merged[0])
	}
	if merged[2] != domain.ChannelEmail {
		t.Errorf("merged[2]: want email, got %s", merged[2])
	}
}

// ── applyRules ────────────────────────────────────────────────────────────────

func TestApplyRules_NoRules(t *testing.T) {
	out := applyRules(domain.PriorityMedium, nil)
	if out.EffectivePriority != domain.PriorityMedium {
		t.Errorf("priority: want medium, got %s", out.EffectivePriority)
	}
	if len(out.Channels) != 0 {
		t.Errorf("channels: want empty, got %v", out.Channels)
	}
	if out.Schedule != rules.ScheduleImmediate {
		t.Errorf("schedule: want immediate, got %s", out.Schedule)
	}
}

func TestApplyRules_PriorityOverrideLaterRuleWins(t *testing.T) {
	pHigh := domain.PriorityHigh
	pLow := domain.PriorityLow
	matched := []rules.Rule{
		{PriorityOverride: &pHigh, Schedule: rules.ScheduleImmediate},
		{PriorityOverride: &pLow, Schedule: rules.ScheduleImmediate}, // later wins
	}
	out := applyRules(domain.PriorityMedium, matched)
	if out.EffectivePriority != domain.PriorityLow {
		t.Errorf("priority: want low (later rule wins), got %s", out.EffectivePriority)
	}
}

func TestApplyRules_ChannelsAreUnioned(t *testing.T) {
	matched := []rules.Rule{
		{Channels: []domain.Channel{domain.ChannelEmail}},
		{Channels: []domain.Channel{domain.ChannelEmail, domain.ChannelSSE}},
	}
	out := applyRules(domain.PriorityMedium, matched)
	seen := make(map[domain.Channel]bool)
	for _, ch := range out.Channels {
		if seen[ch] {
			t.Errorf("duplicate channel in union: %s", ch)
		}
		seen[ch] = true
	}
	if !seen[domain.ChannelEmail] || !seen[domain.ChannelSSE] {
		t.Errorf("want email+sse in union, got %v", out.Channels)
	}
}

// ── isInQuietHours ────────────────────────────────────────────────────────────

func makeTimeOfDay(h, m int) *time.Time {
	t := time.Date(0, 1, 1, h, m, 0, 0, time.UTC)
	return &t
}

func TestIsInQuietHours_NoSettings(t *testing.T) {
	s := userSettings{}
	inside, end, err := isInQuietHours(s, time.Now())
	if err != nil || inside || end != nil {
		t.Errorf("no settings: want (false, nil, nil), got (%v, %v, %v)", inside, end, err)
	}
}

func TestIsInQuietHours_InsideWindow(t *testing.T) {
	// Window: 22:00–06:00 UTC; now = 23:30 UTC.
	s := userSettings{
		QuietHoursStart: makeTimeOfDay(22, 0),
		QuietHoursEnd:   makeTimeOfDay(6, 0),
	}
	now := time.Date(2026, 5, 27, 23, 30, 0, 0, time.UTC)
	inside, end, err := isInQuietHours(s, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !inside {
		t.Error("want inside=true for 23:30 in 22:00–06:00 window")
	}
	if end == nil {
		t.Error("want non-nil quietEnd")
	}
}

func TestIsInQuietHours_OutsideWindow(t *testing.T) {
	// Window: 22:00–06:00 UTC; now = 12:00 UTC (middle of day).
	s := userSettings{
		QuietHoursStart: makeTimeOfDay(22, 0),
		QuietHoursEnd:   makeTimeOfDay(6, 0),
	}
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	inside, _, err := isInQuietHours(s, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if inside {
		t.Error("want inside=false for 12:00 outside 22:00–06:00 window")
	}
}

func TestIsInQuietHours_NormalWindow(t *testing.T) {
	// Window: 00:00–07:00 UTC; now = 03:00 UTC.
	s := userSettings{
		QuietHoursStart: makeTimeOfDay(0, 0),
		QuietHoursEnd:   makeTimeOfDay(7, 0),
	}
	now := time.Date(2026, 5, 27, 3, 0, 0, 0, time.UTC)
	inside, end, err := isInQuietHours(s, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !inside {
		t.Error("want inside=true for 03:00 in 00:00–07:00 window")
	}
	if end == nil {
		t.Error("want non-nil quietEnd")
	} else {
		// quietEnd should be 07:00 on the same day.
		expectedEnd := time.Date(2026, 5, 27, 7, 0, 0, 0, time.UTC)
		if !end.Equal(expectedEnd) {
			t.Errorf("quietEnd: want %v, got %v", expectedEnd, *end)
		}
	}
}

// ── suppressAll ───────────────────────────────────────────────────────────────

func TestSuppressAll(t *testing.T) {
	fctx := filterCtx{}
	decisions := suppressAll(domain.PriorityMedium, fctx, rules.ScheduleImmediate, "test_reason", "")
	if len(decisions) != len(candidateChannels()) {
		t.Fatalf("suppressAll: want %d decisions, got %d", len(candidateChannels()), len(decisions))
	}
	for _, d := range decisions {
		if d.Action != ActionSuppress {
			t.Errorf("want ActionSuppress, got %s for channel %s", d.Action, d.Channel)
		}
		if d.SuppressReason != "test_reason" {
			t.Errorf("want test_reason, got %s", d.SuppressReason)
		}
	}
}
