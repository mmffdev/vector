package search

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// fakeSearcher records the Query it was handed so tests can assert the
// workspace the handler passed to the service. Returns an empty result.
type fakeSearcher struct {
	gotQuery Query
	called   bool
}

func (f *fakeSearcher) Search(_ context.Context, q Query) ([]Result, error) {
	f.called = true
	f.gotQuery = q
	return []Result{}, nil
}

// clampedCtx builds a request context carrying both an authed user and a
// Sentinel clamp for the given workspace — i.e. what sentinelMW + RequireAuth
// produce on the live path.
func clampedCtx(workspaceID, userID uuid.UUID) context.Context {
	ctx := auth.WithUserForTest(context.Background(), &roletypes.User{
		ID:          userID,
		WorkspaceID: workspaceID,
	})
	return sentinel.TestingWithClamp(ctx, sentinel.Clamp{
		WorkspaceID: workspaceID,
		UserID:      userID,
	})
}

func doSearch(t *testing.T, h *Handler, ctx context.Context, rawBody string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/_site/search/", bytes.NewReader([]byte(rawBody)))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Search(rec, req)
	return rec
}

// TestSearch_ForgedWorkspaceHasNoEffect is the SEC-001 contract: a body that
// names workspace B is ignored; the handler scopes the query to the clamp's
// workspace A. The forged value MUST NOT reach the service.
func TestSearch_ForgedWorkspaceHasNoEffect(t *testing.T) {
	wsA := uuid.New() // the caller's real (clamped) workspace
	wsB := uuid.New() // a victim workspace the attacker tries to name
	userID := uuid.New()

	fake := &fakeSearcher{}
	h := &Handler{svc: fake}

	// Body still carries a workspace_id field (an attacker would include it);
	// the handler must ignore it entirely.
	body := `{"q":"secret","workspace_id":"` + wsB.String() + `","limit":10}`
	rec := doSearch(t, h, clampedCtx(wsA, userID), body)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !fake.called {
		t.Fatal("service was not called")
	}
	if fake.gotQuery.WorkspaceID != wsA.String() {
		t.Fatalf("handler scoped to wrong workspace: got %q, want clamp workspace %q (forged body workspace %q must be ignored)",
			fake.gotQuery.WorkspaceID, wsA.String(), wsB.String())
	}
	if fake.gotQuery.WorkspaceID == wsB.String() {
		t.Fatal("SEC-001 regression: forged body workspace_id reached the service")
	}
}

// TestSearch_NoClampReturns403 is the fail-closed contract: a request that
// reaches the handler without a Sentinel clamp on ctx (route not behind
// sentinelMW) must 403, never run an unbounded query.
func TestSearch_NoClampReturns403(t *testing.T) {
	fake := &fakeSearcher{}
	h := &Handler{svc: fake}

	// Authed user present, but NO clamp on ctx.
	ctx := auth.WithUserForTest(context.Background(), &roletypes.User{ID: uuid.New()})
	rec := doSearch(t, h, ctx, `{"q":"secret"}`)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when clamp absent, got %d (%s)", rec.Code, rec.Body.String())
	}
	if fake.called {
		t.Fatal("fail-closed violated: service was called despite missing clamp")
	}
}

// TestSearch_NoUserReturns401 guards the auth precondition.
func TestSearch_NoUserReturns401(t *testing.T) {
	fake := &fakeSearcher{}
	h := &Handler{svc: fake}

	rec := doSearch(t, h, context.Background(), `{"q":"secret"}`)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with no user, got %d", rec.Code)
	}
	if fake.called {
		t.Fatal("service was called despite missing auth user")
	}
}

// TestSearch_ResponseShape confirms the success envelope is unchanged.
func TestSearch_ResponseShape(t *testing.T) {
	h := &Handler{svc: &fakeSearcher{}}
	rec := doSearch(t, h, clampedCtx(uuid.New(), uuid.New()), `{"q":"x"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp struct {
		Results []Result `json:"results"`
		Count   int      `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Results == nil {
		t.Fatal("results should be an empty array, not null")
	}
}
