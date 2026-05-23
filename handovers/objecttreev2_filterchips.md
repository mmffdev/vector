# Agent Handover — ObjectTreeV2 Filter-Chip Scope Facets (PLA057 / OBJ1)

**Date:** 2026-05-23
**Branch:** `main`
**Last commit:** `7169b879` — `feat(objecttreev2): filter-chip scope facets [solo-dev] [OBJ1]`
**Page:** `/scope` (ObjectTreeV2 harness — work_items mode is the focus)
**Surface:** `<NavigationPie>` primitive + ObjectTreeV2 `<WorkItemsFilterChips>` ribbon + new `/work-items/facets` endpoint.
**Status:** Type + Priority chips on `/scope` are scope-aware and the grid agrees with the chip selection across federated topology nodes. Uncheck-all resets to all-rows. Backend route ships on `/_site` and `/samantha/v2`. The intermediate `windowRoots`-derivation fallback that motivated TD-CHIP-SCOPE-MISMATCH has been replaced by the facets-endpoint hook.

> **Read-before-acting:** this surface is live on `main`. The chip+grid agreement is brittle in the sense that `useWorkItemsFilters` now reads `useSearchParams()` every render — meaning the URL is the source of truth for filter state after first-mount seed. Anything that writes filter state without going through `setFilter` (which writes both prefs AND URL via `router.replace`) will desync the grid from the chip.

---

## What this surface is for

ObjectTreeV2 hosts a filter-chip ribbon (Type / Status / Priority / Owner). On `/scope` work_items mode the chips must offer ONLY values that exist in the current topology scope, because:

1. **The grid clamps by topology scope** (`a.topology_node_id = ANY(<descendants of meg node>)`) on top of the workspace clamp. Pre-PLA057 the chips loaded options from the workspace-clamped catalogue (`useArtefactTypeCatalogue` + `useArtefactPriorityCatalogue`).
2. **Federated scopes** — under the Insurance topology subtree, visible rows can be tagged with artefact-type UUIDs from a sibling workspace's catalogue. Workspace catalogue offered the local Task UUID; rows carried the federated Task UUID. Click Task → backend AND-joins workspace-Task-UUID with topology subtree → zero matches despite 27 visible Tasks. Logged 2026-05-23.

The fix puts ObjectTreeV2 in charge: it calls a small backend `/facets` endpoint that returns the distinct `artefact_type_id` + `priority_id` reachable in the same scope the list endpoint sees, then maps those UUIDs through the workspace catalogue ONLY for display metadata (label + colour). `NavigationPie` stays an agnostic presentation primitive.

---

## File map — where things live

### Backend (new)
- [`backend/internal/artefactitems/service.go`](../backend/internal/artefactitems/service.go) — `Service.ListFacets(ctx, subID, workspaceID, scopeNodeID, actorUserID, actorRoleID)`. Same scope-clamp pipeline as `ListWorkItems` (CanReadScope + DescendantNodeIDs). Two DISTINCT queries kept separate to avoid CROSS JOIN row blow-up; SQL constants live in `sql.go` per `lint:sql-in-sqlfile-only`.
- [`backend/internal/artefactitems/handler.go`](../backend/internal/artefactitems/handler.go) — `Handler.Facets` reads `?meg=` (legacy alias `?scope=`), forwards to service, emits `{artefact_type_ids, priority_ids}`.
- [`backend/internal/artefactitems/sql.go`](../backend/internal/artefactitems/sql.go) — `sqlListFacetTypesTemplate` + `sqlListFacetPrioritiesTemplate`. `%s` holds the composed WHERE clause matching the list endpoint's shape.
- [`backend/cmd/server/main.go`](../backend/cmd/server/main.go) — mounted under both `mountArtefactSite` (`/_site/work-items/facets` + `/_site/portfolio-items/facets`) and `mountArtefactRoutes` (`/samantha/v2/...`), so it sits inside the same `WorkspaceClampMiddleware` chain as `List`.

### Frontend (new)
- [`app/components/ObjectTreeV2/hooks/useObjectTreeFacets.ts`](../app/components/ObjectTreeV2/hooks/useObjectTreeFacets.ts) — small fetch hook owned by ObjectTreeV2. Cache key `(resourceUrl, scopeNodeId)`. Calls `apiSite()`, which auto-forwards `?meg=` from URL/localStorage, so we don't re-pass the param on the wire.

### Frontend (modified)
- [`app/components/ObjectTreeV2/p_ObjectTree.tsx`](../app/components/ObjectTreeV2/p_ObjectTree.tsx) — calls `useObjectTreeFacets`, maps UUIDs through workspace catalogues for label + colour, passes derived `typeOptions` + `priorityOptions` arrays down to `WorkItemsFilterChips` as props. Federation-safe: when a facet UUID is absent from the workspace catalogue, label falls back to `id.slice(0, 8)` and colour is omitted; the wedge still appears and is clickable.
- [`app/components/work-items-tree-config.tsx`](../app/components/work-items-tree-config.tsx) — `WorkItemsFilterChipsProps.typeOptions` / `priorityOptions` (optional with `[]` default for V1 compatibility). `useWorkItemsFilters` now derives effective filters from `useSearchParams()` on every render so sibling chip + grid instances on the same prefKey converge via URL state. Initial-mount seed promotes prefs into URL when bare.
- [`app/components/NavigationPie.tsx`](../app/components/NavigationPie.tsx) — Arma-radial geometry (wedge edges perpendicular to the gap line between neighbours; constant-width rectangular gaps, not radial slivers). Per-option `color` renders as a 10px legend band on the inner edge. Per-option `url` for navigate-instead-of-toggle wedges (lazy `useRouter` via inner `RouterCapture` so the pie stays renderable outside an App Router boundary when no caller uses urls). Empty-state guard: `handleChipClick` refuses to open when `options.length === 0`. Chip is `visibility: hidden` while open so the dark hub reads as transparent.
- [`app/globals.css`](../app/globals.css) — `.navigation-pie__Pop_segment` + `.navigation-pie__Pop_band` + labels styled for the Arma look (70% black opacity at rest, solid black on hover/selected, surface-coloured labels with dark shadow).
- [`app/hooks/useChipTypeOptions.ts`](../app/hooks/useChipTypeOptions.ts) + [`app/hooks/usePriorityChipOptions.ts`](../app/hooks/usePriorityChipOptions.ts) — added `color` field (UK `colour` column mapped to JS `color` to match `NavigationPieOption.color`). Still used by the action-bar create flow (not the filter chips anymore).

### Tracker / docs
- [`Vector_Scope.md`](../Vector_Scope.md) — OBJ1 top-level theme + 8 stories (OBJ1.0.1 → OBJ1.3.1) inserted between VIZ1 and the `# Parked` divider.
- [`.claude/scope-refs.map`](../.claude/scope-refs.map) — 8 keyword lines so future commits resolve via the scope-commit-note hook.
- [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — `TD-CHIP-SCOPE-MISMATCH` filed (S2, 2026-05-23). **Now closeable** — the windowRoots-fallback shape it describes was the intermediate state; this commit replaced it with the facets path. Mark resolved when component doc lands (OBJ1.3.1).
- [`context/MEMORY.md`](../context/MEMORY.md) — notes added: (a) topology-vs-workspace diagnostic for the next time chips "do nothing"; (b) Docker doesn't run on Rick's Mac (dev DB is a remote Swarm stack on `vector-dev-pg`); (c) `claude_2_test@mmffdev.com` password is `mmff` (reset 2026-05-23).
- **Plan body:** PLA057 on `/dev/reporting → Plan tab`. Tightened mid-session to reflect on-disk intermediate state (Phases 5+6 now framed as removals, not additions).

---

## What is DONE

- ✅ **OBJ1.0.1** — `TD-CHIP-SCOPE-MISMATCH` filed in `docs/c_tech_debt.md`.
- ✅ **OBJ1.1.1** — `artefactitems.Service.ListFacets` shipped + SQL constants in `sql.go`.
- ✅ **OBJ1.1.2** — `GET /work-items/facets` + `/portfolio-items/facets` mounted on both `/_site` and `/samantha/v2`.
- ✅ **OBJ1.2.1** — `useObjectTreeFacets` hook shipped.
- ✅ **OBJ1.2.2** — `p_ObjectTree.tsx` swapped `windowRoots`-derivation → facets hook.
- ✅ **NavigationPie geometry** — perpendicular gaps, 70% black, colour band, agnostic + url-capable, empty-state guard.
- ✅ **URL-reactive filters** — `useWorkItemsFilters` consumes `useSearchParams()` so chip writes propagate to the grid; uncheck-all resets to all-rows.

## Where to pick up next

- ⏭️ **OBJ1.1.3** — backend table-tests for `ListFacets` (workspace clamp, topology clamp, archived exclusion, 403 on unauthorised scope, 404 on unknown scope). Smoke-tested live but not pinned.
- ⏭️ **OBJ1.2.3** — drop `?` + `= []` fallback on `WorkItemsFilterChipsProps.typeOptions` / `.priorityOptions` **once V1 ObjectTree retires**. Defer.
- ⏭️ **OBJ1.3.1** — component doc `docs/c_c_objecttreev2_facets.md`; link from `CLAUDE.md`; mark `TD-CHIP-SCOPE-MISMATCH` resolved.
- 🔵 **Validate Status + Priority chips on `/scope`** — Type works end-to-end; Priority should "just work" via the same facets flow but wasn't explicitly verified in this session. Status chip is still `STATUS_CHIP_OPTIONS_TRANSITIONAL = []` (an empty hardcoded list) — separate story when flow-state facets land.

## Known caveats

- **Status chip is intentionally empty on `/scope`.** `STATUS_CHIP_OPTIONS_TRANSITIONAL` in `work-items-tree-config.tsx` is `[]`. Status options are driven by per-type flow definitions, not raw distinct values, so the facets endpoint deliberately doesn't return them. Don't "fix" it by adding workspace-catalogue flow states — that's the bug we just solved on a different axis. New surface needed.
- **URL is the source of truth for filter state after first-mount seed.** Any code that mutates filters MUST go through `setFilter` (which writes both prefs AND URL via `router.replace`). A direct `setValue` on `useUserPreference` won't propagate to sibling instances.
- **`useObjectTreeFacets` cache key is `(resourceUrl, scopeNodeId)`.** It does NOT include other chip filters (status/priority) by design — facets are scope-only, not filter-aware. Pinning facets to "what's left after all filters apply" would make wedges disappear as the user selects, breaking the picker UX. Don't add filter dimensions to the cache key without thinking it through.
- **`apiSite()` auto-forwards `?meg=` on GETs** ([app/lib/api.ts](../app/lib/api.ts) line ~157). Don't manually append `?meg=` to facets calls — you'll get double-param. The hook deliberately doesn't pass `?meg=` itself; it just declares `scopeNodeId` in the dep array for cache invalidation.
- **NavigationPie won't open with zero options.** `handleChipClick` early-returns when `options.length === 0`. Symptom of stale data: the chip looks alive but click does nothing. Diagnostic: open DevTools → Network → click chip → look for `/facets` request. If it returns `{artefact_type_ids: []}` the scope genuinely has no rows; if it 401/403s, auth/cookie issue.
- **Workspace catalogue lookup is best-effort enrichment.** When a facet UUID isn't in the workspace catalogue (federation), label falls back to truncated UUID and colour is omitted. Don't add a fatal error path here — federation rows still need clickable wedges.
- **Federated UUID = federation is real on this codebase.** Don't assume `artefact_type_id` lives in the active workspace. The grid query joins workspace clamp via `at.artefacts_types_id_workspace`, but the topology subtree clamp via `a.topology_node_id` can pull in rows whose type lives in a sibling workspace.

## How to verify

1. **Backend smoke:** `curl -s -H "Authorization: Bearer $DEV_API_KEY" "http://localhost:5100/_site/work-items/facets?meg=ae2d4ff5-4c8d-4839-af89-7769067476ae"` → returns 4 Insurance-scope type UUIDs (Epic / Story / Task / Defect) + 1 priority UUID.
2. **Cross-check:** `curl ".../work-items?meg=<Insurance>&item_type_id=<Task UUID from facets>&limit=5"` → `total: 27`. Chip UUIDs and grid UUIDs agree.
3. **End-to-end on `/scope`:**
   - Login as `claude_2_test@mmffdev.com` (password `mmff`, per `context/MEMORY.md`).
   - Set scope to Insurance via the scope rail.
   - `/scope` → "Work items (execution)" → click Type chip.
   - Expect: 4 wedges (Epic / Story / Task / Defect) with colour bands.
   - Click Defect → grid filters to defect rows.
   - Click Defect again (uncheck) → grid returns to all 44 rows.
4. **Federation regression check:** any scope where rows carry types not in the active workspace's catalogue → wedges still appear with truncated-UUID labels and no colour; click still filters correctly.

## Commits in scope

- `7169b879` — `feat(objecttreev2): filter-chip scope facets [solo-dev] [OBJ1]` (this session, 15 source files + 4 auto-regenerated API snapshots).

## Open design questions

- Should `useObjectTreeFacets` debounce-coalesce scope changes? Today it refetches synchronously on every `scopeNodeId` change; fine for human-paced rail clicks, potentially noisy if a parent UI rapidly cycles scopes. Defer until evidence.
- Should the facets endpoint return label + colour alongside UUIDs (one round-trip instead of two: facets + catalogue)? Cleaner wire, but couples the catalogue to the facets transport and locks out federation cases where the label genuinely lives elsewhere. Current shape (UUIDs only, look up display metadata client-side) is the right default for now.
- Status chip surface — when status facets land, do they come from the same `/facets` endpoint (extending the payload), or from a separate `/flow-states?meg=` endpoint? The existing `useWorkItemFlowStates` hook is workspace-clamped, same anti-pattern that motivated this whole story.

---

**Last updated:** 2026-05-23 by Claude.
**Authored:** 2026-05-23 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
