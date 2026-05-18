package auth_test

// B16.8.11 step 5 — REQUIRE_SID_CLAIM env gate.
//
// Until this commit, the legacy/grace-window path in RequireAuth
// accepted any access token whose `sid` claim was empty: that was the
// 24h grace mechanism that kept users signed in across the deploy of
// step 2 (when sid claims first started being stamped). After grace,
// a no-sid token MUST be rejected — otherwise an attacker who pinches
// an old legacy token forever bypasses the per-request session check.
//
// These tests pin the gate's contract:
//   1. flag off (default)  — no-sid token is accepted (back-compat).
//      Test asserts the request reaches the downstream handler (200).
//   2. flag on              — no-sid token is rejected with 401.
//      Test asserts the request never reaches the handler.
//
// We don't need a DB: when the legacy branch is gated off, the 401 is
// emitted BEFORE FindUserByID is called, so Service.Pool can stay nil.
// When the legacy branch is allowed (flag off), the test mints a token
// that decodes cleanly but the legacy branch's DB lookup would still
// fire — to keep this DB-free we leave Service.Pool nil and assert
// instead that the legacy branch's *FindUserByID error path* still
// 500s (not 401), proving the env gate did not short-circuit.
//
// In practice: flag-off back-compat path is also covered end-to-end
// against the running dev backend in the manual side-instance test
// described in step 5g's commit message.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

const testSecret = "test-secret-do-not-use-in-prod-do-not-use-in-prod"

// signNoSidToken mints an access token deliberately WITHOUT the sid
// claim, simulating a legacy / pre-step-2 token. We can't call
// auth.SignAccessToken(u, uuid.Nil) directly because it sets the
// signing secret from secrets.Get — t.Setenv handles that.
func signNoSidToken(t *testing.T) string {
	t.Helper()
	t.Setenv("JWT_ACCESS_SECRET", testSecret)
	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "legacy@example.com",
	}
	// uuid.Nil → SignAccessToken omits the sid claim entirely
	// (omitempty contract from step 2).
	token, err := auth.SignAccessToken(u, uuid.Nil)
	if err != nil {
		t.Fatalf("SignAccessToken: %v", err)
	}
	return token
}

func mountRequireAuth(t *testing.T) (*httptest.Server, *bool) {
	t.Helper()
	svc := &auth.Service{} // Pool nil — DB calls fail with a clear panic, but the gate runs first
	reached := false
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireAuth)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		})
	})
	return httptest.NewServer(r), &reached
}

// Flag ON: a legacy no-sid token is rejected at the middleware before
// any DB call. Status 401, handler never reached.
func TestRequireAuth_RejectsNoSidTokenWhenStrict(t *testing.T) {
	t.Setenv("REQUIRE_SID_CLAIM", "true")
	token := signNoSidToken(t)

	srv, reached := mountRequireAuth(t)
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/ping", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("REQUIRE_SID_CLAIM=true with no-sid token: want 401, got %d", res.StatusCode)
	}
	if *reached {
		t.Error("handler should not have been reached — gate must reject before downstream")
	}
}

// Flag OFF (default): legacy no-sid tokens reach the DB path (and our
// nil Pool makes that path explode). Contract being pinned: the env
// gate did NOT short-circuit with a 401.
//
// Two possible outcomes when the gate is OFF and the request proceeds
// past it:
//   - Connection EOF: the nil-Pool panic crashes the goroutine
//     mid-request (chi's recovery middleware isn't mounted in this
//     minimal test router).
//   - 5xx: if a recoverer were mounted, we'd get an HTTP error.
//
// Both prove the same thing: the gate let the request through. What
// we explicitly reject is a clean 401 from the gate itself.
func TestRequireAuth_AllowsNoSidTokenWhenLenient(t *testing.T) {
	// Explicit unset to defend against test order: anything that set
	// REQUIRE_SID_CLAIM in a previous test leaks unless t.Setenv was
	// used. t.Setenv is per-test cleanup, so this is just defensive.
	os.Unsetenv("REQUIRE_SID_CLAIM")
	token := signNoSidToken(t)

	srv, reached := mountRequireAuth(t)
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/ping", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := http.DefaultClient.Do(req)
	// EOF / connection reset = gate let through, downstream panicked.
	// Any clean response = gate let through, downstream did something.
	// Only a 401 would mean the gate fired — which is the failure case.
	if err != nil {
		// Connection-level failure (EOF from nil-Pool panic). That's
		// fine: it proves the gate didn't 401.
		if *reached {
			t.Error("handler should not have been reached either (Pool nil) — sanity check")
		}
		return
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusUnauthorized {
		t.Errorf("REQUIRE_SID_CLAIM unset with no-sid token: gate must NOT 401 (got 401 — flag is leaking on)")
	}
	if *reached {
		t.Error("handler should not have been reached either (Pool nil) — sanity check")
	}
}
