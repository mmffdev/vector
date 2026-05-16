package featuretests_test

// F4 — UUID wire end-to-end (artefact_type_id + flow_state_id).
//
// PLA-0054 feature test. Covers stories 00585 (handler accepts
// ?item_type_id=<uuid>[,<uuid>] + ?flow_state_id=<uuid>[,<uuid>]),
// 00586 (service Filters carries []uuid.UUID, emits ANY($N::uuid[])),
// 00587 (drops legacy ?item_type=<slug>+?status=<slug> paths).
//
// Story 00586's Filters shape change (*string → []uuid.UUID) is a
// compile-time signal — covered in f4_filters_uuid_shape_test.go
// behind the `f4_filters_uuid_shape` build tag, so this file's
// runtime tests still build on main while the shape is still *string.
//
// Tracker group: `frontend-chip-foundation`, feature `F4`.
//
// Written RED 2026-05-16. The assertions below FAIL on main because:
//   - List handler has no `?item_type_id=` parser (story 00585)
//   - List handler still accepts `?item_type=<slug>` (story 00587)
//   - Renaming an artefact_type's name breaks slug filters but a UUID
//     filter should be invariant (story 00585/00586)
//
// Tier A — unit tests, no DB. Exercise the handler via httptest.
// Tier B — live-DB integration (rename invariance). Tunnel-down skip.

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

// ──────────────────────────────────────────────────────────────────────
// Tier A — unit tests (no DB).
// ──────────────────────────────────────────────────────────────────────

// TestF4_Handler_AcceptsItemTypeIDList asserts that GET /work-items
// accepts `?item_type_id=<uuid>,<uuid>` and surfaces the parsed list
// to the service Filters. RED on main because the handler has no
// `item_type_id` parser (story 00585).
//
// Verification: drive the handler with a nil-pool service so List
// returns the empty page, but capture the Filters via a sniffer
// implemented as a test-only handler wrapper. To avoid leaking test
// types into prod, we read the response body — when the parser is
// missing the handler ignores the param and returns no filter clause
// → 200 with empty page (false GREEN). To actually FAIL on main, we
// assert at a higher level: the route MUST reject malformed UUIDs in
// the list with 400, mirroring the existing `scope` parser pattern.
//
// On main: handler does not parse the param at all → no 400 ever →
// this test fails because the malformed UUID is silently accepted.
func TestF4_Handler_AcceptsItemTypeIDList(t *testing.T) {
	h := f4NewNilPoolHandler()

	// Two valid UUIDs, comma-separated, must be accepted (200).
	good := uuid.New().String() + "," + uuid.New().String()
	resGood := f4DoListRequest(t, h, "/work-items?item_type_id="+good)
	if resGood.StatusCode != http.StatusOK {
		t.Errorf("good ?item_type_id list rejected with %d; expected 200 once story 00585 adds parser", resGood.StatusCode)
	}

	// Bogus member → 400. RED on main because handler does not parse
	// the param at all → silently 200s. Story 00585 must mirror the
	// existing ?scope parser pattern (reject malformed UUIDs at the
	// edge with 400 before the service runs).
	bad := uuid.New().String() + ",not-a-uuid"
	resBad := f4DoListRequest(t, h, "/work-items?item_type_id="+bad)
	if resBad.StatusCode != http.StatusBadRequest {
		t.Errorf("bogus ?item_type_id member accepted with %d; story 00585 must 400 at the edge (mirror ?scope parser)", resBad.StatusCode)
	}
}

// TestF4_Handler_AcceptsFlowStateIDList mirrors AcceptsItemTypeIDList
// for `?flow_state_id=<uuid>[,<uuid>]`. RED on main because the
// handler currently parses `?status=<slug>` only (story 00585 swaps
// it for the UUID variant).
func TestF4_Handler_AcceptsFlowStateIDList(t *testing.T) {
	h := f4NewNilPoolHandler()

	good := uuid.New().String() + "," + uuid.New().String()
	resGood := f4DoListRequest(t, h, "/work-items?flow_state_id="+good)
	if resGood.StatusCode != http.StatusOK {
		t.Errorf("good ?flow_state_id list rejected with %d; expected 200 once story 00585 adds parser", resGood.StatusCode)
	}

	bad := "definitely-not-a-uuid"
	resBad := f4DoListRequest(t, h, "/work-items?flow_state_id="+bad)
	if resBad.StatusCode != http.StatusBadRequest {
		t.Errorf("bogus ?flow_state_id accepted with %d; story 00585 must 400 at the edge", resBad.StatusCode)
	}
}

// TestF4_Handler_RejectsLegacySlugParams asserts the slug paths
// (?item_type=<slug>, ?status=<slug>) are removed by story 00587.
// Frontend has been migrated to UUIDs; leaving the slug paths around
// invites quiet drift when a gadmin renames the type.
//
// Story 00587 — drop the slug parsers. Until then, this test fails
// because the handler silently 200s with the legacy params present.
func TestF4_Handler_RejectsLegacySlugParams(t *testing.T) {
	h := f4NewNilPoolHandler()

	resLegacyType := f4DoListRequest(t, h, "/work-items?item_type=epic")
	if resLegacyType.StatusCode == http.StatusOK {
		t.Errorf("legacy ?item_type=<slug> still accepted (200); story 00587 must reject with 400")
	}

	resLegacyStatus := f4DoListRequest(t, h, "/work-items?status=open")
	if resLegacyStatus.StatusCode == http.StatusOK {
		t.Errorf("legacy ?status=<slug> still accepted (200); story 00587 must reject with 400")
	}
}

// ──────────────────────────────────────────────────────────────────────
// Tier B — live-DB integration.
// ──────────────────────────────────────────────────────────────────────

// TestF4_RenameInvariance_LiveDB asserts a gadmin renaming an
// artefact_type's name does NOT break a filter that uses the type's
// UUID. The whole point of the UUID wire migration.
//
// Procedure (inside a rolled-back tx, no commit):
//  1. Pick a non-system artefact_type in any workspace.
//  2. List work-items filtered by `?item_type_id=<that uuid>` → record count.
//  3. UPDATE artefacts_types_name = <new junk name>.
//  4. List again with the same UUID → count must match.
//
// RED on main because (a) the ?item_type_id parser doesn't exist
// (story 00585) and (b) without the UUID wire path, the frontend
// would have been filtering on the slug — the rename would change
// the result set.
//
// Skips if dev DB has no usable fixture (workspace with at least one
// work-scope artefact_type and at least one artefact of that type).
func TestF4_RenameInvariance_LiveDB(t *testing.T) {
	t.Skip("Tier-B harness deferred — story 00586 (service Filters shape) + live JWT-mode test rig needed before this can run. Filed as part of the F4 RED suite; flip to a real test alongside story 00586 implementation.")
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// f4NewNilPoolHandler builds a Handler over a nil-pool Service so List
// returns an empty page without touching a DB. Suitable for Tier-A
// parser tests where we only care about the HTTP-edge contract.
func f4NewNilPoolHandler() *artefactitems.Handler {
	return artefactitems.NewHandler(artefactitems.NewService(nil, nil, "work"))
}

// f4DoListRequest drives the List handler with a stubbed auth context
// (so UserFromCtx returns a real subscription_id) and returns the
// response. The auth user is the cheapest stub that satisfies the
// handler's `auth.UserFromCtx(ctx).SubscriptionID` read.
func f4DoListRequest(t *testing.T, h *artefactitems.Handler, target string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	stub := &roletypes.User{
		ID:             uuid.New(),
		SubscriptionID: uuid.New(),
		Email:          "f4-test@example.com",
		IsActive:       true,
	}
	ctx, cancel := context.WithTimeout(auth.WithUserForTest(req.Context(), stub), 2*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.List(rec, req)
	return rec.Result()
}

