package pipeline

import (
	"testing"

	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

// ── priorityGTE tests ─────────────────────────────────────────────────────────

func TestPriorityGTE(t *testing.T) {
	cases := []struct {
		a, b domain.Priority
		want bool
	}{
		{domain.PriorityLow, domain.PriorityLow, true},
		{domain.PriorityMedium, domain.PriorityLow, true},
		{domain.PriorityHigh, domain.PriorityMedium, true},
		{domain.PriorityCritical, domain.PriorityHigh, true},
		{domain.PriorityCritical, domain.PriorityCritical, true},
		{domain.PriorityLow, domain.PriorityMedium, false},
		{domain.PriorityMedium, domain.PriorityHigh, false},
		{domain.PriorityHigh, domain.PriorityCritical, false},
	}
	for _, c := range cases {
		got := priorityGTE(c.a, c.b)
		if got != c.want {
			t.Errorf("priorityGTE(%s, %s): want %v, got %v", c.a, c.b, c.want, got)
		}
	}
}

// ── hardFallbackPref tests ────────────────────────────────────────────────────

func TestHardFallbackPref_InApp(t *testing.T) {
	p := hardFallbackPref(domain.ChannelInApp)
	if !p.Enabled {
		t.Error("in_app hard fallback must be enabled")
	}
	if p.PriorityFloor != domain.PriorityLow {
		t.Errorf("in_app floor: want low, got %s", p.PriorityFloor)
	}
	if p.Source != "hard_fallback" {
		t.Errorf("source: want hard_fallback, got %s", p.Source)
	}
}

func TestHardFallbackPref_Email(t *testing.T) {
	p := hardFallbackPref(domain.ChannelEmail)
	if !p.Enabled {
		t.Error("email hard fallback must be enabled")
	}
	if p.PriorityFloor != domain.PriorityMedium {
		t.Errorf("email floor: want medium, got %s", p.PriorityFloor)
	}
}

func TestHardFallbackPref_UnimplementedChannels(t *testing.T) {
	for _, ch := range []domain.Channel{domain.ChannelPush, domain.ChannelSlack, domain.ChannelSMS} {
		p := hardFallbackPref(ch)
		if p.Enabled {
			t.Errorf("%s hard fallback must be disabled (unimplemented)", ch)
		}
	}
}

func TestHardFallbackPref_SSE(t *testing.T) {
	p := hardFallbackPref(domain.ChannelSSE)
	if !p.Enabled {
		t.Error("sse hard fallback must be enabled")
	}
	if p.PriorityFloor != domain.PriorityLow {
		t.Errorf("sse floor: want low, got %s", p.PriorityFloor)
	}
}

// ── critical bypass logic tests (tested via filter, but validate the predicate here) ──

func TestPriorityGTE_CriticalBypassChannels(t *testing.T) {
	// Critical event at "medium" floor: should pass for in_app (low floor).
	if !priorityGTE(domain.PriorityCritical, domain.PriorityLow) {
		t.Error("critical >= low must be true")
	}
	// Low event at "medium" floor: must be suppressed.
	if priorityGTE(domain.PriorityLow, domain.PriorityMedium) {
		t.Error("low >= medium must be false")
	}
}
