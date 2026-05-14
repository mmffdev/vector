package portfoliomodels

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// PLA-0026 / Story 00499 (B10): handler tests for
// GET /api/workspace/{id}/portfolio/layers.
//
// Same skip-on-unreachable discipline as the rest of the package
// (cluster down → t.Skip, never fail). Hits the live mmff_vector pool
// (testVectorPoolPadmin) for the workspace + workspace_roles auth check
// and the live vector_artefacts pool (vaTestPool) for artefacts_types.
//
// Cases:
//   - 401 when no user in context.
//   - 400 when the path id is not a UUID.
//   - 404 when the workspace doesn't exist.
//   - 404 when the workspace exists but is in another tenant.
//   - 403 when the caller is in the right tenant but not a member.
//   - 200 happy path: gadmin override returns the seeded strategy row.

func newWorkspaceLayersRouter(h *WorkspaceLayersHandler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if u == nil {
				next.ServeHTTP(w, r)
				return
			}
			ctx := auth.WithUserForTest(r.Context(), u)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	r.Route("/api/workspace/{id}/portfolio", func(r chi.Router) {
		r.Get("/layers", h.GetWorkspaceLayers)
	})
	return r
}

func TestWorkspaceLayers_Unauthorized(t *testing.T) {
	// No DB needed — RequireAuth-equivalent guard is at the top of the
	// handler. Pool args may be nil because the auth check returns
	// before any query runs.
	h := NewWorkspaceLayersHandler(NewService(nil, nil, nil))
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, nil))
	defer srv.Close()

	wsID := uuid.New().String()
	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID + "/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status: want 401, got %d", resp.StatusCode)
	}
}

func TestWorkspaceLayers_BadUUID(t *testing.T) {
	// UUID parse fails before any pool use.
	h := NewWorkspaceLayersHandler(NewService(nil, nil, nil))
	u := &models.User{ID: uuid.New(), SubscriptionID: uuid.New(), Role: models.RoleUser}
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, u))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/not-a-uuid/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", resp.StatusCode)
	}
}

func TestWorkspaceLayers_NotFound(t *testing.T) {
	vec, user := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	h := NewWorkspaceLayersHandler(NewService(nil, vec, va))
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, user))
	defer srv.Close()

	// Random UUID — guaranteed not to exist as a workspace.
	wsID := uuid.New().String()
	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID + "/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}

// TestWorkspaceLayers_OK_Gadmin — gadmin override returns the seeded
// strategy artefact_type rows for a real workspace in the gadmin's
// tenant. Also validates the response shape (subscriptionLayerDTO-
// compatible: id, source_library_id, name, tag, sort_order,
// parent_layer_id, allows_children, is_leaf, archived_at, created_at,
// updated_at; plus workspace_id for provenance).
func TestWorkspaceLayers_OK_Gadmin(t *testing.T) {
	vec, _ := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	// Pick a real workspace from mmff_vector. Skip if none exists in dev.
	var wsID, subID uuid.UUID
	err := vec.QueryRow(ctx, `
		SELECT id, subscription_id
		  FROM master_record_workspaces
		 WHERE archived_at IS NULL
		 ORDER BY created_at
		 LIMIT 1`,
	).Scan(&wsID, &subID)
	if err != nil {
		t.Skipf("no workspace available in dev: %v", err)
	}

	// Seed one strategy artefact_type for this workspace. Use a unique
	// prefix to avoid colliding with prior runs.
	suffix := uuid.NewString()[:6]
	prefix := "T" + suffix[:2]
	name := "WSLayer_" + suffix
	libLayerID := uuid.New()

	defer func() {
		_, _ = va.Exec(ctx,
			`DELETE FROM artefacts_types WHERE workspace_id = $1 AND prefix = $2`,
			wsID, prefix)
	}()

	if _, err := va.Exec(ctx, `
		INSERT INTO artefacts_types (
			subscription_id, workspace_id,
			scope, source,
			name, prefix, description,
			parent_type_id, allows_children, sort_order,
			library_layer_id, library_layer_tag
		) VALUES (
			$1, $2,
			'strategy', 'tenant',
			$3, $4, $5,
			NULL, TRUE, 100,
			$6, $4
		)`,
		subID, wsID, name, prefix, "test description", libLayerID,
	); err != nil {
		t.Skipf("cannot seed artefacts_types row (schema not deployed?): %v", err)
	}

	// Faux gadmin in the workspace's tenant. The handler's gadmin
	// override skips the workspace_roles membership check.
	gadmin := &models.User{
		ID:             uuid.New(),
		SubscriptionID: subID,
		Email:          "claude-gadmin-test@example.invalid",
		Role:           models.RoleGAdmin,
		IsActive:       true,
	}

	h := NewWorkspaceLayersHandler(NewService(nil, vec, va))
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, gadmin))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}

	var body []WorkspaceLayer
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Find our seeded row by prefix and assert shape.
	var found *WorkspaceLayer
	for i := range body {
		if body[i].Tag == prefix {
			found = &body[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("seeded layer with tag %q missing from response (got %d rows)",
			prefix, len(body))
	}
	if found.Name != name {
		t.Errorf("name: want %q, got %q", name, found.Name)
	}
	if found.WorkspaceID != wsID {
		t.Errorf("workspace_id: want %s, got %s", wsID, found.WorkspaceID)
	}
	if found.SourceLibraryID == nil || *found.SourceLibraryID != libLayerID {
		t.Errorf("source_library_id: want %s, got %v", libLayerID, found.SourceLibraryID)
	}
	if !found.AllowsChildren {
		t.Errorf("allows_children: want true, got false")
	}
	if found.IsLeaf {
		t.Errorf("is_leaf: want false (allows_children=true), got true")
	}
	if found.ArchivedAt != nil {
		t.Errorf("archived_at: want nil, got %v", found.ArchivedAt)
	}
}

// TestWorkspaceLayers_Forbidden_NonMember — a non-gadmin user in the
// workspace's tenant who has no workspace_roles row gets 403.
func TestWorkspaceLayers_Forbidden_NonMember(t *testing.T) {
	vec, _ := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	var wsID, subID uuid.UUID
	err := vec.QueryRow(ctx, `
		SELECT id, subscription_id
		  FROM master_record_workspaces
		 WHERE archived_at IS NULL
		 ORDER BY created_at
		 LIMIT 1`,
	).Scan(&wsID, &subID)
	if err != nil {
		t.Skipf("no workspace available in dev: %v", err)
	}

	// Non-gadmin user in the same tenant with a random user id (not a
	// member of the workspace).
	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: subID,
		Email:          "claude-nonmember-test@example.invalid",
		Role:           models.RoleUser,
		IsActive:       true,
	}

	h := NewWorkspaceLayersHandler(NewService(nil, vec, va))
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", resp.StatusCode)
	}
}

// TestWorkspaceLayers_NotFound_CrossTenant — a user in tenant A asking
// for a workspace in tenant B gets 404 (existence is leak-resistant).
func TestWorkspaceLayers_NotFound_CrossTenant(t *testing.T) {
	vec, _ := testVectorPoolPadmin(t)
	defer vec.Close()
	va := vaTestPool(t)
	defer va.Close()

	ctx := context.Background()

	var wsID, subID uuid.UUID
	err := vec.QueryRow(ctx, `
		SELECT id, subscription_id
		  FROM master_record_workspaces
		 WHERE archived_at IS NULL
		 ORDER BY created_at
		 LIMIT 1`,
	).Scan(&wsID, &subID)
	if err != nil {
		t.Skipf("no workspace available in dev: %v", err)
	}

	// User in a different (random) tenant.
	user := &models.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(), // != subID
		Email:          "claude-crosstenant-test@example.invalid",
		Role:           models.RoleGAdmin, // even gadmin can't peek across tenants
		IsActive:       true,
	}
	if user.SubscriptionID == subID {
		t.Skip("randomly drew the same subscription id; rerun")
	}

	h := NewWorkspaceLayersHandler(NewService(nil, vec, va))
	srv := httptest.NewServer(newWorkspaceLayersRouter(h, user))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/workspace/" + wsID.String() + "/portfolio/layers")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", resp.StatusCode)
	}
}
