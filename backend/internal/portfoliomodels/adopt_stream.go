// SSE adopt stream — GET /api/portfolio-models/{id}/adopt/stream
//
// Card 00009. Wraps the orchestrator's StepHook in a buffered channel
// pump so the orchestrator never blocks on a slow client, while a
// goroutine drains the channel and writes Server-Sent Events to the
// HTTP response.
//
// Wire shape (one event per saga step boundary, plus a terminator):
//
//	event: step
//	data: {"index":0,"name":"validate","status":"ok"}
//	...
//	event: done
//	data: {"state_id":"…","status":"completed","adopted_at":"…"}
//
// On failure the last `step` carries `"status":"fail"` plus an
// `error_code`, followed by a terminating `fail` event with
// `{step,error_code,message}`.
//
// We emit only the {Phase:"end"} hook events. The UI only needs
// completion ticks per step; emitting starts too would double the
// chattiness with no extra information for the progress bar.
//
// Heartbeat: an SSE comment line (`: ping`) every 15s when no step
// event is in flight. Keeps reverse-proxy idle timers (nginx default
// 60s, Cloudflare 100s) from killing the connection during long
// mirror writes.
//
// Server WriteTimeout note (TD): `cmd/server/main.go` configures
// `http.Server{WriteTimeout: 30 * time.Second}` which is fatal to any
// SSE stream past 30s. We clear the per-connection write deadline via
// `http.ResponseController.SetWriteDeadline(time.Time{})` so this
// handler is unaffected. The global timeout itself is preexisting and
// out of scope to change here — flagged as TD-PMSSE-001 for follow-up
// (consider per-route timeouts or moving the hard cap into a separate
// long-poll/streaming subroute group).
//
// Cancellation: the request context is passed straight into Adopt. If
// the client disconnects, ctx is cancelled, the saga's library
// snapshot tx and any in-flight tenant tx are torn down by pgx — the
// orchestrator's existing failure path (markFailed + error_event) runs
// without further intervention from this handler.

package portfoliomodels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// streamHeartbeatInterval is the cadence for the `: ping` comment
// line. 15s is well under nginx's 60s default and Cloudflare's 100s.
// Tests override it via NewAdoptStreamHandlerWith.
const streamHeartbeatInterval = 15 * time.Second

// streamChannelBuffer caps the queue between the orchestrator's hook
// and the SSE writer goroutine. With 7 steps and only `end` events
// emitted, 16 leaves comfortable headroom and is the size mandated by
// the card brief.
const streamChannelBuffer = 16

// AdoptStreamHandler exposes the SSE variant of the adopt endpoint.
// Holds the same orchestrator the POST handler uses; gating is the
// padmin role check, applied by the router.
type AdoptStreamHandler struct {
	Orchestrator *Orchestrator
	heartbeat    time.Duration // override hook for tests
}

// NewAdoptStreamHandler constructs the SSE handler with production
// defaults. Tests use NewAdoptStreamHandlerWith to shorten the
// heartbeat interval.
func NewAdoptStreamHandler(orch *Orchestrator) *AdoptStreamHandler {
	return &AdoptStreamHandler{Orchestrator: orch, heartbeat: streamHeartbeatInterval}
}

// NewAdoptStreamHandlerWith lets tests dial the heartbeat down so a
// test can assert a `: ping` lands without sleeping 15s.
func NewAdoptStreamHandlerWith(orch *Orchestrator, heartbeat time.Duration) *AdoptStreamHandler {
	return &AdoptStreamHandler{Orchestrator: orch, heartbeat: heartbeat}
}

// streamMsg is the internal envelope queued from the hook to the
// writer goroutine. Either an `end` step event or — synthesized after
// Adopt returns — a terminator (kind="done" / "fail").
type streamMsg struct {
	kind     string    // "step" | "done" | "fail"
	index    int       // step index (kind=step only)
	name     string    // step name (kind=step only)
	stepErr  error     // non-nil on failed step
	result   *AdoptionResult
	failCode string // ADOPT_* code (kind=fail)
	failMsg  string // human message (kind=fail)
	failStep string // step name (kind=fail)
}

// Stream — GET /api/portfolio-models/{id}/adopt/stream
//
// Padmin gating runs ahead of this handler in the router. We re-check
// the user is present on the request because the chain may evolve.
func (h *AdoptStreamHandler) Stream(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	modelID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid model id", http.StatusBadRequest)
		return
	}

	// Cast to Flusher up front. chi over net/http always supplies one;
	// missing is a server bug, not a client error.
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Clear the per-connection write deadline so the global
	// http.Server.WriteTimeout (30s in main.go) does not kill the
	// stream mid-saga. ResponseController is the supported way to
	// reach the underlying conn deadline in Go 1.20+.
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Hint to nginx (and similar) not to buffer SSE — without this,
	// some proxies hold events until the response closes.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	requestID := middleware.GetReqID(r.Context())

	// Buffered channel between the orchestrator's hook (producer) and
	// this handler's writer loop (consumer). Producer never blocks:
	// if the channel is full we drop the event rather than stalling
	// the saga. With 7 steps and end-only events queued, drops are
	// theoretically impossible — the guard is defensive.
	ch := make(chan streamMsg, streamChannelBuffer)

	hook := func(ctx context.Context, ev StepEvent) {
		if ev.Phase != "end" {
			return // see file doc — `start` events are intentionally suppressed
		}
		select {
		case ch <- streamMsg{
			kind:    "step",
			index:   ev.Index,
			name:    ev.Name,
			stepErr: ev.Err,
		}:
		default:
			// Channel full. Better to lose a tick than block the saga.
		}
	}

	// Run Adopt in a goroutine so this handler can pump events as
	// they arrive. Capture the result/error once Adopt returns and
	// close the channel so the writer loop knows to flush the
	// terminator and exit.
	type adoptOutcome struct {
		res *AdoptionResult
		err error
	}
	outcome := make(chan adoptOutcome, 1)

	go func() {
		res, aerr := h.Orchestrator.Adopt(
			r.Context(),
			u.SubscriptionID, u.ID, modelID,
			requestID,
			AdoptOptions{Hook: hook, FailAtStep: adoptFailAtStepFromEnv()},
		)
		outcome <- adoptOutcome{res: res, err: aerr}
		close(ch)
	}()

	// Writer loop: heartbeat ticker + step events + terminator.
	heartbeat := time.NewTicker(h.heartbeat)
	defer heartbeat.Stop()

	stepCount := 0 // tracks how many step events were emitted

	for {
		select {
		case <-r.Context().Done():
			// Client gone. Adopt's context is the same context — it
			// will return shortly with a cancellation error. Drain
			// the outcome to avoid a goroutine leak, then exit.
			<-outcome
			return

		case <-heartbeat.C:
			// SSE comment line — clients ignore, proxies count it.
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()

		case msg, ok := <-ch:
			if !ok {
				// Channel closed: orchestrator has returned. Pull the
				// final result/error and emit the terminator.
				out := <-outcome
				// Idempotent-completed path: Adopt() returns immediately
				// when the saga already completed (same model). No hook
				// fires so stepCount == 0. Emit synthetic ok events for
				// all steps so the overlay can animate to completion.
				if out.err == nil && stepCount == 0 {
					for i, name := range stepOrder {
						writeStepEvent(w, flusher, streamMsg{
							kind:  "step",
							index: i,
							name:  name,
						})
					}
				}
				writeTerminator(w, flusher, out.res, out.err)
				return
			}
			writeStepEvent(w, flusher, msg)
			stepCount++
		}
	}
}

// writeStepEvent renders one `event: step` block. On a successful
// step `status:"ok"`. On a failed step we surface the ADOPT_* code so
// the UI can pick a user-message before the explicit `fail`
// terminator arrives.
func writeStepEvent(w http.ResponseWriter, flusher http.Flusher, msg streamMsg) {
	payload := map[string]any{
		"index": msg.index,
		"name":  msg.name,
	}
	if msg.stepErr != nil {
		payload["status"] = "fail"
		payload["error_code"] = stepErrorCode(msg.name, msg.stepErr)
	} else {
		payload["status"] = "ok"
	}
	body, _ := json.Marshal(payload)
	fmt.Fprintf(w, "event: step\ndata: %s\n\n", body)
	flusher.Flush()
}

// writeTerminator emits the final `done` (success) or `fail` (error)
// event. Closing the connection is the caller's job — we just stop
// writing.
func writeTerminator(w http.ResponseWriter, flusher http.Flusher, res *AdoptionResult, err error) {
	if err == nil && res != nil {
		body, _ := json.Marshal(map[string]any{
			"state_id":   res.StateID,
			"status":     res.Status,
			"adopted_at": res.AdoptedAt,
		})
		fmt.Fprintf(w, "event: done\ndata: %s\n\n", body)
		flusher.Flush()
		return
	}

	// Failure path. Translate the orchestrator's typed errors into a
	// {step, error_code, message} envelope. We mirror the POST
	// handler's mapping so codes stay consistent.
	step, code, message := classifyAdoptErr(err)
	body, _ := json.Marshal(map[string]any{
		"step":       step,
		"error_code": code,
		"message":    message,
	})
	fmt.Fprintf(w, "event: fail\ndata: %s\n\n", body)
	flusher.Flush()
}

// stepErrorCode picks the ADOPT_* code for a step-level failure.
// Mirrors the orchestrator's mirrorErrCode for mirror steps; the rest
// (validate / finalize / sim-injected) collapse onto ADOPT_INTERNAL
// per the seed in db/library_schema/008_error_codes.sql.
func stepErrorCode(stepName string, stepErr error) string {
	// Sentinel: bundle-not-found surfaced from validate.
	var aerr adoptionError
	if errors.As(stepErr, &aerr) && aerr.Code != "" {
		return aerr.Code
	}
	switch stepName {
	case stepLayers:
		return codeAdoptStepFailLayers
	default:
		return codeAdoptInternal
	}
}

// classifyAdoptErr is the SSE counterpart to writeAdoptErr. Returns
// (step, code, message) for the `fail` terminator.
func classifyAdoptErr(err error) (string, string, string) {
	if err == nil {
		return "", codeAdoptInternal, "unknown failure"
	}

	var (
		alreadyAdopted errAlreadyAdopted
		inFlight       errInFlight
		aerr           adoptionError
	)

	switch {
	case errors.As(err, &alreadyAdopted):
		return "", "ADOPT_ALREADY_ADOPTED", err.Error()
	case errors.As(err, &inFlight):
		return "", "ADOPT_IN_FLIGHT", err.Error()
	case errors.As(err, &aerr):
		return aerr.Step, aerr.Code, err.Error()
	default:
		return "", codeAdoptInternal, err.Error()
	}
}
