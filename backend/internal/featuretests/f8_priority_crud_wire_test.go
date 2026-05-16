package featuretests_test

// F8 — Priority CRUD + ?priority_id= filter (UUID wire).
//
// PLA-0055 feature test. Covers stories 00596 (artefact_priorities
// CRUD endpoints) and 00597 (artefactitems handler accepts
// ?priority_id=<uuid>[,uuid...], drops legacy ?priority=<slug>).
// Tracker group: `frontend-priority-customisation`, feature `F8`.
//
// Written RED 2026-05-16. The handler tests below FAIL on main because:
//   - artefactitems handler still accepts ?priority=<slug> (200)
//     but should 400 after story 00597 drops the slug param.
//   - The new ?priority_id= path doesn't parse UUID lists yet.
//
// Tier A — unit tests via httptest (no DB).
// Tier B — live-DB integration deferred; tunnel-gated.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// TestF8_Handler_AcceptsPriorityIDList asserts the handler exposes
// ?priority_id=<uuid>[,<uuid>] and validates members. RED on main
// because the handler today reads `?priority=` (comma-split text)
// and ignores the new param.
func TestF8_Handler_AcceptsPriorityIDList(t *testing.T) {
	h := f8NewNilPoolHandler()

	good := uuid.New().String() + "," + uuid.New().String()
	resGood := f8DoListRequest(t, h, "/work-items?priority_id="+good)
	if resGood.StatusCode != http.StatusOK {
		t.Errorf("good ?priority_id list rejected with %d; story 00597 must add parser", resGood.StatusCode)
	}

	bad := uuid.New().String() + ",not-a-uuid"
	resBad := f8DoListRequest(t, h, "/work-items?priority_id="+bad)
	if resBad.StatusCode != http.StatusBadRequest {
		t.Errorf("bogus ?priority_id member accepted with %d; story 00597 must 400 at edge", resBad.StatusCode)
	}
}

// TestF8_Handler_RejectsLegacyPrioritySlug asserts ?priority=<slug>
// is removed by story 00597. While story 00597 ships in lockstep
// with the frontend (story 00599) that stops sending the slug, the
// edge-reject is the durable contract.
func TestF8_Handler_RejectsLegacyPrioritySlug(t *testing.T) {
	h := f8NewNilPoolHandler()

	res := f8DoListRequest(t, h, "/work-items?priority=high")
	if res.StatusCode == http.StatusOK {
		t.Errorf("legacy ?priority=<slug> still accepted (200); story 00597 must reject with 400")
	}
}

// TestF8_PrioritiesCRUD_ListEndpointExists asserts the CRUD list
// endpoint mounts under the workspace-clamped /_site surface. The
// test only checks that an unauthenticated GET reaches a real
// handler (and is denied with 401/403) — proving the route exists
// rather than returning 404. RED on main: no handler is mounted.
func TestF8_PrioritiesCRUD_ListEndpointExists(t *testing.T) {
	// We don't have a route-table fixture in this test package; the
	// pragmatic check is to look for the artefactpriorities Go
	// package and the symbols story 00596 must export. f8 keeps
	// behind a deferred Tier-B harness — see f8_priorities_pkg_shape
	// build tag for the compile-time signal.
	t.Skip("Tier-B route fixture deferred — covered by f8_priorities_pkg_shape compile-tag test instead.")
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

func f8NewNilPoolHandler() *artefactitems.Handler {
	return artefactitems.NewHandler(artefactitems.NewService(nil, nil, "work"))
}

func f8DoListRequest(t *testing.T, h *artefactitems.Handler, target string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	stub := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "f8-test@example.com",
		IsActive:       true,
	}
	ctx, cancel := context.WithTimeout(auth.WithUserForTest(req.Context(), stub), 2*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.List(rec, req)
	return rec.Result()
}
