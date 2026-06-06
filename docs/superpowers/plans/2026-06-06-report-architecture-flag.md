# `<report> -a` Architecture Site Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `-a` (architecture) flag to the `<report>` skill that builds and maintains a single living site map (`ARC001`) — every Rail1 bucket, every page, each page's purpose and full (tiered) transitive component tree, plus a reverse used-by component registry — cross-referenced by stable registry-backed IDs.

**Architecture:** A new read-only dev introspection endpoint returns the unfiltered nav spine (`pages` + `pages_tags`). The skill protocol (in SKILL.md) drives a build: spine fetch → code reconciliation → sequential-batched sub-agents resolve per-page transitive trees → synthesis builds the reverse registry + drift report + HTML → upsert `ARC001`. Two committed `.claude/` files (`arch-map-ids.json`, `arch-map-cache.json`) lock IDs and enable incremental re-runs. Four wiring touch-points register the `architecture` report type end-to-end.

**Tech Stack:** Go (chi, pgx) backend; TypeScript/React dev panel; Python lint harness untouched; the skill itself is a Markdown protocol executed by Claude. All work on `main` (user directive 2026-06-06).

**Spec:** [docs/superpowers/specs/2026-06-06-report-architecture-flag-design.md](../specs/2026-06-06-report-architecture-flag-design.md)

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `backend/internal/devreports/types.go` | Add `"architecture"` to `ValidTypes` enum. | Modify |
| `backend/internal/navmap/types.go` | DTO structs for the unfiltered nav spine (`SpineBucket`, `SpinePage`, `SpineResponse`). | Create |
| `backend/internal/navmap/sql.go` | Two SQL constants: list all buckets, list all pages (no role filter). | Create |
| `backend/internal/navmap/service.go` | `Service.Spine(ctx)` — reads both tables, assembles bucket→page tree. | Create |
| `backend/internal/navmap/handler.go` | `GET /_site/admin/dev/architecture/spine` → JSON spine. | Create |
| `backend/internal/navmap/service_test.go` | Service assembly test against a fake querier. | Create |
| `backend/cmd/server/main.go` | Construct `navmap` service+handler, mount the route under the dev group. | Modify |
| `app/lib/apiSite/index.ts` | Add `"architecture"` to `DevReportType`. | Modify |
| `dev/pages/DevReportingPanel.tsx` | Add `{ value: "architecture", label: "Architecture" }` tab. | Modify |
| `.claude/skills/report/SKILL.md` | Add `-a` flag row + full protocol section + section template row. | Modify |
| `.claude/arch-map-ids.json` | ID registry (created by first `-a` run, but seeded empty here so the skill has a stable target). | Create |

---

## Task 1: Register the `architecture` report type (backend enum)

**Files:**
- Modify: `backend/internal/devreports/types.go:22`
- Test: `backend/internal/devreports/types_test.go` (create if absent)

- [ ] **Step 1: Write the failing test**

Check for an existing test file first: `ls backend/internal/devreports/types_test.go`. If absent, create it:

```go
package devreports

import "testing"

func TestIsValidType_Architecture(t *testing.T) {
	if !isValidType("architecture") {
		t.Fatalf("expected \"architecture\" to be a valid report type")
	}
}

func TestIsValidType_Unknown(t *testing.T) {
	if isValidType("not-a-type") {
		t.Fatalf("expected \"not-a-type\" to be invalid")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/devreports/ -run TestIsValidType_Architecture -v`
Expected: FAIL — `expected "architecture" to be a valid report type`.

- [ ] **Step 3: Add the type to the enum**

In `backend/internal/devreports/types.go:22`, change:

```go
var ValidTypes = []string{"research", "plan", "security", "retro", "code", "api", "misc", "system"}
```

to:

```go
var ValidTypes = []string{"research", "plan", "security", "retro", "code", "api", "misc", "system", "architecture"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/devreports/ -run TestIsValidType -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/devreports/types.go backend/internal/devreports/types_test.go
git commit -m "feat(devreports): register 'architecture' report type

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Nav-spine DTOs (`navmap` package)

**Files:**
- Create: `backend/internal/navmap/types.go`

- [ ] **Step 1: Write the DTOs**

```go
// Package navmap exposes the unfiltered nav spine (every bucket + every
// system page) for the <report> -a architecture site map. Unlike
// nav.Catalogue, which filters pages by the caller's role, navmap returns
// the COMPLETE tree so the architecture map covers the whole site
// (public-facing + dev-tools-facing). Read-only; dev-gated.
package navmap

// SpinePage is one row from the pages table, trimmed to the fields the
// architecture map needs.
type SpinePage struct {
	KeyEnum      string `json:"key_enum"`      // pages_key_enum — stable slug
	Label        string `json:"label"`         // pages_label — display name
	Href         string `json:"href"`          // pages_href — route path
	Kind         string `json:"kind"`          // pages_kind — system | entity | custom
	DefaultOrder int    `json:"default_order"` // pages_default_order — within bucket
}

// SpineBucket is one row from pages_tags with its child pages attached.
type SpineBucket struct {
	TagEnum string      `json:"tag_enum"` // pages_tags_tag_enum — stable slug
	Label   string      `json:"label"`    // bucket display name
	Order   int         `json:"order"`    // bucket order on Rail1
	Pages   []SpinePage `json:"pages"`
}

// SpineResponse is the top-level payload of GET /_site/admin/dev/architecture/spine.
type SpineResponse struct {
	Buckets []SpineBucket `json:"buckets"`
	// Untagged collects pages whose pages_tag_enum matches no bucket
	// (orphaned tag) — surfaced so the drift report can flag them.
	Untagged []SpinePage `json:"untagged"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && go build ./internal/navmap/`
Expected: builds clean (no exit error).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/navmap/types.go
git commit -m "feat(navmap): nav-spine DTOs for architecture map

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Nav-spine SQL constants

**Files:**
- Create: `backend/internal/navmap/sql.go`

The column names are verified against `backend/internal/nav/sql.go` (`pages_*`, `pages_tags_*`). Both tables live in `vector_artefacts` (servicePool / vaPool) per the DB-routing rule.

- [ ] **Step 1: Write the SQL constants**

```go
package navmap

// sqlListBuckets returns every bucket (page_tags group) in Rail1 order.
// No role filter — this is the complete catalogue for the architecture map.
const sqlListBuckets = `
	SELECT pages_tags_tag_enum,
	       pages_tags_label,
	       pages_tags_default_order
	  FROM pages_tags
	 ORDER BY pages_tags_default_order, pages_tags_label`

// sqlListAllPages returns every system-scoped page (created_by IS NULL),
// regardless of role grants, so the map is complete. Entity/custom pages
// are included via pages_kind so the drift report can classify them.
const sqlListAllPages = `
	SELECT p.pages_key_enum,
	       p.pages_label,
	       p.pages_href,
	       p.pages_kind,
	       p.pages_tag_enum,
	       p.pages_default_order
	  FROM pages p
	 WHERE p.created_by IS NULL
	 ORDER BY p.pages_tag_enum, p.pages_default_order, p.pages_label`
```

- [ ] **Step 2: Verify the column names against the live nav SQL**

Run: `grep -n "pages_tags_label\|pages_tags_default_order\|pages_key_enum\|pages_kind\|pages_tag_enum\|pages_default_order" backend/internal/nav/sql.go`
Expected: each column name appears (confirms no typo / drift). If `pages_tags_label` or `pages_tags_default_order` differ, fix the constant to match the real column names before proceeding.

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && go build ./internal/navmap/`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/navmap/sql.go
git commit -m "feat(navmap): unfiltered pages + pages_tags spine SQL

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Nav-spine service (assembly + test)

**Files:**
- Create: `backend/internal/navmap/service.go`
- Create: `backend/internal/navmap/service_test.go`

- [ ] **Step 1: Write the failing test**

```go
package navmap

import (
	"context"
	"testing"
)

// fakeRows is a tiny in-memory stand-in for the two queries the service runs.
type fakeQuerier struct {
	buckets []SpineBucket
	pages   []SpinePage
	pageTag map[string]string // key_enum -> tag_enum
}

func (f *fakeQuerier) listBuckets(_ context.Context) ([]SpineBucket, error) {
	return f.buckets, nil
}
func (f *fakeQuerier) listPages(_ context.Context) ([]SpinePage, map[string]string, error) {
	return f.pages, f.pageTag, nil
}

func TestAssembleSpine_NestsPagesUnderBuckets(t *testing.T) {
	q := &fakeQuerier{
		buckets: []SpineBucket{{TagEnum: "planning", Label: "Planning", Order: 1}},
		pages: []SpinePage{
			{KeyEnum: "work-items", Label: "Work Items", Href: "/work-items"},
			{KeyEnum: "scope", Label: "Scope", Href: "/scope"},
		},
		pageTag: map[string]string{"work-items": "planning", "scope": "planning"},
	}
	resp := assembleSpine(q.buckets, q.pages, q.pageTag)
	if len(resp.Buckets) != 1 {
		t.Fatalf("want 1 bucket, got %d", len(resp.Buckets))
	}
	if len(resp.Buckets[0].Pages) != 2 {
		t.Fatalf("want 2 pages under planning, got %d", len(resp.Buckets[0].Pages))
	}
}

func TestAssembleSpine_CollectsUntagged(t *testing.T) {
	resp := assembleSpine(
		[]SpineBucket{{TagEnum: "planning", Label: "Planning"}},
		[]SpinePage{{KeyEnum: "ghost", Label: "Ghost", Href: "/ghost"}},
		map[string]string{"ghost": "no-such-bucket"},
	)
	if len(resp.Untagged) != 1 {
		t.Fatalf("want 1 untagged page, got %d", len(resp.Untagged))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && go test ./internal/navmap/ -run TestAssembleSpine -v`
Expected: FAIL — `assembleSpine` undefined.

- [ ] **Step 3: Write the service + pure assembly function**

```go
package navmap

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service reads the unfiltered nav spine from vector_artefacts (vaPool).
type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Spine reads both catalogue tables and assembles the bucket->page tree.
func (s *Service) Spine(ctx context.Context) (SpineResponse, error) {
	buckets, err := s.queryBuckets(ctx)
	if err != nil {
		return SpineResponse{}, fmt.Errorf("navmap: buckets: %w", err)
	}
	pages, pageTag, err := s.queryPages(ctx)
	if err != nil {
		return SpineResponse{}, fmt.Errorf("navmap: pages: %w", err)
	}
	return assembleSpine(buckets, pages, pageTag), nil
}

func (s *Service) queryBuckets(ctx context.Context) ([]SpineBucket, error) {
	rows, err := s.pool.Query(ctx, sqlListBuckets)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SpineBucket
	for rows.Next() {
		var b SpineBucket
		if err := rows.Scan(&b.TagEnum, &b.Label, &b.Order); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Service) queryPages(ctx context.Context) ([]SpinePage, map[string]string, error) {
	rows, err := s.pool.Query(ctx, sqlListAllPages)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var pages []SpinePage
	tagOf := make(map[string]string)
	for rows.Next() {
		var p SpinePage
		var tag string
		if err := rows.Scan(&p.KeyEnum, &p.Label, &p.Href, &p.Kind, &tag, &p.DefaultOrder); err != nil {
			return nil, nil, err
		}
		pages = append(pages, p)
		tagOf[p.KeyEnum] = tag
	}
	return pages, tagOf, rows.Err()
}

// assembleSpine is pure: nests pages under their bucket by tag_enum, and
// collects pages whose tag matches no bucket into Untagged.
func assembleSpine(buckets []SpineBucket, pages []SpinePage, tagOf map[string]string) SpineResponse {
	byTag := make(map[string]int, len(buckets)) // tag_enum -> index in buckets
	for i := range buckets {
		buckets[i].Pages = nil
		byTag[buckets[i].TagEnum] = i
	}
	var untagged []SpinePage
	for _, p := range pages {
		tag := tagOf[p.KeyEnum]
		if idx, ok := byTag[tag]; ok {
			buckets[idx].Pages = append(buckets[idx].Pages, p)
		} else {
			untagged = append(untagged, p)
		}
	}
	return SpineResponse{Buckets: buckets, Untagged: untagged}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && go test ./internal/navmap/ -run TestAssembleSpine -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Verify the whole package builds**

Run: `cd backend && go build ./internal/navmap/`
Expected: builds clean.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/navmap/service.go backend/internal/navmap/service_test.go
git commit -m "feat(navmap): spine service + pure assembly with untagged collection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Nav-spine HTTP handler

**Files:**
- Create: `backend/internal/navmap/handler.go`

Follow the handler/service/sql layering rule: handler is HTTP-only, calls the service, no SQL.

- [ ] **Step 1: Write the handler**

```go
package navmap

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GetSpine — GET /_site/admin/dev/architecture/spine
// Returns the complete, unfiltered bucket->page tree for the <report> -a map.
func (h *Handler) GetSpine(w http.ResponseWriter, r *http.Request) {
	spine, err := h.Svc.Spine(r.Context())
	if err != nil {
		http.Error(w, "navmap: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(spine); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd backend && go build ./internal/navmap/`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add backend/internal/navmap/handler.go
git commit -m "feat(navmap): GET /architecture/spine handler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Mount the spine route in the composition root

**Files:**
- Modify: `backend/cmd/server/main.go` (construction near other dev handlers ~line 347; mount inside the dev group ~line 1696)

- [ ] **Step 1: Construct the navmap service + handler**

Near the other nav handler construction (around `backend/cmd/server/main.go:347`, after `navH := nav.NewHandler(...)`), add:

```go
	// navmap — unfiltered nav spine for the <report> -a architecture map.
	// Reads pages + pages_tags from servicePool (vector_artefacts). Dev-gated.
	navMapSvc := navmap.New(servicePool)
	navMapH := navmap.NewHandler(navMapSvc)
```

Add the import at the top of the file with the other `backend/internal/*` imports:

```go
	"github.com/<module-path>/backend/internal/navmap"
```

(Find the exact module path by copying the line format of an existing `backend/internal/nav` import in the same file.)

- [ ] **Step 2: Mount the route in the dev group**

Inside the dev route group (the block at `backend/cmd/server/main.go:1696` that contains `r.Get("/dev/api-audit", ...)`), add:

```go
					r.Get("/dev/architecture/spine", navMapH.GetSpine)
```

This places it behind the same `auth.RequirePermission(permResolver, permissions.PortfolioList)` gate as the sibling dev routes, reachable with the dev API key.

- [ ] **Step 3: Verify the server builds**

Run: `cd backend && go build ./cmd/server/`
Expected: builds clean. If the import path is wrong, the compiler names it — fix to match the existing `nav` import.

- [ ] **Step 4: Verify the route responds**

Start/confirm the dev backend is running on `:5100` (it is pinned to `dev`). Then:

```bash
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" \
  "http://localhost:5100/_site/admin/dev/architecture/spine" | python3 -m json.tool | head -30
```

Expected: JSON with a `buckets` array, each bucket carrying a `pages` array. If empty or 500, check the column names (Task 3 Step 2) and the pool (servicePool must be vaPool / vector_artefacts).

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/server/main.go
git commit -m "feat(navmap): mount /dev/architecture/spine under dev gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Register the `architecture` type in the frontend panel

**Files:**
- Modify: `app/lib/apiSite/index.ts:524`
- Modify: `dev/pages/DevReportingPanel.tsx:16`

- [ ] **Step 1: Add the type to the union**

In `app/lib/apiSite/index.ts:524-525`, change:

```ts
export type DevReportType =
  | "research" | "plan" | "security" | "retro" | "code" | "api" | "misc" | "system";
```

to:

```ts
export type DevReportType =
  | "research" | "plan" | "security" | "retro" | "code" | "api" | "misc" | "system" | "architecture";
```

- [ ] **Step 2: Add the tab**

In `dev/pages/DevReportingPanel.tsx`, in the `TYPE_TABS` array (line 16), add a new entry after the `system` tab:

```ts
  { value: "architecture", label: "Architecture" },
```

- [ ] **Step 3: Verify the frontend type-checks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "DevReportingPanel\|apiSite/index" | head`
Expected: no errors referencing these two files. (A clean full `tsc` is ideal; grep keeps the signal focused.)

- [ ] **Step 4: Commit**

```bash
git add app/lib/apiSite/index.ts dev/pages/DevReportingPanel.tsx
git commit -m "feat(dev-reporting): Architecture report type + tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Seed the empty ID registry

**Files:**
- Create: `.claude/arch-map-ids.json`

This file is the stability backbone — the skill reads it to look up IDs and writes it to lock new ones. Seed it empty so the skill has a defined, committed target on first run.

- [ ] **Step 1: Write the seed registry**

```json
{
  "version": 1,
  "report_id": "ARC001",
  "description": "Stable ID registry for the <report> -a architecture site map. Locks bucket/page/section slugs to IDs so re-runs never renumber. Retired entries keep status='retired' and their ID is never reused.",
  "buckets": {},
  "pages": {},
  "sections": {},
  "components": {}
}
```

Key shapes the skill will use (documented here so the skill and registry never drift):
- `buckets`: `{ "<tag_enum>": { "id": "PLAN", "label": "Planning", "status": "active|retired" } }`
- `pages`: `{ "<key_enum>": { "id": "PLAN-WI", "bucket": "PLAN", "label": "Work Items", "route": "/work-items", "status": "active|retired" } }`
- `sections`: `{ "<page_id>.<section_slug>": { "id": "PLAN-WI.01", "label": "Grid toolbar", "status": "active|retired" } }`
- `components`: `{ "<ComponentName>": { "stored_at": "app/components/Grid/Grid.tsx", "tier": "primary|shared|leaf" } }`

- [ ] **Step 2: Verify it is valid JSON**

Run: `python3 -c "import json; json.load(open('.claude/arch-map-ids.json')); print('valid')"`
Expected: `valid`.

- [ ] **Step 3: Commit**

```bash
git add .claude/arch-map-ids.json
git commit -m "chore(arch-map): seed empty ID registry for <report> -a

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Write the `-a` protocol into the skill

**Files:**
- Modify: `.claude/skills/report/SKILL.md` (flags table near top; section templates table; new protocol section)

This task is documentation, not code — the "implementation" of `-a` is the protocol Claude follows. There is no unit test; verification is a structural self-check (Step 4) plus the live build in Task 10.

- [ ] **Step 1: Add the flag to the flags table**

In the `## Flags` table, add a row after the `-sy` row:

```markdown
| `-a` | architecture | Build/refresh the single living site map: every Rail1 bucket → page → purpose + transitive component tree + reverse used-by registry. **Always upserts `ARC001`** — never mints a new id. | `ARC001` (fixed) |
```

- [ ] **Step 2: Add the section-template row**

In the `### Template by type` table, add:

```markdown
| `-a` architecture | Synopsis, Site Overview, Buckets & Pages, Component Registry, Drift Report, Change Log | `synopsis`, `site-overview`, `buckets-and-pages`, `component-registry`, `drift-report`, `change-log` |
```

- [ ] **Step 3: Add the full protocol section**

Add this section after the `## -sy — System paper` section:

````markdown
## `-a` — Architecture site map

### Arguments

```
<report> -a            # build or refresh the living site map (always ARC001)
```

No arguments. **`-a` is a single living document, not a point-in-time series.** First run builds `ARC001`; every later run UPDATES `ARC001` in place and prepends a Change Log entry. It never mints a new id.

### Behaviour — offline except the local dev backend

Draws from the live dev backend (nav spine) + the local filesystem (routes + components). No `WebFetch` / `WebSearch`.

### Pipeline

1. **Load the ID registry.** Read `.claude/arch-map-ids.json`. This is the source of truth for every bucket/page/section/component ID. You LOOK UP ids here; you never regenerate an existing one.

2. **Fetch the nav spine (authoritative bucket→page tree).**
   ```bash
   KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
   curl -s -H "Authorization: Bearer $KEY" \
     "http://localhost:5100/_site/admin/dev/architecture/spine"
   ```
   This returns the COMPLETE catalogue (no role filter) — buckets with nested pages, plus `untagged`.

3. **Assign / look up IDs.**
   - Bucket id: look up `buckets[<tag_enum>]`. If missing, generate a short uppercase code from the label (e.g. "Planning" → `PLAN`; collision → append a digit), write it to the registry with `status:"active"`.
   - Page id: look up `pages[<key_enum>]`. If missing, generate `<BUCKET>-<SHORT>` (short = uppercase consonant-skeleton of the page label/route, e.g. "Work Items" → `WI`; collision → append a digit), write it.
   - Mark any registry bucket/page NOT present in the current spine **and** absent from code (step 4) as `status:"retired"` — never delete, never reuse the id.

4. **Reconcile against code routes (drift).**
   - `Glob` `app/(user)/**/page.tsx` and `dev/pages/*.tsx`. Derive each route path.
   - **Orphans** = code routes with no spine page (match by href/route).
   - **Dead links** = spine pages whose `href` has no route file.
   - **Matched** = the rest (count only).

5. **Resolve per-page component trees — sequential batched sub-agents (~5 pages per batch).**
   For each page, check `.claude/arch-map-cache.json`: compute a content hash of the route file + the page-local (primary-tier) files it imports. If unchanged since last run, REUSE the cached tree (skip the agent). Otherwise spawn a sub-agent (`subagent_type: general-purpose`) with the PER-PAGE BRIEF below. Run agents in batches of ~5, sequentially (await each batch before the next) to control token spend.

6. **Build the reverse component registry.** Invert every page's tree: for each component, record `stored_at`, `tier`, and the list of page ids that use it. Persist component metadata (`stored_at`, `tier`) to the registry.

7. **Render the HTML body** matching the section template (§ Template by type) — see LAYOUT below.

8. **Upsert `ARC001`.** GET the existing report first to read its Change Log; prepend a new `<li>` describing what changed (pages added / retired / re-analysed, component count delta). POST with the fixed id `ARC001`. On first run the Change Log is "Initial build."
   ```bash
   curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     --data @/tmp/arc001.json "http://localhost:5100/_site/admin/dev/reporting/"
   ```

9. **Write back both `.claude/` files** (`arch-map-ids.json`, `arch-map-cache.json`) and commit them with the report-build message.

10. **Tell the user:** "Site map refreshed (ARC001). View on /dev/reporting → Architecture tab. N buckets, N pages, N components; drift: X orphans, Y dead links." Show the Synopsis inline.

### PER-PAGE BRIEF (verbatim — substitute `{{ROUTE_FILE}}`, `{{PAGE_NAME}}`, `{{PAGE_ID}}`)

You are mapping ONE page of the Vector site for an architecture site map.

**Page:** {{PAGE_NAME}} (id `{{PAGE_ID}}`)
**Route file:** {{ROUTE_FILE}}

Your job:
1. Read the route file. Summarise the page's PURPOSE in 1–2 sentences (use its `<PageDescription>` text if present, plus what the components imply).
2. Resolve the FULL TRANSITIVE component tree. Start from the page's imports; follow project-local component imports recursively (use `lsp-ts` references / definitions where helpful). Stop at node_modules / std-lib.
3. Classify every node into a tier:
   - **primary** — page-local assemblers (files under the page's own route dir, or named for this page).
   - **shared** — anything under `app/components/`.
   - **leaf** — icons (react-icons / `app/components/icons`), pure utils, tiny wrappers.
4. Identify natural SECTIONS of the page (header, toolbar, main tree/grid, side panels, modals) — these become the page's sub-sections. Give each a short stable slug.
5. Return ONLY structured JSON (no prose) with this shape:
```json
{
  "page_id": "{{PAGE_ID}}",
  "purpose": "…",
  "sections": [{ "slug": "toolbar", "label": "Grid toolbar", "components": ["GridToolbar", "Button"] }],
  "components": [{ "name": "Grid", "stored_at": "app/components/Grid/Grid.tsx", "tier": "shared" }]
}
```
Cite real file paths. Do not invent components. Leaf-tier components may be listed by name without expanding their internals.

### LAYOUT (HTML body)

- `<h2 id="synopsis">` — counts + last-build date + headline.
- `<h2 id="site-overview">` — a `<table>`: Bucket ID · Bucket · Page count.
- `<h2 id="buckets-and-pages">` — per bucket, per page: `<h3 id="<PAGE_ID>">{{PAGE_NAME}}</h3>`, then purpose, route, and the tiered tree. Each page section uses `<h4 id="<PAGE_ID>.NN">` for its sub-sections (Primary tier expanded; Shared listed; Leaf collapsed to "N leaf: name, name, …").
- `<h2 id="component-registry">` — a `<table>`: Component · Stored at · Tier · Used by (page ids).
- `<h2 id="drift-report">` — Orphans list, Dead links list, Matched count.
- `<h2 id="change-log">` — newest first.

### Hard rules

- **Never mint a new report id.** `-a` is always `ARC001`. To "version" the map, the Change Log carries the history.
- **Never regenerate an existing ID.** Look up from `.claude/arch-map-ids.json`; only generate for genuinely new slugs; retire (never delete/reuse) for vanished ones.
- **Stay on the dev backend.** Spine comes from `:5100`; do not psql-guess the nav tables.
- **Commit the two `.claude/` files** every run so the registry/cache travel with the repo.
````

- [ ] **Step 4: Structural self-check**

Run: `grep -n "^| \`-a\`\|## \`-a\`\|architecture | Synopsis" .claude/skills/report/SKILL.md`
Expected: 3 matches — the flags-table row, the protocol heading, and the section-template row.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/report/SKILL.md
git commit -m "feat(report): -a architecture site-map protocol

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: End-to-end first build (acceptance)

This task runs the new flag for real and confirms the living-doc contract holds. No code — it exercises everything above.

- [ ] **Step 1: Confirm wiring is live**

Run:
```bash
cd backend && go build ./cmd/server/ && echo "go-ok"
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" "http://localhost:5100/_site/admin/dev/architecture/spine" | python3 -c "import sys,json; d=json.load(sys.stdin); print('buckets', len(d['buckets']), 'untagged', len(d.get('untagged',[])))"
```
Expected: `go-ok` and a non-zero bucket count.

- [ ] **Step 2: Run the first build**

Invoke `<report> -a`. The skill executes the Task 9 pipeline. Expected end state:
- `ARC001` exists (`curl … /dev/reporting/?type=architecture` returns 1 report).
- `.claude/arch-map-ids.json` now has populated `buckets` / `pages` / `sections` / `components`.
- `.claude/arch-map-cache.json` exists with per-page hashes.

Verify:
```bash
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" "http://localhost:5100/_site/admin/dev/reporting/?type=architecture" | python3 -c "import sys,json; r=json.load(sys.stdin)['reports']; print([x['id'] for x in r])"
python3 -c "import json; d=json.load(open('.claude/arch-map-ids.json')); print('pages', len(d['pages']), 'components', len(d['components']))"
```
Expected: `['ARC001']`; non-zero pages + components.

- [ ] **Step 3: Verify the Architecture tab renders**

Open `/dev/reporting` in the dev app, click the **Architecture** tab (count = 1), open `ARC001`. Confirm the TOC shows Synopsis · Site Overview · Buckets & Pages (with per-page sub-entries) · Component Registry · Drift Report · Change Log, and that page sub-section anchors (`PLAN-WI.01` style) jump correctly.

- [ ] **Step 4: Verify ID stability (the core contract)**

```bash
cp .claude/arch-map-ids.json /tmp/arc-ids-before.json
```
Run `<report> -a` again with NO code changes. Then:
```bash
diff <(python3 -c "import json; d=json.load(open('/tmp/arc-ids-before.json')); print(json.dumps({k:d[k] for k in ['buckets','pages','sections']}, sort_keys=True))") \
     <(python3 -c "import json; d=json.load(open('.claude/arch-map-ids.json')); print(json.dumps({k:d[k] for k in ['buckets','pages','sections']}, sort_keys=True))") \
  && echo "IDS-STABLE"
```
Expected: `IDS-STABLE` (no renumbering). The `ARC001` Change Log should have gained a second entry while the body is otherwise unchanged.

- [ ] **Step 5: Verify incremental re-analysis**

Touch one page's primary file (a trivial whitespace edit + revert is fine, or note a real change), run `<report> -a`, and confirm the new Change Log entry names exactly that page as re-analysed while other pages' cache hashes are unchanged. Revert any throwaway edit.

- [ ] **Step 6: Final commit (registry + cache state from the real build)**

```bash
git add .claude/arch-map-ids.json .claude/arch-map-cache.json
git commit -m "chore(arch-map): first ARC001 build — populated ID registry + cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §3 artefacts → Tasks 8 (ids), 9/10 (cache + report); §4 ID scheme → Task 9 step 3 + Task 8 shapes; §5 spine+reconciliation → Tasks 2–6 (spine) + Task 9 step 4 (drift); §6 per-page anatomy → Task 9 PER-PAGE BRIEF + LAYOUT; §7 reverse registry → Task 9 step 6 + LAYOUT; §8 build engine → Task 9 step 5; §9 four touch-points → Tasks 1, 7, 9 (the skill is the 4th); §10 section template → Task 9 step 2; §11 payload → Task 9 step 8; §13 verification → Task 10 (all five checks present). No gaps.
- **Single-living-doc** reinforced in Task 9 (flag row, hard rules) and Task 10 step 4 (stability test) — matches the user's "don't create new reports, just update" directive.
- **On main** — no branch/worktree task; matches user directive.
- **Type consistency:** `assembleSpine(buckets, pages, tagOf)` signature identical in test (Task 4 step 1) and impl (step 3); `SpineResponse`/`SpineBucket`/`SpinePage` field names consistent across Tasks 2, 4, 5; route path `/dev/architecture/spine` identical in Tasks 5, 6, 9, 10.
- **Placeholder scan:** module import path in Task 6 step 1 is intentionally "copy the existing nav import" (the repo's module path is environment-specific; the instruction is concrete — mirror the sibling import) — not a TODO.
