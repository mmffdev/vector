// Unit tests for the adopt simulation-harness env-var shim.
//
// Card 00010. Pure function under test — no DB, no HTTP, no skip
// guards. Each subtest sets ADOPT_FAIL_AT_STEP (and APP_ENV where
// relevant) via t.Setenv so cleanup is automatic.

package portfoliomodels

import (
	"bytes"
	"log"
	"strings"
	"testing"
)

// captureLog redirects the standard logger's output to a buffer for the
// duration of the test, returning the buffer. Restored on cleanup.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prevOut := log.Writer()
	prevFlags := log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})
	return &buf
}

func TestAdoptFailAtStepFromEnv_Empty(t *testing.T) {
	// Belt-and-braces: t.Setenv with "" effectively unsets within the
	// test scope on Go ≥1.17 (sets to empty, which os.Getenv treats as
	// "not set" for our purposes).
	t.Setenv(adoptFailAtStepEnvVar, "")
	t.Setenv("APP_ENV", "development")

	if got := adoptFailAtStepFromEnv(); got != "" {
		t.Fatalf("empty env: got %q, want empty", got)
	}
}

func TestAdoptFailAtStepFromEnv_ValidStepNames(t *testing.T) {
	// Every canonical step name must round-trip through the helper
	// verbatim — that's the contract the orchestrator's FailAtStep
	// switch depends on.
	t.Setenv("APP_ENV", "development")

	for _, step := range stepOrder {
		step := step
		t.Run(step, func(t *testing.T) {
			t.Setenv(adoptFailAtStepEnvVar, step)
			if got := adoptFailAtStepFromEnv(); got != step {
				t.Fatalf("step %q: got %q, want %q", step, got, step)
			}
		})
	}
}

func TestAdoptFailAtStepFromEnv_InvalidStepIgnored(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv(adoptFailAtStepEnvVar, "not-a-step")

	buf := captureLog(t)

	got := adoptFailAtStepFromEnv()
	if got != "" {
		t.Fatalf("invalid step: got %q, want empty", got)
	}
	out := buf.String()
	if !strings.Contains(out, "not a valid step name") {
		t.Fatalf("expected validation warning in log, got %q", out)
	}
}

func TestAdoptFailAtStepFromEnv_ProductionGate(t *testing.T) {
	// Even with a valid step name, production must refuse and log the
	// refusal. This is the hard guardrail for the card's AC.
	t.Setenv("APP_ENV", "production")
	t.Setenv(adoptFailAtStepEnvVar, stepLayers)

	buf := captureLog(t)

	got := adoptFailAtStepFromEnv()
	if got != "" {
		t.Fatalf("production gate: got %q, want empty", got)
	}
	out := buf.String()
	if !strings.Contains(out, "APP_ENV=production") {
		t.Fatalf("expected production-refusal warning, got %q", out)
	}
}

func TestAdoptFailAtStepFromEnv_NonProdEnabledLogsBanner(t *testing.T) {
	// The card brief calls for an explicit "ENABLED" banner when the
	// harness is active. Lock it in so a future refactor can't silently
	// drop it.
	t.Setenv("APP_ENV", "development")
	t.Setenv(adoptFailAtStepEnvVar, stepFinalize)

	buf := captureLog(t)

	if got := adoptFailAtStepFromEnv(); got != stepFinalize {
		t.Fatalf("expected step %q, got %q", stepFinalize, got)
	}
	out := buf.String()
	if !strings.Contains(out, "ADOPT sim harness ENABLED") {
		t.Fatalf("expected ENABLED banner in log, got %q", out)
	}
	if !strings.Contains(out, "step="+stepFinalize) {
		t.Fatalf("expected step=%s in banner, got %q", stepFinalize, out)
	}
}

func TestIsValidAdoptStep(t *testing.T) {
	// Quick guard so a future edit to stepOrder gets caught here too.
	for _, step := range stepOrder {
		if !isValidAdoptStep(step) {
			t.Errorf("stepOrder member %q rejected by validator", step)
		}
	}
	for _, bad := range []string{"", "Validate", "layers ", "unknown"} {
		if isValidAdoptStep(bad) {
			t.Errorf("validator accepted bogus step %q", bad)
		}
	}
}
