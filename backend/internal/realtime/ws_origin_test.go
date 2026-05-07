package realtime_test

// PLA-0010 / story 00354 — WebSocket Origin gate.
//
// The previous Accept call passed InsecureSkipVerify=true with a
// comment claiming chi CORS already validated Origin upstream. That
// was wrong: cors.Handler does not reject WebSocket Upgrade requests
// with foreign Origin headers, so any third-party page could mount a
// CSWSH (Cross-Site WebSocket Hijacking) attack against an
// authenticated user. ServeWS now passes OriginPatterns derived from
// FRONTEND_ORIGIN; coder/websocket rejects the Upgrade with 403 when
// the Origin host does not match.

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

func newOriginGatedServer(t *testing.T, user *models.User) *httptest.Server {
	t.Helper()
	hub := realtime.NewHub()
	r := chi.NewRouter()
	r.Get("/ws", func(w http.ResponseWriter, req *http.Request) {
		ctx := auth.WithUserForTest(req.Context(), user)
		realtime.ServeWS(hub).ServeHTTP(w, req.WithContext(ctx))
	})
	return httptest.NewServer(r)
}

func TestWS_ForeignOrigin_Rejected(t *testing.T) {
	t.Setenv("FRONTEND_ORIGIN", "http://app.example.com")

	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@mmffdev.com",
		IsActive:       true,
	}
	srv := newOriginGatedServer(t, user)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://attacker.example.com"}},
	})
	if err == nil {
		t.Fatal("expected dial to fail when Origin host is not in FRONTEND_ORIGIN")
	}
}

func TestWS_AllowedOrigin_Accepted(t *testing.T) {
	t.Setenv("FRONTEND_ORIGIN", "http://app.example.com")

	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@mmffdev.com",
		IsActive:       true,
	}
	srv := newOriginGatedServer(t, user)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://app.example.com"}},
	})
	if err != nil {
		t.Fatalf("expected dial to succeed for whitelisted origin: %v", err)
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

// TestWS_FrontendOriginUnset_SameOriginOnly proves the secure default:
// when FRONTEND_ORIGIN is unset, only same-origin Upgrade requests are
// accepted (the library's built-in fallback when OriginPatterns is
// nil). Any explicit cross-origin Origin header is rejected.
func TestWS_FrontendOriginUnset_SameOriginOnly(t *testing.T) {
	t.Setenv("FRONTEND_ORIGIN", "")

	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "test@mmffdev.com",
		IsActive:       true,
	}
	srv := newOriginGatedServer(t, user)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://attacker.example.com"}},
	})
	if err == nil {
		t.Fatal("expected dial to fail when FRONTEND_ORIGIN unset and Origin is foreign")
	}
}
