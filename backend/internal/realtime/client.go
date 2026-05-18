package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// Client is one open WebSocket connection. The send channel is the
// only path the hub uses to deliver messages; the read pump translates
// inbound subscribe/unsubscribe frames into Hub calls.
type Client struct {
	conn           *websocket.Conn
	subscriptionID uuid.UUID
	send           chan []byte
}

// inboundFrame is the wire shape clients send. We accept either
//
//	{"subscribe": "rank:work_item:<sub>:<scope>:<scope_id>"}
//	{"unsubscribe": "<topic>"}
//
// Anything else is ignored — the server is intentionally permissive
// because clients self-describe their subscriptions.
type inboundFrame struct {
	Subscribe   string `json:"subscribe,omitempty"`
	Unsubscribe string `json:"unsubscribe,omitempty"`
}

// Heartbeat cadence. Server pings every 20s and treats no pong within
// 10s as a dead connection. Clients should not need to ping.
const (
	pingPeriod   = 20 * time.Second
	pongTimeout  = 10 * time.Second
	writeTimeout = 5 * time.Second
)

// ServeWS upgrades the request to a WebSocket and runs read+write
// pumps until the client disconnects or the server drains.
//
// Auth: caller must have run auth.RequireAuth so UserFromCtx returns
// a valid user. The connection is bound to that user's
// SubscriptionID; topic strings are validated against it before
// every Subscribe so a client cannot listen on another tenant.
//
// Session enforcement (B16.8.12): when the issuing access token
// carried a `sid` claim (every fresh token post-B16.8.11 step 2),
// RequireAuth surfaces it via auth.SessionIDFromCtx. We register
// {sid, user_id, close_fn} with hub.Registry() so the sweeper (or
// the immediate-close path) can tear this connection down when the
// users_sessions row is revoked or goes idle. Legacy/grace-window
// tokens with no sid (uuid.Nil) skip registration — they already
// 401 on the next refresh via REQUIRE_SID_CLAIM once Rick flips it.
//
// Origin: PLA-0010 / story 00354. The previous version set
// AcceptOptions.InsecureSkipVerify=true with a comment claiming chi
// CORS already validated Origin upstream — that was wrong. chi's
// cors.Handler only sets response headers and handles preflight; it
// does NOT reject WebSocket Upgrade requests with foreign Origins, so
// any third-party page could open an authenticated WS to this server
// (CSWSH). We now populate OriginPatterns from FRONTEND_ORIGIN — the
// same env that gates HTTP CORS — so coder/websocket performs the
// Origin host check itself.
func ServeWS(hub *Hub) http.HandlerFunc {
	originPatterns := wsOriginPatterns()
	return func(w http.ResponseWriter, r *http.Request) {
		u := auth.UserFromCtx(r.Context())
		if u == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: originPatterns,
		})
		if err != nil {
			return
		}

		c := &Client{
			conn:           conn,
			subscriptionID: u.SubscriptionID,
			send:           make(chan []byte, 64),
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		defer hub.UnsubscribeAll(c)

		// gateClose ensures the FIRST Close to fire is the one that
		// reaches the wire. Without this gate, the deferred fallback
		// below races the immediate-close hook below it: under load,
		// the deferred Close(StatusNormalClosure) can overwrite an
		// in-flight 4001/4002 frame, the client sees code 1000, and
		// the frontend wsClose handler never triggers hardLogout
		// (review of B16.8.12 commit chain d32ebd9..9ac876f).
		gateClose := newCloseOnce(conn)
		defer gateClose.Close(websocket.StatusNormalClosure, "")

		// Register with the session registry so the sweeper / immediate-
		// close path can evict this connection. The close hook fires
		// the gated close (a no-op if the deferred fallback already
		// won, which is the right behaviour: closeOnce preserves the
		// first wire-observable code) then cancels the pump context to
		// unblock the read loop.
		sid := auth.SessionIDFromCtx(r.Context())
		if sid != uuid.Nil && hub.Registry() != nil {
			registry := hub.Registry()
			closeFn := func(code websocket.StatusCode, reason string) {
				_ = gateClose.Close(code, reason)
				cancel()
			}
			registry.Register(sid, u.ID, closeFn)
			defer registry.Deregister(sid)
		}

		go c.writePump(ctx)
		c.readPump(ctx, hub)
	}
}

func (c *Client) readPump(ctx context.Context, hub *Hub) {
	for {
		_, data, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		var f inboundFrame
		if err := json.Unmarshal(data, &f); err != nil {
			continue
		}
		if f.Subscribe != "" && c.topicAllowed(f.Subscribe) {
			hub.Subscribe(f.Subscribe, c)
		}
		if f.Unsubscribe != "" {
			hub.Unsubscribe(f.Unsubscribe, c)
		}
	}
}

func (c *Client) writePump(ctx context.Context) {
	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, pongTimeout)
			err := c.conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// topicAllowed enforces tenant isolation. Topics carry the subscriber's
// subscription_id as the third colon-separated segment; we require it
// to match the connection's bound subscription_id.
func (c *Client) topicAllowed(topic string) bool {
	want := c.subscriptionID.String()
	// rank:work_item:<sub>:<scope>:<scope_id>
	parts := splitN(topic, ':', 5)
	if len(parts) < 3 {
		return false
	}
	return parts[2] == want
}

// splitN is a tiny helper because strings.SplitN allocates more than
// we want for a hot path. Returns up to n segments.
func splitN(s string, sep byte, n int) []string {
	out := make([]string, 0, n)
	start := 0
	for i := 0; i < len(s) && len(out) < n-1; i++ {
		if s[i] == sep {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}

// wsOriginPatterns returns the host patterns coder/websocket honours
// as authorized Origin values. We reuse FRONTEND_ORIGIN — the same env
// that drives HTTP CORS in main.go — so the WS surface and the HTTP
// surface stay aligned. The library matches against the Origin
// header's host (port stripped) using glob patterns; an empty slice
// means same-origin only, which is the secure fallback when
// FRONTEND_ORIGIN is unset or unparseable.
func wsOriginPatterns() []string {
	raw := os.Getenv("FRONTEND_ORIGIN")
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil
	}
	return []string{u.Hostname()}
}

// Errors used by tests.
var ErrClosed = errors.New("realtime: client closed")
