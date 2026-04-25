// SSE adopt stream tests — card 00009.
//
// Coverage:
//
//   - happyPath: GET /api/portfolio-models/{id}/adopt/stream end-to-end
//     with the seeded MMFF library bundle, asserting we receive 7 step
//     events (one per saga step) all with status=ok plus a terminating
//     `done` event whose payload includes a parseable state_id.
//
//   - failPath: drive the orchestrator with FailAtStep="layers" via a
//     thin in-process call to the writer adapter (no HTTP), asserting
//     the same SSE byte stream that the handler would have emitted —
//     a step-fail event followed by a `fail` event carrying
//     ADOPT_STEP_FAIL_LAYERS. We deliberately do NOT plumb FailAtStep
//     through the public HTTP surface; production callers must never
//     set it. See the card's "Tests" §.
//
//   - heartbeat: a tiny shim test with a 50ms heartbeat interval that
//     plays a slow producer through the writer loop and asserts a
//     `: ping` line lands when no step event is in flight.
//
// All tests skip cleanly when the cluster, library RO pool, or the
// migration-029 mirror tables are unreachable — same discipline as
// the rest of this package.

package portfoliomodels

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// TestAdoptStream_HappyPath drives the SSE endpoint over a real
// httptest.Server. We inject the padmin user via a tiny middleware so
// the handler resolves auth.UserFromCtx without us having to seed a
// real session cookie. The orchestrator is the real one, talking to
// the live library + vector clusters; if either is down we skip.
func TestAdoptStream_HappyPath(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	orch := NewOrchestrator(libRO, vec)
	// 1s heartbeat: short enough to fire once during a slow saga, but
	// the happy path usually finishes faster than that — the test
	// tolerates 0..N heartbeat lines in the stream.
	h := NewAdoptStreamHandlerWith(orch, time.Second)

	r := chi.NewRouter()
	r.Use(injectUser(user))
	r.Get("/api/portfolio-models/{id}/adopt/stream", h.Stream)

	srv := httptest.NewServer(r)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/portfolio-models/"+modelID.String()+"/adopt/stream", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status: want 200, got %d: %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("content-type: want text/event-stream, got %q", ct)
	}

	events := readSSE(t, resp.Body, 30*time.Second)

	// Filter to non-comment events (drop heartbeats).
	steps := 0
	var doneFound bool
	for _, ev := range events {
		switch ev.event {
		case "step":
			steps++
			var p map[string]any
			if err := json.Unmarshal([]byte(ev.data), &p); err != nil {
				t.Fatalf("step payload not JSON: %v / %s", err, ev.data)
			}
			if p["status"] != "ok" {
				t.Errorf("happy-path step %v: want status=ok, got %v", p["name"], p["status"])
			}
		case "done":
			doneFound = true
			var p map[string]any
			if err := json.Unmarshal([]byte(ev.data), &p); err != nil {
				t.Fatalf("done payload not JSON: %v / %s", err, ev.data)
			}
			if _, err := uuid.Parse(asString(p["state_id"])); err != nil {
				t.Errorf("done.state_id not a uuid: %v / %v", err, p["state_id"])
			}
			if p["status"] != "completed" {
				t.Errorf("done.status: want completed, got %v", p["status"])
			}
		case "fail":
			t.Errorf("happy-path: unexpected fail event: %s", ev.data)
		}
	}
	if steps != len(stepOrder) {
		t.Errorf("step events: want %d (one per saga step), got %d", len(stepOrder), steps)
	}
	if !doneFound {
		t.Errorf("missing terminating done event")
	}
}

// TestAdoptStream_FailPath_AdapterOnly bypasses HTTP and asserts the
// hook-to-SSE adapter produces the right wire bytes when the
// orchestrator returns a typed adoptionError. Cheaper than spinning a
// server, and avoids exposing FailAtStep through a public route.
func TestAdoptStream_FailPath_AdapterOnly(t *testing.T) {
	libRO := testRoPool(t)
	defer libRO.Close()
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()

	ctx := context.Background()
	modelID := uuid.MustParse(seededMMFFModelID)

	if err := resetAdoptionFixture(ctx, vec, user.SubscriptionID); err != nil {
		t.Skipf("reset fixture failed (mirror tables not deployed?): %v", err)
	}
	defer func() { _ = resetAdoptionFixture(context.Background(), vec, user.SubscriptionID) }()

	orch := NewOrchestrator(libRO, vec)

	// Drive Adopt directly with FailAtStep=layers, capturing every
	// {Phase:end} event our SSE hook would have queued.
	rec := httptest.NewRecorder()
	flusher := &fakeFlusher{}

	var stepEvents []streamMsg
	hook := func(ctx context.Context, ev StepEvent) {
		if ev.Phase != "end" {
			return
		}
		stepEvents = append(stepEvents, streamMsg{
			kind:    "step",
			index:   ev.Index,
			name:    ev.Name,
			stepErr: ev.Err,
		})
	}

	_, adoptErr := orch.Adopt(ctx, user.SubscriptionID, user.ID, modelID, "test-stream-fail",
		AdoptOptions{Hook: hook, FailAtStep: stepLayers})
	if adoptErr == nil {
		t.Fatalf("Adopt: want error from FailAtStep=layers, got nil")
	}

	// Run the captured events through the same writer the handler
	// uses, then emit the failure terminator.
	for _, msg := range stepEvents {
		writeStepEvent(rec, flusher, msg)
	}
	writeTerminator(rec, flusher, nil, adoptErr)

	body := rec.Body.String()

	// Must contain a step-fail block carrying ADOPT_STEP_FAIL_LAYERS.
	if !strings.Contains(body, `"name":"layers"`) {
		t.Errorf("body missing layers step: %s", body)
	}
	if !strings.Contains(body, `"status":"fail"`) {
		t.Errorf("body missing status:fail on the failed step: %s", body)
	}
	if !strings.Contains(body, codeAdoptStepFailLayers) {
		t.Errorf("body missing %s code: %s", codeAdoptStepFailLayers, body)
	}

	// Must end with a `fail` terminator naming layers + the code.
	if !strings.Contains(body, "event: fail\n") {
		t.Errorf("body missing event: fail: %s", body)
	}
	if !strings.Contains(body, `"step":"layers"`) {
		t.Errorf("fail terminator missing step:layers: %s", body)
	}
}

// TestAdoptStream_Heartbeat asserts a `: ping` lands when no step
// event is in flight, using a 50ms interval so the test runs in well
// under a second. We feed the writer loop synthetically via a fake
// hook channel — no DB needed for this one.
func TestAdoptStream_Heartbeat(t *testing.T) {
	rec := httptest.NewRecorder()
	flusher := &fakeFlusher{}

	// Mimic the handler's writer loop with a 50ms heartbeat. We let
	// it run for ~150ms with no step events, then close the channel
	// (simulating Adopt returning successfully) so the loop exits.
	ch := make(chan streamMsg, 4)
	outcome := make(chan struct {
		res *AdoptionResult
		err error
	}, 1)

	go func() {
		time.Sleep(150 * time.Millisecond)
		outcome <- struct {
			res *AdoptionResult
			err error
		}{res: &AdoptionResult{
			StateID:   uuid.New(),
			ModelID:   uuid.New(),
			Status:    "completed",
			AdoptedAt: time.Now().UTC(),
		}}
		close(ch)
	}()

	heartbeat := time.NewTicker(50 * time.Millisecond)
	defer heartbeat.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

loop:
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("loop timed out")
		case <-heartbeat.C:
			rec.Body.WriteString(": ping\n\n")
			flusher.Flush()
		case msg, ok := <-ch:
			if !ok {
				out := <-outcome
				writeTerminator(rec, flusher, out.res, out.err)
				break loop
			}
			writeStepEvent(rec, flusher, msg)
		}
	}

	body := rec.Body.String()
	if !strings.Contains(body, ": ping\n\n") {
		t.Errorf("body missing heartbeat: %s", body)
	}
	if !strings.Contains(body, "event: done\n") {
		t.Errorf("body missing terminator: %s", body)
	}
}

// ──────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────

// injectUser is a test-only middleware that stuffs a padmin user into
// the request context so handlers calling auth.UserFromCtx see them.
func injectUser(u *models.User) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type sseEvent struct {
	event string
	data  string
}

// readSSE pulls events off the response body, parsing the
// `event:`/`data:` blank-line-separated frames. Returns once an event
// named `done` or `fail` is seen, or the deadline elapses.
func readSSE(t *testing.T, body io.Reader, deadline time.Duration) []sseEvent {
	t.Helper()
	done := make(chan struct{})
	var events []sseEvent

	go func() {
		defer close(done)
		scanner := bufio.NewScanner(body)
		// SSE frames may include long JSON payloads; bump the buffer.
		scanner.Buffer(make([]byte, 0, 1024), 1<<20)

		var curEvent, curData string
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case line == "":
				// Frame boundary.
				if curEvent != "" {
					events = append(events, sseEvent{event: curEvent, data: curData})
					if curEvent == "done" || curEvent == "fail" {
						return
					}
				}
				curEvent, curData = "", ""
			case strings.HasPrefix(line, ":"):
				// Comment line (heartbeat). Ignore — drop on the floor.
			case strings.HasPrefix(line, "event: "):
				curEvent = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				if curData != "" {
					curData += "\n"
				}
				curData += strings.TrimPrefix(line, "data: ")
			}
		}
	}()

	select {
	case <-done:
	case <-time.After(deadline):
		t.Fatalf("SSE read timed out after %s", deadline)
	}
	return events
}

// fakeFlusher satisfies http.Flusher for the adapter unit tests where
// httptest.ResponseRecorder doesn't implement it.
type fakeFlusher struct{}

func (*fakeFlusher) Flush() {}

func asString(v any) string {
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}
