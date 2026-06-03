package dependencies

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// fakeService implements serviceIface for handler tests. Behaviour is
// pinned per-call via the override functions; nil overrides return
// (zero, errors.New("not configured")) so a forgotten setup surfaces
// as a 500 in the response rather than a silent pass.
type fakeService struct {
	createFn     func(ctx context.Context, in CreateMapInput) (Map, error)
	renameFn     func(ctx context.Context, id uuid.UUID, in RenameMapInput) (Map, error)
	archiveFn    func(ctx context.Context, id uuid.UUID) (Map, error)
	getFn        func(ctx context.Context, id uuid.UUID) (Map, error)
	createEdgeFn func(ctx context.Context, in CreateEdgeInput) (Edge, error)
}

func (f *fakeService) CreateMap(ctx context.Context, in CreateMapInput) (Map, error) {
	if f.createFn == nil {
		return Map{}, errors.New("CreateMap not configured")
	}
	return f.createFn(ctx, in)
}

func (f *fakeService) RenameMap(ctx context.Context, id uuid.UUID, in RenameMapInput) (Map, error) {
	if f.renameFn == nil {
		return Map{}, errors.New("RenameMap not configured")
	}
	return f.renameFn(ctx, id, in)
}

func (f *fakeService) ArchiveMap(ctx context.Context, id uuid.UUID) (Map, error) {
	if f.archiveFn == nil {
		return Map{}, errors.New("ArchiveMap not configured")
	}
	return f.archiveFn(ctx, id)
}

func (f *fakeService) GetMap(ctx context.Context, id uuid.UUID) (Map, error) {
	if f.getFn == nil {
		return Map{}, errors.New("GetMap not configured")
	}
	return f.getFn(ctx, id)
}

func (f *fakeService) CreateEdge(ctx context.Context, in CreateEdgeInput) (Edge, error) {
	if f.createEdgeFn == nil {
		return Edge{}, errors.New("CreateEdge not configured")
	}
	return f.createEdgeFn(ctx, in)
}

// mountForTest wires the handler under /_site/dependencies on a chi
// router and returns the router. Tests call router.ServeHTTP directly
// against an httptest.NewRecorder so the request context (carrying
// the test-injected auth user) crosses no network boundary.
func mountForTest(svc serviceIface) chi.Router {
	h := newHandlerWithIface(svc)
	r := chi.NewRouter()
	r.Route("/_site/dependencies", h.Mount)
	return r
}

// authedReq builds an in-process request whose context carries an
// authenticated user. role is one of the canonical project roles
// ("user", "padmin", "gadmin") — the role string itself doesn't gate
// map CRUD (topology scope does), but it's threaded through so
// allow/deny matrix tests can show each role with each scope combo.
func authedReq(t *testing.T, method, path, role string, body any) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("json.Marshal: %v", err)
		}
		reader = bytes.NewReader(buf)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	u := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		WorkspaceID:    uuid.New(),
		Role:           roletypes.Role(role),
	}
	return req.WithContext(auth.WithUserForTest(req.Context(), u))
}

// run drives the router with the given request and returns the
// recorded status + body. Context is preserved across the call.
func run(r chi.Router, req *http.Request) (int, []byte) {
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code, rec.Body.Bytes()
}

// ─────────────────────────────────────────────────────────────────
// Unauthenticated — every endpoint returns 401 (no service call).
// ─────────────────────────────────────────────────────────────────

func TestMapEndpoints_Unauthenticated(t *testing.T) {
	t.Parallel()
	svc := &fakeService{} // every method returns errors.New("not configured")
	srv := mountForTest(svc)

	cases := []struct {
		name, method, path string
		body               any
	}{
		{"create", http.MethodPost, "/_site/dependencies/maps", CreateMapInput{Name: "n"}},
		{"rename", http.MethodPatch, "/_site/dependencies/maps/" + uuid.New().String(), RenameMapInput{Name: "n"}},
		{"archive", http.MethodPost, "/_site/dependencies/maps/" + uuid.New().String() + "/archive", nil},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			var buf io.Reader
			if c.body != nil {
				b, _ := json.Marshal(c.body)
				buf = bytes.NewReader(b)
			}
			req, err := http.NewRequest(c.method, c.path, buf)
			if err != nil {
				t.Fatalf("NewRequest: %v", err)
			}
			if c.body != nil {
				req.Header.Set("Content-Type", "application/json")
			}
			// No auth context — handler should reject before calling svc.
			status, _ := run(srv, req)
			if status != http.StatusUnauthorized {
				t.Fatalf("%s: status = %d, want 401", c.name, status)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────
// CreateMap — allow/deny matrix.
// ─────────────────────────────────────────────────────────────────

func TestCreateMap_AllowDenyMatrix(t *testing.T) {
	t.Parallel()
	now := mustParse("2026-06-03T00:00:00Z")

	for _, role := range []string{"user", "padmin", "gadmin"} {
		role := role
		t.Run("allow_"+role, func(t *testing.T) {
			t.Parallel()
			wantID := uuid.New()
			svc := &fakeService{
				createFn: func(ctx context.Context, in CreateMapInput) (Map, error) {
					return Map{
						ID:             wantID,
						SubscriptionID: uuid.New(),
						WorkspaceID:    uuid.New(),
						TopologyNodeID: in.TopologyNodeID,
						Name:           in.Name,
						CreatedAt:      now,
						UpdatedAt:      now,
					}, nil
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPost, "/_site/dependencies/maps", role,
				CreateMapInput{TopologyNodeID: uuid.New(), Name: "Q3 release"})
			status, body := run(srv, req)
			if status != http.StatusCreated {
				t.Fatalf("status = %d, want 201; body=%s", status, body)
			}
			var got Map
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("decode: %v; body=%s", err, body)
			}
			if got.ID != wantID {
				t.Errorf("id = %s, want %s", got.ID, wantID)
			}
		})

		t.Run("deny_out_of_scope_"+role, func(t *testing.T) {
			t.Parallel()
			svc := &fakeService{
				createFn: func(ctx context.Context, in CreateMapInput) (Map, error) {
					return Map{}, ErrEndpointNotInScope
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPost, "/_site/dependencies/maps", role,
				CreateMapInput{TopologyNodeID: uuid.New(), Name: "X"})
			status, _ := run(srv, req)
			if status != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", status)
			}
		})
	}
}

func TestCreateMap_InvalidBody(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		createFn: func(ctx context.Context, in CreateMapInput) (Map, error) {
			return Map{}, ErrInvalidInput
		},
	}
	srv := mountForTest(svc)

	// Bad JSON — handler rejects before reaching the service.
	req := authedReq(t, http.MethodPost, "/_site/dependencies/maps", "user", nil)
	req.Body = io.NopCloser(strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	status, _ := run(srv, req)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("bad-json status = %d, want 422", status)
	}

	// Service returns ErrInvalidInput — handler maps to 422.
	req = authedReq(t, http.MethodPost, "/_site/dependencies/maps", "user",
		CreateMapInput{TopologyNodeID: uuid.New(), Name: ""})
	status, _ = run(srv, req)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("empty-name status = %d, want 422", status)
	}
}

// ─────────────────────────────────────────────────────────────────
// RenameMap — allow/deny + edge cases.
// ─────────────────────────────────────────────────────────────────

func TestRenameMap_AllowDenyMatrix(t *testing.T) {
	t.Parallel()
	for _, role := range []string{"user", "padmin", "gadmin"} {
		role := role
		t.Run("allow_"+role, func(t *testing.T) {
			t.Parallel()
			wantID := uuid.New()
			svc := &fakeService{
				renameFn: func(ctx context.Context, id uuid.UUID, in RenameMapInput) (Map, error) {
					if id != wantID {
						return Map{}, ErrNotFound
					}
					return Map{ID: id, Name: in.Name}, nil
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPatch, "/_site/dependencies/maps/"+wantID.String(),
				role, RenameMapInput{Name: "renamed"})
			status, body := run(srv, req)
			if status != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", status, body)
			}
			var got Map
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.Name != "renamed" {
				t.Errorf("name = %q, want %q", got.Name, "renamed")
			}
		})

		t.Run("deny_out_of_scope_"+role, func(t *testing.T) {
			t.Parallel()
			svc := &fakeService{
				renameFn: func(ctx context.Context, id uuid.UUID, in RenameMapInput) (Map, error) {
					return Map{}, ErrEndpointNotInScope
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPatch, "/_site/dependencies/maps/"+uuid.New().String(),
				role, RenameMapInput{Name: "x"})
			status, _ := run(srv, req)
			if status != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", status)
			}
		})
	}
}

func TestRenameMap_NotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		renameFn: func(ctx context.Context, id uuid.UUID, in RenameMapInput) (Map, error) {
			return Map{}, ErrNotFound
		},
	}
	srv := mountForTest(svc)
	req := authedReq(t, http.MethodPatch, "/_site/dependencies/maps/"+uuid.New().String(),
		"user", RenameMapInput{Name: "x"})
	status, _ := run(srv, req)
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
}

func TestRenameMap_BadID(t *testing.T) {
	t.Parallel()
	svc := &fakeService{}
	srv := mountForTest(svc)
	req := authedReq(t, http.MethodPatch, "/_site/dependencies/maps/not-a-uuid",
		"user", RenameMapInput{Name: "x"})
	status, _ := run(srv, req)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", status)
	}
}

// ─────────────────────────────────────────────────────────────────
// ArchiveMap — idempotent + allow/deny.
// ─────────────────────────────────────────────────────────────────

func TestArchiveMap_AllowDenyMatrix(t *testing.T) {
	t.Parallel()
	for _, role := range []string{"user", "padmin", "gadmin"} {
		role := role
		t.Run("allow_"+role, func(t *testing.T) {
			t.Parallel()
			now := mustParse("2026-06-03T00:00:00Z")
			id := uuid.New()
			svc := &fakeService{
				archiveFn: func(ctx context.Context, mid uuid.UUID) (Map, error) {
					return Map{ID: mid, ArchivedAt: &now}, nil
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPost, "/_site/dependencies/maps/"+id.String()+"/archive",
				role, nil)
			status, body := run(srv, req)
			if status != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", status, body)
			}
			var got Map
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.ArchivedAt == nil {
				t.Error("expected archived_at set in response")
			}
		})

		t.Run("deny_out_of_scope_"+role, func(t *testing.T) {
			t.Parallel()
			svc := &fakeService{
				archiveFn: func(ctx context.Context, mid uuid.UUID) (Map, error) {
					return Map{}, ErrEndpointNotInScope
				},
			}
			srv := mountForTest(svc)
			req := authedReq(t, http.MethodPost, "/_site/dependencies/maps/"+uuid.New().String()+"/archive",
				role, nil)
			status, _ := run(srv, req)
			if status != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", status)
			}
		})
	}
}

func TestArchiveMap_Idempotent(t *testing.T) {
	t.Parallel()
	now := mustParse("2026-06-03T00:00:00Z")
	id := uuid.New()
	calls := 0
	svc := &fakeService{
		archiveFn: func(ctx context.Context, mid uuid.UUID) (Map, error) {
			calls++
			// Second call is the idempotent re-archive — service still
			// returns the row with archived_at set; handler returns 200.
			return Map{ID: mid, ArchivedAt: &now}, nil
		},
	}
	srv := mountForTest(svc)
	for i := 0; i < 2; i++ {
		req := authedReq(t, http.MethodPost, "/_site/dependencies/maps/"+id.String()+"/archive",
			"user", nil)
		status, _ := run(srv, req)
		if status != http.StatusOK {
			t.Fatalf("call %d: status = %d, want 200", i+1, status)
		}
	}
	if calls != 2 {
		t.Errorf("calls = %d, want 2", calls)
	}
}

func TestArchiveMap_NotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeService{
		archiveFn: func(ctx context.Context, mid uuid.UUID) (Map, error) {
			return Map{}, ErrNotFound
		},
	}
	srv := mountForTest(svc)
	req := authedReq(t, http.MethodPost, "/_site/dependencies/maps/"+uuid.New().String()+"/archive",
		"user", nil)
	status, _ := run(srv, req)
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
}

// ─────────────────────────────────────────────────────────────────
// CreateEdge — handler-level error mapping.
// ─────────────────────────────────────────────────────────────────

func TestCreateEdge_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv := mountForTest(&fakeService{})
	req := httptest.NewRequest(http.MethodPost, "/_site/dependencies/edges", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	status, _ := run(srv, req)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", status)
	}
}

func TestCreateEdge_HappyPath(t *testing.T) {
	t.Parallel()
	wantID := uuid.New()
	now := mustParse("2026-06-03T00:00:00Z")
	svc := &fakeService{
		createEdgeFn: func(ctx context.Context, in CreateEdgeInput) (Edge, error) {
			return Edge{
				ID:             wantID,
				MapID:          in.MapID,
				FromArtefactID: in.FromArtefactID,
				ToArtefactID:   in.ToArtefactID,
				Kind:           in.Kind,
				CreatedAt:      now,
				UpdatedAt:      now,
			}, nil
		},
	}
	srv := mountForTest(svc)
	body := CreateEdgeInput{
		MapID:          uuid.New(),
		FromArtefactID: uuid.New(),
		ToArtefactID:   uuid.New(),
		Kind:           EdgeKindFinishToStart,
	}
	req := authedReq(t, http.MethodPost, "/_site/dependencies/edges", "user", body)
	status, body2 := run(srv, req)
	if status != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", status, body2)
	}
	var got Edge
	if err := json.Unmarshal(body2, &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != wantID {
		t.Errorf("id = %s, want %s", got.ID, wantID)
	}
}

func TestCreateEdge_ErrorMatrix(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{"self_loop", ErrSelfLoop, http.StatusUnprocessableEntity},
		{"invalid_input", ErrInvalidInput, http.StatusUnprocessableEntity},
		{"cycle", ErrCycle, http.StatusUnprocessableEntity},
		{"endpoint_out_of_scope", ErrEndpointNotInScope, http.StatusForbidden},
		{"duplicate", ErrDuplicateEdge, http.StatusConflict},
		{"map_not_found", ErrNotFound, http.StatusNotFound},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := &fakeService{
				createEdgeFn: func(ctx context.Context, in CreateEdgeInput) (Edge, error) {
					return Edge{}, tc.err
				},
			}
			srv := mountForTest(svc)
			body := CreateEdgeInput{
				MapID:          uuid.New(),
				FromArtefactID: uuid.New(),
				ToArtefactID:   uuid.New(),
				Kind:           EdgeKindFinishToStart,
			}
			req := authedReq(t, http.MethodPost, "/_site/dependencies/edges", "user", body)
			status, _ := run(srv, req)
			if status != tc.wantStatus {
				t.Fatalf("status = %d, want %d", status, tc.wantStatus)
			}
		})
	}
}

func TestCreateEdge_BadJSON(t *testing.T) {
	t.Parallel()
	svc := &fakeService{}
	srv := mountForTest(svc)
	req := authedReq(t, http.MethodPost, "/_site/dependencies/edges", "user", nil)
	req.Body = io.NopCloser(strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	status, _ := run(srv, req)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", status)
	}
}

// ─────────────────────────────────────────────────────────────────
// Service-layer scope check helpers — covered without DB.
// ─────────────────────────────────────────────────────────────────

func TestNodeInScope(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	clamp := sentinel.Clamp{AllowedSubtreeIDs: []uuid.UUID{a, b}}

	cases := []struct {
		name string
		node uuid.UUID
		want bool
	}{
		{"in_scope_first", a, true},
		{"in_scope_second", b, true},
		{"out_of_scope", c, false},
		{"nil_node", uuid.Nil, false},
	}
	for _, tc := range cases {
		if got := nodeInScope(clamp, tc.node); got != tc.want {
			t.Errorf("%s: nodeInScope() = %v, want %v", tc.name, got, tc.want)
		}
	}

	// Nil AllowedSubtreeIDs fails closed — never returns true.
	closed := sentinel.Clamp{AllowedSubtreeIDs: nil}
	if nodeInScope(closed, a) {
		t.Error("nil AllowedSubtreeIDs should fail closed")
	}
}

func mustParse(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
