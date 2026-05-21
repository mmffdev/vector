package notifications

import (
	"fmt"
	"net/http"
	"time"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/realtime"
)

// StreamHandler exposes GET /notifications/stream as a Server-Sent
// Events endpoint. Subscribes to the realtime hub's per-user topic
// (notifications:<user_id>) and forwards each Publish as one SSE
// `data:` line.
//
// Why SSE not WebSocket: this is one-way (server → client) and
// browsers handle SSE auto-reconnect natively (EventSource). The
// existing WebSocket pipe carries bidirectional rank/topology flow;
// notifications don't need that.
//
// Heartbeat: a comment line every 25s keeps proxies (some load
// balancers idle out at 30s) and the EventSource alive.
type StreamHandler struct {
	hub *realtime.Hub
}

func NewStreamHandler(hub *realtime.Hub) *StreamHandler {
	return &StreamHandler{hub: hub}
}

func (h *StreamHandler) Stream(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// SSE requires a flusher; bail loudly if the runtime doesn't
	// support it (shouldn't happen behind chi but worth the guard).
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if it ever sits in front
	w.WriteHeader(http.StatusOK)

	// Initial comment line so the client knows the connection is open.
	_, _ = fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	// Buffered channel — Hub publishes drop on a full buffer rather
	// than blocking. 32 is plenty for the per-user topic; a user
	// rarely receives more than one notification per second.
	ch := make(chan []byte, 32)
	topic := fmt.Sprintf("notifications:%s", user.ID.String())
	h.hub.SubscribeWriter(topic, ch)
	defer h.hub.UnsubscribeWriter(topic, ch)

	ctx := r.Context()
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprintf(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case payload, ok := <-ch:
			if !ok {
				return
			}
			// SSE format: `data: <json>\n\n`. The payload is already
			// JSON-encoded by the SSE dispatcher; we just frame it.
			if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

