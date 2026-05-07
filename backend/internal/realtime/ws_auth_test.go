package realtime_test

// PLA-0010 / story 00346 — WebSocket auth gate.
//
// /ws is wrapped in auth.Service.RequireAuth in main.go (commit
// c42d044). RequireAuth accepts the token via the Authorization
// header OR a ?access_token= query param so browsers can authenticate
// the WS upgrade (browsers cannot set headers on the upgrade).
//
// These three subtests exercise the gate end-to-end through chi:
//   1. NoToken         — neither header nor query param → 401
//   2. InvalidToken    — bad JWT in query param         → 401
//   3. ValidUserCtx    — auth.WithUserForTest seeds the user, the
//                        upgrade completes (HTTP 101), proving that
//                        ServeWS hands off to coder/websocket once
//                        UserFromCtx returns a real user.
//
// We don't sign a real JWT for the success path because that would
// require the JWT secret + a DB-backed FindUserByID; the auth
// package already covers that. This test only asserts the gating
// contract that ServeWS depends on.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/realtime"
)

// newGatedServer mounts /ws behind the real auth middleware. Pool is
// nil — rejection paths short-circuit before FindUserByID is reached.
func newGatedServer(t *testing.T) *httptest.Server {
	t.Helper()
	hub := realtime.NewHub()
	svc := &auth.Service{}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(svc.RequireAuth)
		r.Get("/ws", realtime.ServeWS(hub))
	})
	return httptest.NewServer(r)
}

func TestWS_NoToken_Rejects401(t *testing.T) {
	srv := newGatedServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/ws")
	if err != nil {
		t.Fatalf("GET /ws: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", resp.StatusCode)
	}
}

func TestWS_InvalidToken_Rejects401(t *testing.T) {
	srv := newGatedServer(t)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/ws?access_token=not-a-valid-jwt")
	if err != nil {
		t.Fatalf("GET /ws: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", resp.StatusCode)
	}
}

// TestWS_ValidUserContext_UpgradeSucceeds skips the JWT path and
// seeds the user directly via auth.WithUserForTest, then mounts
// ServeWS without RequireAuth. This proves ServeWS upgrades the
// connection when UserFromCtx returns a user — the contract the
// middleware enforces.
func TestWS_ValidUserContext_UpgradeSucceeds(t *testing.T) {
	hub := realtime.NewHub()
	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@mmffdev.com",
		IsActive:       true,
	}

	r := chi.NewRouter()
	r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
		ctx := auth.WithUserForTest(req.Context(), user)
		realtime.ServeWS(hub).ServeHTTP(w, req.WithContext(ctx))
	})
	srv := httptest.NewServer(r)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	conn.Close(websocket.StatusNormalClosure, "")
}
