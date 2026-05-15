package workspacemasterrecord

// TD-WS-001 pay-down — handler MUST resolve the active workspace_id from
// the caller's subscription_id, not pass u.SubscriptionID through to
// Service.Get verbatim.
//
// The whole architectural principle behind this rewire: workspace scope
// is a backend-only mechanism. Users don't pick a workspace, never see
// one in a URL, never know which one they're in. The boundary they feel
// is just labelling + permissions. See:
//   .claude/memory/project_workspace_scope_invisible.md
//
// These tests are written FIRST (red) before:
//   • ActiveWorkspaceResolver interface exists on the Handler
//   • Handler.Get / Handler.Patch call it instead of using u.SubscriptionID
//
// Test 1 — handler hands the resolver's workspace_id (NOT u.SubscriptionID)
//          to Svc.Get. Stub service records the ID it received; assertion
//          fails if the handler passed subscription_id directly.
// Test 2 — same for Patch.
// Test 3 — resolver error → 404 (no active workspace found) without
//          leaking auth state or letting the service call happen.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// stubActiveResolver returns a stashed mapping subscription_id → workspace_id
// (or an error if the subscription isn't mapped). Mirrors the production
// FDWActiveWorkspaceResolver shape that Story 2 of this pay-down will ship.
type stubActiveResolver struct {
	mapping map[uuid.UUID]uuid.UUID
	err     error
}

func (s *stubActiveResolver) ActiveWorkspaceFor(_ context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	if s.err != nil {
		return uuid.Nil, s.err
	}
	if ws, ok := s.mapping[subscriptionID]; ok {
		return ws, nil
	}
	return uuid.Nil, ErrNoActiveWorkspace
}

// recordingService captures the workspaceID the handler passes through,
// so tests can assert the handler did resolution instead of passing
// u.SubscriptionID verbatim. Returns a minimal Settings so the handler
// happy-path completes.
type recordingService struct {
	gotGetID   uuid.UUID
	gotPatchID uuid.UUID
	settings   *Settings
}

func (r *recordingService) Get(_ context.Context, workspaceID uuid.UUID) (*Settings, error) {
	r.gotGetID = workspaceID
	if r.settings != nil {
		return r.settings, nil
	}
	return &Settings{TenantID: workspaceID}, nil
}

func (r *recordingService) Patch(_ context.Context, workspaceID, _ uuid.UUID, _ PatchInput) (*Settings, error) {
	r.gotPatchID = workspaceID
	if r.settings != nil {
		return r.settings, nil
	}
	return &Settings{TenantID: workspaceID}, nil
}

func ctxWithUser(subscriptionID uuid.UUID) context.Context {
	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: subscriptionID,
		Role:           "gadmin",
	}
	return auth.WithUserForTest(context.Background(), u)
}

// ─── 1. GET — handler resolves and passes the workspace_id, not the
//             subscription_id ────────────────────────────────────────────
func TestHandlerGet_ResolvesActiveWorkspaceFromSubscription(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()
	if subID == wsID {
		t.Fatal("test setup: subID and wsID must differ for the assertion to be meaningful")
	}

	rec := &recordingService{}
	resolver := &stubActiveResolver{mapping: map[uuid.UUID]uuid.UUID{subID: wsID}}
	h := newHandlerWithDeps(rec, resolver)

	req := httptest.NewRequest(http.MethodGet, "/_site/workspace-settings", nil).
		WithContext(ctxWithUser(subID))
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	if rec.gotGetID != wsID {
		t.Fatalf(
			"handler passed wrong ID to Svc.Get: got %s, want workspace_id %s (NOT subscription_id %s)",
			rec.gotGetID, wsID, subID,
		)
	}
	if rec.gotGetID == subID {
		t.Fatal(
			"REGRESSION (TD-WS-001): handler passed u.SubscriptionID to Svc.Get. " +
				"It MUST resolve via ActiveWorkspaceResolver first.",
		)
	}
}

// ─── 2. PATCH — same contract ─────────────────────────────────────────────
func TestHandlerPatch_ResolvesActiveWorkspaceFromSubscription(t *testing.T) {
	subID := uuid.New()
	wsID := uuid.New()

	rec := &recordingService{}
	resolver := &stubActiveResolver{mapping: map[uuid.UUID]uuid.UUID{subID: wsID}}
	h := newHandlerWithDeps(rec, resolver)

	body, _ := json.Marshal(map[string]any{"tenant_timezone": "Europe/Paris"})
	req := httptest.NewRequest(http.MethodPatch, "/_site/workspace-settings", bytes.NewReader(body)).
		WithContext(ctxWithUser(subID))
	w := httptest.NewRecorder()
	h.Patch(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	if rec.gotPatchID != wsID {
		t.Fatalf(
			"handler passed wrong ID to Svc.Patch: got %s, want workspace_id %s (NOT subscription_id %s)",
			rec.gotPatchID, wsID, subID,
		)
	}
}

// ─── 3. Resolver-not-found → 404, service never called ───────────────────
func TestHandlerGet_NoActiveWorkspace_ReturnsNotFound(t *testing.T) {
	subID := uuid.New()
	rec := &recordingService{}
	resolver := &stubActiveResolver{err: ErrNoActiveWorkspace}
	h := newHandlerWithDeps(rec, resolver)

	req := httptest.NewRequest(http.MethodGet, "/_site/workspace-settings", nil).
		WithContext(ctxWithUser(subID))
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when no active workspace, got %d", w.Code)
	}
	if rec.gotGetID != uuid.Nil {
		t.Fatalf("service must not be called when resolver fails; got Get(%s)", rec.gotGetID)
	}
}

// ─── 4. Resolver propagates non-ErrNoActiveWorkspace errors as 500 ────────
func TestHandlerGet_ResolverError_Returns500(t *testing.T) {
	subID := uuid.New()
	rec := &recordingService{}
	resolver := &stubActiveResolver{err: errors.New("db down")}
	h := newHandlerWithDeps(rec, resolver)

	req := httptest.NewRequest(http.MethodGet, "/_site/workspace-settings", nil).
		WithContext(ctxWithUser(subID))
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on resolver hard error, got %d", w.Code)
	}
	if rec.gotGetID != uuid.Nil {
		t.Fatalf("service must not be called when resolver errors; got Get(%s)", rec.gotGetID)
	}
}
