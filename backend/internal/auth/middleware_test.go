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
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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
	token, err := auth.SignAccessToken(u, uuid.Nil, "")
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

// TestRequireAuth_RejectsTokenWithoutDPoPConfirmation pins the
// post-Phase-6 (TD-SEC-DPOP-BINDING, migration 213, 2026-05-18)
// behaviour: a token without a cnf.jkt claim is always 401, regardless
// of any other state. The previous shape of this test pinned the
// B16.8.11 REQUIRE_SID_CLAIM grace window's lenient mode — that grace
// window is functionally superseded by DPoP requirement, because no
// mint path produces a token that lacks BOTH sid and cnf.jkt, and
// every pre-Phase-6 session was wiped by migration 213.
//
// signNoSidToken produces a token that also lacks cnf.jkt (the helper
// predates Phase 3); Phase 6 middleware rejects it before the
// REQUIRE_SID_CLAIM gate even runs.
func TestRequireAuth_RejectsTokenWithoutDPoPConfirmation(t *testing.T) {
	os.Unsetenv("REQUIRE_SID_CLAIM")
	token := signNoSidToken(t)

	srv, reached := mountRequireAuth(t)
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/ping", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for token without cnf.jkt; got %d", res.StatusCode)
	}
	if got := res.Header.Get("WWW-Authenticate"); !strings.Contains(got, "DPoP") {
		t.Errorf("expected WWW-Authenticate: DPoP error=\"invalid_dpop_proof\"; got %q", got)
	}
	if *reached {
		t.Error("handler should not have been reached — DPoP gate must reject first")
	}
}

// ============================================================
// PLA059 — RequireUserAuth middleware
//
// Pins the contract that credential-issuance surfaces (/admin/api-keys/*)
// reject API-key-only callers. The existing RequirePermission has a
// pass-through for api-key auth (correct for read-only routes scoped
// on subscription_id); RequireUserAuth sits ahead of it on the api-keys
// route group and forces a User context.
//
// Three cases pinned:
//   1. JWT-authenticated (UserFromCtx != nil)              → next runs (200).
//   2. API-key-only      (api_key_subscription_id set,     → 403 + Problem.Code "user_auth_required".
//                         UserFromCtx == nil)
//   3. Unauthenticated   (neither user nor api-key set)    → 403 + Problem.Code "user_auth_required".
//
// These tests exercise the middleware in isolation; the route-group
// composition (RequireFreshPassword → RequireUserAuth → RequirePermission
// → RequireStepUpReauth) is wired in backend/cmd/server/main.go and
// verified end-to-end against the running dev backend (see PLA059 §
// Verification).
// ============================================================

// mountRequireUserAuth wires a single GET /ping route gated by
// RequireUserAuth. The handler flips reached=true so tests can assert
// whether the gate let the request through.
func mountRequireUserAuth() (*httptest.Server, *bool) {
	reached := false
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireUserAuth)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		})
	})
	return httptest.NewServer(r), &reached
}

// problemResponse mirrors the shape httperr.WriteCoded emits — we only
// need the code field for these assertions.
type problemResponse struct {
	Code string `json:"code"`
}

// Case 1 — JWT-authenticated caller passes through unchanged.
func TestRequireUserAuth_JWTUser_Allowed(t *testing.T) {
	srv, reached := mountRequireUserAuth()
	defer srv.Close()

	// Pre-seed a User in the request context via a tiny wrapping
	// middleware. WithUserForTest is the canonical seam.
	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "padmin@example.com",
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req := r.WithContext(auth.WithUserForTest(r.Context(), u))
		srv.Config.Handler.ServeHTTP(w, req)
	})
	stub := httptest.NewServer(wrapped)
	defer stub.Close()

	res, err := http.Get(stub.URL + "/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("JWT user → want 200, got %d", res.StatusCode)
	}
	if !*reached {
		t.Error("handler must run when UserFromCtx is non-nil")
	}
}

// Case 2 — api-key-only caller is denied with the dedicated code.
func TestRequireUserAuth_ApiKeyOnly_Denied(t *testing.T) {
	srv, reached := mountRequireUserAuth()
	defer srv.Close()

	// Seed only "api_key_subscription_id" — no User. This is the
	// shape apikeys.Middleware produces when nil userSynth is passed
	// (transports that only need the subscription_id, e.g. raw
	// /samantha/v2 reads).
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), interface{}("api_key_subscription_id"), uuid.NewString())
		srv.Config.Handler.ServeHTTP(w, r.WithContext(ctx))
	})
	stub := httptest.NewServer(wrapped)
	defer stub.Close()

	res, err := http.Get(stub.URL + "/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Errorf("api-key-only caller → want 403, got %d", res.StatusCode)
	}
	if *reached {
		t.Error("handler must NOT run when only api_key_subscription_id is set")
	}

	var p problemResponse
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatalf("decode problem body: %v", err)
	}
	if p.Code != auth.CodeUserAuthRequired {
		t.Errorf("Problem.Code → want %q, got %q", auth.CodeUserAuthRequired, p.Code)
	}
}

// ============================================================
// PLA059 — RequireFreshPassword + RequireStepUpReauth pairing
//
// The /admin/api-keys/* gate stack is:
//   RequireFreshPassword → RequireUserAuth → RequirePermission
//   → RequireStepUpReauth("manage-api-keys") (on Issue + Revoke only)
//
// These tests cover the two gates whose ordering and presence matter
// for the api-keys group:
//   - RequireFreshPassword denies users with ForcePasswordChange=true
//     BEFORE the permission check fires (so an unrotated padmin can't
//     mint a key).
//   - RequireStepUpReauth("manage-api-keys") on the absent-header
//     branch — the DB-backed "consume nonce" path is exercised by
//     B16.8.10 step-up tests; here we only need to pin the no-proof
//     → 409 + "reauth_required" branch.
// ============================================================

// Case 4 — user with ForcePasswordChange=true is rejected before the
// downstream handler fires. The api-keys group puts RequireFreshPassword
// at the top of the chain; this test pins the gate's contract in
// isolation.
func TestRequireFreshPassword_ForcePasswordChangeUser_Denied(t *testing.T) {
	svc := &auth.Service{}
	reached := false
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireFreshPassword)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		})
	})

	u := &roletypes.User{
		ID:                  uuid.New(),
		SubscriptionID:      uuid.New(),
		Email:               "padmin@example.com",
		ForcePasswordChange: true,
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.ServeHTTP(w, req.WithContext(auth.WithUserForTest(req.Context(), u)))
	})
	srv := httptest.NewServer(wrapped)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Errorf("ForcePasswordChange user → want 403, got %d", res.StatusCode)
	}
	if reached {
		t.Error("handler must NOT run when ForcePasswordChange=true")
	}
}

// Case 5 — fresh-password user (the default state) passes through the
// gate. Sanity-check the inverse so we know the gate isn't denying
// everyone.
func TestRequireFreshPassword_FreshUser_Allowed(t *testing.T) {
	svc := &auth.Service{}
	reached := false
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireFreshPassword)
		r.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusOK)
		})
	})

	u := &roletypes.User{
		ID:                  uuid.New(),
		SubscriptionID:      uuid.New(),
		Email:               "padmin@example.com",
		ForcePasswordChange: false,
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.ServeHTTP(w, req.WithContext(auth.WithUserForTest(req.Context(), u)))
	})
	srv := httptest.NewServer(wrapped)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("fresh user → want 200, got %d", res.StatusCode)
	}
	if !reached {
		t.Error("handler must run when ForcePasswordChange=false")
	}
}

// Case 6 — RequireStepUpReauth("manage-api-keys") with no X-Action-Proof
// header returns 409 + Problem.Code "reauth_required" before the DB is
// touched. This is the no-header branch; the consume-nonce DB path is
// covered by the B16.8.10 step-up integration tests elsewhere.
func TestRequireStepUpReauth_NoProofHeader_Returns409(t *testing.T) {
	svc := &auth.Service{}
	reached := false
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireStepUpReauth("manage-api-keys"))
		r.Post("/issue", func(w http.ResponseWriter, _ *http.Request) {
			reached = true
			w.WriteHeader(http.StatusCreated)
		})
	})

	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "padmin@example.com",
	}
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.ServeHTTP(w, req.WithContext(auth.WithUserForTest(req.Context(), u)))
	})
	srv := httptest.NewServer(wrapped)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/issue", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /issue: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusConflict {
		t.Errorf("missing X-Action-Proof → want 409, got %d", res.StatusCode)
	}
	if reached {
		t.Error("handler must NOT run when X-Action-Proof header is missing")
	}

	var p problemResponse
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatalf("decode problem body: %v", err)
	}
	if p.Code != auth.CodeReauthRequired {
		t.Errorf("Problem.Code → want %q, got %q", auth.CodeReauthRequired, p.Code)
	}
}

// Case 7 — RequireStepUpReauth with no User context (auth missing) returns
// 401 + AuthUnauthorized. Documents the precondition: the gate assumes
// RequireAuth (or equivalent User-seeding) ran upstream.
func TestRequireStepUpReauth_NoUserContext_Returns401(t *testing.T) {
	svc := &auth.Service{}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireStepUpReauth("manage-api-keys"))
		r.Post("/issue", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
		})
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	res, err := http.Post(srv.URL+"/issue", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("POST /issue: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("no user ctx → want 401, got %d", res.StatusCode)
	}
}

// Case 3 — unauthenticated caller (no user, no api-key) is also denied
// with the same code; the gate doesn't distinguish.
func TestRequireUserAuth_Unauthenticated_Denied(t *testing.T) {
	srv, reached := mountRequireUserAuth()
	defer srv.Close()

	res, err := http.Get(srv.URL + "/ping")
	if err != nil {
		t.Fatalf("GET /ping: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Errorf("unauthenticated caller → want 403, got %d", res.StatusCode)
	}
	if *reached {
		t.Error("handler must NOT run with neither user nor api-key context")
	}

	var p problemResponse
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatalf("decode problem body: %v", err)
	}
	if p.Code != auth.CodeUserAuthRequired {
		t.Errorf("Problem.Code → want %q, got %q", auth.CodeUserAuthRequired, p.Code)
	}
}
