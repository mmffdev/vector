// Adopt simulation harness — env-var wiring shim
//
// Card 00010. Reads `ADOPT_FAIL_AT_STEP` from the process environment
// at handler-construction time and threads it into AdoptOptions.FailAtStep
// for both the POST and SSE handlers. The orchestrator already knows how
// to honour FailAtStep (see adopt.go); this file is purely the wiring +
// guardrails (production gate, step-name validation).
//
// Constraints (per card brief):
//   - Refused outright when APP_ENV=production. The same env var is the
//     project's existing prod gate (see backend/cmd/server/main.go) — we
//     reuse it instead of inventing a new one.
//   - Validates the step name against the canonical seven-step list. If
//     the operator typed something off the list we IGNORE the var and
//     log loudly; we deliberately do NOT crash the process.
//   - Single source of truth: both the POST handler (Adopt) and the SSE
//     handler (Stream) call adoptFailAtStepFromEnv() when constructing
//     AdoptOptions. No other code reads the env var directly.
//
// Pattern note: APP_ENV and the other ad-hoc operational env vars in
// this codebase (LIBRARY_RECONCILER_INTERVAL, FRONTEND_ORIGIN,
// COOKIE_SECURE) are read with plain os.Getenv. secrets.Get is reserved
// for credentials. ADOPT_FAIL_AT_STEP is operational, not a credential,
// so it follows the os.Getenv pattern.

package portfoliomodels

import (
	"log"
	"os"
)

// adoptFailAtStepEnvVar is the env var name. Exported via the helper —
// callers should never read os.Getenv directly so the prod gate cannot
// be bypassed.
const adoptFailAtStepEnvVar = "ADOPT_FAIL_AT_STEP"

// adoptFailAtStepFromEnv returns the validated step name to inject into
// AdoptOptions.FailAtStep, or "" when the harness is disabled.
//
// Disabled cases (return ""):
//   - env var unset or empty
//   - APP_ENV=production (regardless of var value)
//   - var set to a step name not in stepOrder (logged, then ignored)
//
// Side effect: logs once per call. Handlers construct AdoptOptions per
// request, so a misconfigured operator gets a steady stream of warnings
// in the server log — that's intentional, the harness is a sharp tool.
func adoptFailAtStepFromEnv() string {
	raw := os.Getenv(adoptFailAtStepEnvVar)
	if raw == "" {
		return ""
	}

	// Production gate — refuse to honour the var even if it points at a
	// valid step. The check matches backend/cmd/server/main.go's
	// `appEnv := os.Getenv("APP_ENV")` startup gate.
	if os.Getenv("APP_ENV") == "production" {
		log.Printf(
			"WARNING: %s=%q ignored — APP_ENV=production; sim harness is non-prod only",
			adoptFailAtStepEnvVar, raw,
		)
		return ""
	}

	if !isValidAdoptStep(raw) {
		log.Printf(
			"WARNING: %s=%q is not a valid step name (expected one of %v) — ignoring",
			adoptFailAtStepEnvVar, raw, stepOrder,
		)
		return ""
	}

	log.Printf(
		"ADOPT sim harness ENABLED — failing at step=%s — non-production only",
		raw,
	)
	return raw
}

// isValidAdoptStep reports whether name is one of the seven canonical
// saga step identifiers declared in adopt.go.
func isValidAdoptStep(name string) bool {
	for _, s := range stepOrder {
		if s == name {
			return true
		}
	}
	return false
}
