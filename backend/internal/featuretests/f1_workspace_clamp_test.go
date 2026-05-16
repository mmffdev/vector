package featuretests_test

// F1 — Workspace clamp end-to-end via JWT claim.
//
// PLA-0053 feature test. Covers stories 00575–00579 (JWT claim,
// middleware reshape, schema, mount, service clamp). Tracker group:
// `backend-workspace-foundation`, feature `F1`.
//
// Written RED 2026-05-16. The assertions below FAIL on main because:
//   - auth.AccessClaims has no `workspace_id` field (story 00575 adds it)
//   - roletypes.User has no WorkspaceID field (story 00575 adds it)
//   - WorkspaceClampMiddleware reads ?ws= from URL, not the JWT claim
//     (story 00576 reshapes it to JWT-first with FirstLiveWorkspace fallback)
//   - artefact_types has no workspace_id column (story 00577 adds it)
//   - WorkspaceClampMiddleware is not mounted on /_site/artefact-types or
//     /_site/work-items (story 00578 mounts it)
//   - artefacttypes + artefactitems services don't read WorkspaceIDFromCtx
//     (story 00579 wires the clamp into the queries)
//
// Suite structure:
//
//   Tier A — unit tests, no DB. These can fail/pass independent of any
//   backend wiring. RED-on-main is fully exercised by Tier A.
//
//   Tier B — integration tests, require live dev DB + full handler
//   stack. Currently t.Skip()'d with TODO refs to the implementation
//   stories that unblock them. Story 00578 enables them by mounting
//   the middleware; story 00579 makes them actually pass.
//
// The feature test ships RED before any implementation story lands.
// Green threshold = all Tier-A + all Tier-B pass after story 00579.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// ──────────────────────────────────────────────────────────────────────
// Tier A — unit tests (no DB). RED on main; expected GREEN after stories
// 00575 (JWT claim) + 00576 (middleware reshape) land.
// ──────────────────────────────────────────────────────────────────────

// TestF1_JWTClaim_CarriesWorkspaceID verifies that AccessClaims has a
// WorkspaceID field that survives marshal/unmarshal. RED on main
// because AccessClaims today carries SubscriptionID only.
//
// Story 00575 — SEC: add workspace_id JWT claim to login + auth.User.
func TestF1_JWTClaim_CarriesWorkspaceID(t *testing.T) {
	workspaceID := uuid.New()
	subscriptionID := uuid.New()

	// Build a JWT body shaped the way story 00575 specifies:
	// subscription_id + workspace_id alongside the existing fields.
	body := []byte(`{
		"email":           "f1-test@example.com",
		"role":            "gadmin",
		"subscription_id": "` + subscriptionID.String() + `",
		"workspace_id":    "` + workspaceID.String() + `",
		"force_pwd_change": false
	}`)

	var c auth.AccessClaims
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}

	// RED-causing assertion: AccessClaims today has no WorkspaceID field,
	// so this access fails to compile until story 00575 adds it.
	// Compile-time failure IS the red signal.
	got := c.WorkspaceID
	if got != workspaceID.String() {
		t.Errorf(
			"AccessClaims.WorkspaceID = %q, want %q (story 00575 must add the field + natural unmarshal must populate it from `workspace_id`)",
			got, workspaceID.String(),
		)
	}
}

// TestF1_SignAccessToken_IncludesWorkspaceID verifies that signing a
// token from a roletypes.User attaches the user's WorkspaceID. RED
// because roletypes.User has no WorkspaceID field today.
//
// Story 00575 — SEC: add workspace_id JWT claim to login + auth.User.
func TestF1_SignAccessToken_IncludesWorkspaceID(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "f1-test-secret")
	t.Setenv("JWT_ACCESS_TTL", "15m")

	workspaceID := uuid.New()
	u := &roletypes.User{
		ID:             uuid.New(),
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: uuid.New(),
		// RED-causing line: roletypes.User has no WorkspaceID field
		// until story 00575 adds it. Compile-time failure IS the red
		// signal on main.
		WorkspaceID: workspaceID,
	}

	signed, err := auth.SignAccessToken(u)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	c, err := auth.ParseAccessToken(signed)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if c.WorkspaceID != workspaceID.String() {
		t.Errorf(
			"round-tripped JWT WorkspaceID = %q, want %q (story 00575 wires u.WorkspaceID into the signing path)",
			c.WorkspaceID, workspaceID.String(),
		)
	}

	// Sanity: subscription_id still works alongside the new field
	// (no regression in the existing claim).
	if c.SubscriptionID != u.SubscriptionID.String() {
		t.Errorf("subscription_id round-trip broken: got %q, want %q",
			c.SubscriptionID, u.SubscriptionID.String())
	}

	// Sanity: signing method is still HS256 (no inadvertent change).
	parsed, _ := jwt.Parse(signed, func(t *jwt.Token) (interface{}, error) {
		return []byte("f1-test-secret"), nil
	})
	if alg, _ := parsed.Header["alg"].(string); alg != "HS256" {
		t.Errorf("signing alg = %q, want HS256", alg)
	}
}

// TestF1_Middleware_JWTBeatsURL verifies that when both the JWT claim
// and ?ws= URL query are present, the JWT wins. RED on main because
// the middleware reads URL first.
//
// Story 00576 — SEC: WorkspaceClampMiddleware reads JWT claim (drop ?ws=).
func TestF1_Middleware_JWTBeatsURL(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	jwtWorkspace := uuid.New() // The one the JWT carries — should win
	urlWorkspace := uuid.New() // The one URL would resolve to — should be ignored

	lookup := &f1FakeLookup{
		// Wire URL-resolved workspace as a slug lookup; if middleware
		// still consults URL, this is what it would seed.
		bySlug:    map[string]uuid.UUID{subscriptionID.String() + "|other-ws": urlWorkspace},
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: jwtWorkspace},
		// Both workspaces grant the user a role so the role check
		// doesn't preempt the assertion we're making.
		role: map[string]bool{
			jwtWorkspace.String() + "|" + userID.String(): true,
			urlWorkspace.String() + "|" + userID.String(): true,
		},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		// RED-causing line until story 00575 adds the field.
		WorkspaceID: jwtWorkspace,
	}

	seen := runClampForF1(t, lookup, user, "ws=other-ws")

	if seen.workspaceID != jwtWorkspace {
		t.Errorf(
			"middleware seeded workspaceID = %s, want %s (story 00576 must read from JWT before URL; got URL-resolved value instead)",
			seen.workspaceID, jwtWorkspace,
		)
	}
}

// TestF1_Middleware_JWTAbsent_FallsBackToFirstLive verifies that when
// the JWT has no workspace_id (legacy token during rollout), the
// middleware falls back to FirstLiveWorkspace. RED expectation:
// today's middleware reaches FirstLiveWorkspace via the no-?ws= path,
// so this CASE may pass on main — but it pins the behaviour so story
// 00576 keeps the fallback intact when it removes the URL surface.
//
// Story 00576 — fallback intact for legacy JWTs.
func TestF1_Middleware_JWTAbsent_FallsBackToFirstLive(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	firstLive := uuid.New()

	lookup := &f1FakeLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: firstLive},
		role:      map[string]bool{firstLive.String() + "|" + userID.String(): true},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		// Zero WorkspaceID = JWT did not carry the claim. After story
		// 00575 the field exists; before then this line is dead code
		// (compile error). Both states cover the legacy-token path.
		WorkspaceID: uuid.Nil,
	}

	seen := runClampForF1(t, lookup, user, "")

	if seen.workspaceID != firstLive {
		t.Errorf(
			"fallback FirstLiveWorkspace = %s, want %s (story 00576 must keep this fallback for legacy JWTs)",
			seen.workspaceID, firstLive,
		)
	}
}

// TestF1_Middleware_NoRoleStill403 verifies that even when the JWT
// carries a workspace_id, the role check still runs. This protects
// against a forged JWT (or a token issued before role-revocation)
// reaching a workspace the user has no active role on.
//
// Story 00576 — HasActiveRole check survives the JWT-mode reshape.
func TestF1_Middleware_NoRoleStill403(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	jwtWorkspace := uuid.New()

	lookup := &f1FakeLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: jwtWorkspace},
		// Crucially: NO entry in role map → HasActiveRole returns false.
		role: map[string]bool{},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		WorkspaceID:    jwtWorkspace,
	}

	rec := runClampForF1Rec(t, lookup, user, "")

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 (HasActiveRole must still run after JWT-mode resolution)", rec.Code)
	}
	if got := readErrCodeF1(t, rec); got != "no_workspace_role" {
		t.Errorf("error body = %q, want \"no_workspace_role\"", got)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Tier B — integration tests (live DB + handler stack). Skipped until
// stories 00577 + 00578 + 00579 land. Structured so the unskip is a
// one-line change once the implementation is wired.
// ──────────────────────────────────────────────────────────────────────

// TestF1_Migration_ArtefactTypesWorkspaceIDNotNull verifies that the
// post-migration state has zero NULLs in artefact_types.workspace_id.
//
// Story 00577 — SQL: add workspace_id to artefact_types + backfill.
func TestF1_Migration_ArtefactTypesWorkspaceIDNotNull(t *testing.T) {
	t.Skip("PLA-0053 story 00577 must land first (migration + backfill); unskip when artefact_types.workspace_id column exists")
}

// TestF1_GET_ArtefactTypes_WorkspaceScoped verifies that GET /_site/artefact-types
// returns only the JWT-resolved workspace's rows.
//
// Story 00578 — API: mount WorkspaceClampMiddleware on /artefact-types.
// Story 00579 — API: artefacttypes service reads WorkspaceIDFromCtx + clamps.
func TestF1_GET_ArtefactTypes_WorkspaceScoped(t *testing.T) {
	t.Skip("PLA-0053 stories 00578 + 00579 must land first (middleware mount + service clamp); unskip when artefacttypes handler is workspace-scoped")
}

// TestF1_GET_WorkItems_WorkspaceScoped verifies that GET /_site/work-items
// returns only artefacts whose artefact_type belongs to the JWT workspace.
//
// Story 00578 + 00579.
func TestF1_GET_WorkItems_WorkspaceScoped(t *testing.T) {
	t.Skip("PLA-0053 stories 00578 + 00579 must land first (middleware mount + service clamp); unskip when artefactitems handler is workspace-scoped")
}

// TestF1_GET_CrossWorkspace_ArtefactID_404 verifies that requesting an
// artefact ID from a different workspace returns 404, not 403 (no
// existence leak).
//
// Story 00579 — service clamp must produce 404 for cross-workspace IDs.
func TestF1_GET_CrossWorkspace_ArtefactID_404(t *testing.T) {
	t.Skip("PLA-0053 story 00579 must land first (service clamp); unskip when artefactitems returns 404 for cross-workspace IDs")
}

// ──────────────────────────────────────────────────────────────────────
// Helpers (file-local — featuretests package owns its harness, not
// imported from topology_test which is a separate test binary).
// ──────────────────────────────────────────────────────────────────────

// f1FakeLookup mirrors the topology_test.fakeWorkspaceLookup pattern.
// Kept local to this file (and package-private) so future feature
// tests can grow their own fakes without coupling to topology's tests.
type f1FakeLookup struct {
	firstLive map[uuid.UUID]uuid.UUID
	bySlug    map[string]uuid.UUID
	byID      map[string]uuid.UUID
	role      map[string]bool
}

func (f *f1FakeLookup) FirstLiveWorkspace(_ context.Context, sub uuid.UUID) (uuid.UUID, error) {
	id, ok := f.firstLive[sub]
	if !ok || id == uuid.Nil {
		return uuid.Nil, topology.ErrNoWorkspace
	}
	return id, nil
}

func (f *f1FakeLookup) ResolveSlug(_ context.Context, sub uuid.UUID, slug string) (uuid.UUID, error) {
	id, ok := f.bySlug[sub.String()+"|"+slug]
	if !ok {
		return uuid.Nil, topology.ErrWorkspaceNotFound
	}
	return id, nil
}

func (f *f1FakeLookup) ResolveRef(ctx context.Context, sub uuid.UUID, ref string) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		key := sub.String() + "|" + id.String()
		got, ok := f.byID[key]
		if !ok {
			return uuid.Nil, topology.ErrWorkspaceNotFound
		}
		return got, nil
	}
	return f.ResolveSlug(ctx, sub, ref)
}

func (f *f1FakeLookup) HasActiveRole(_ context.Context, ws, u uuid.UUID) (bool, error) {
	return f.role[ws.String()+"|"+u.String()], nil
}

// seenCtx captures what the terminal handler observed from the
// workspace clamp.
type seenF1Ctx struct {
	workspaceID uuid.UUID
	hasClamp    bool
}

func runClampForF1(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) *seenF1Ctx {
	t.Helper()
	rec, seen := runClampForF1Both(t, lookup, user, queryString)
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected non-200: %d (body=%q)", rec.Code, rec.Body.String())
	}
	return seen
}

func runClampForF1Rec(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) *httptest.ResponseRecorder {
	t.Helper()
	rec, _ := runClampForF1Both(t, lookup, user, queryString)
	return rec
}

func runClampForF1Both(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) (*httptest.ResponseRecorder, *seenF1Ctx) {
	t.Helper()
	seen := &seenF1Ctx{}
	terminal := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := topology.WorkspaceIDFromCtx(r.Context())
		seen.workspaceID = id
		seen.hasClamp = ok
		w.WriteHeader(http.StatusOK)
	})
	clamp := topology.WorkspaceClampMiddleware(lookup)(terminal)

	url := "/api/_site/artefact-types"
	if queryString != "" {
		url += "?" + queryString
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if user != nil {
		req = req.WithContext(auth.WithUserForTest(req.Context(), user))
	}
	rec := httptest.NewRecorder()
	clamp.ServeHTTP(rec, req)
	return rec, seen
}

func readErrCodeF1(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v (body=%q)", err, rec.Body.String())
	}
	return body["error"]
}

// (unused imports kept here so the diff stays tight when Tier B unskips)
var _ = time.Time{}
