# Handover — Custom Fields admin redesign (live state @ 2026-05-29 00:41)

**Filed:** 2026-05-29 00:41 (local) — after the late-night build session
**State:** End-to-end on `main` (not pushed). 14 commits this session above the previous handover's HEAD. Backend rebuilt and running on `:5100` (fresh `/tmp/vector-server-fresh` binary). Dev DB tunnel up. Next dev server up.

---

## tl;dr — what landed

The custom-fields admin page is now a single `<ObjectTreeV2>` mount with:
- The grid (Label · Name · Type · Scope · Updated columns) reading directly from the existing `/workspaces/{id}/fields` endpoint via the adapter's `fetchPage` translator.
- The scope filter chip (All / Workspace / Tenant / Global) in the ActionBar instead of the WorkItem chips (Type/Status/Priority/Owner).
- A single **Create New** button in the ActionBar that opens the create flyout (the standalone black "Create Field" button was deleted).
- A two-column flyout BELOW the clicked row for edit (form left, `<TypeBindingsPicker>` right).
- A `/[id]` route segment that deep-links straight into the flyout for that field (no URL query state — PLA-0053 path-only rule).

The three-`<Panel>`-`<Table>` layout and the 424-line `[id]` editor are gone. Net: 665 LOC deleted vs 285 added across the build.

---

## What's running right now (post-cleanup)

| Port | Service | PID | State |
|---|---|---|---|
| 5100 | backend (`/tmp/vector-server-fresh`) | 18152 | UP — fresh build with all this-session commits |
| 5101 | Next.js dev server | 83273 | UP (unchanged from before session) |
| 5435 | SSH tunnel to dev Postgres (forward → 77.68.33.216:5432) | 17880 | UP — fresh tunnel |
| 6379 | tunnel forward → dev Valkey | 17880 | UP (forwarded by same tunnel) |
| 3003, 7575, 8085, 3002, 3100, 5672, 15673 | tunnel forwards (Loki, Grafana, etc.) | 17880 | UP |

### Zombie clean-up performed
- **PID 83284** — `MMFF Vector Launcher.app` (had been running 3h38m, was stuck). Killed.
- **PID 22706** — stale `ssh -N mmffdev-pg` (prod tunnel that wasn't forwarding). Killed.
- **PIDs 69154 + 42874** — fragment `ssh` processes still holding 3003 + 6379 from a previous failed tunnel attempt. Killed.
- **PID 16734** — duplicate prod `ssh -N mmffdev-pg` (spawned during cleanup). Killed.

### Left ALONE (not Vector's)
- **PID 90232** — `Codex.app` (your code editor / AI assistant). Don't kill this.
- **PID 90322** — `<defunct>` zombie child of Codex.app. Harmless; Codex must reap it (we can't).

---

## Commits this session (14, above last handover)

```
1d862ead refactor(otv2): finish adapter routing — columns + chips + fetch + create-action
a1ef0566 docs(handover): OTV2 generic + custom-fields admin redesign COMPLETE
0a6ecb55 feat(custom-fields): mount OTV2 on list page; route-segment deep link
4c48548c refactor(otv2): genericise p_ObjectTree to <T> via adapter; WorkItemsAdapter default
68edf0f4 feat(otv2): CustomFieldsAdapter + EditForm + Flyout + .action-btn family
10542058 feat(otv2): extract WorkItemsAdapter from p_ObjectTree inline code
8fb552e3 feat(otv2): adapter interface — ObjectTreeAdapter<T>
613c25d5 docs(plan): OTV2 generic + custom-fields admin — 6 tasks
a05e0624 docs(spec): finish OTV2 refactor + custom-fields admin redesign
ae4f6587 fix(custom-fields): sort picker padding + drop inline styles
4a48c02c fix(custom-fields): repaint TypeBindingsPicker to project tokens
3a0557b3 fix(custom-fields): rename Scope dropdown → Visibility; clarify vs Applies-to
c5a246f1 feat(fields): mount TypeBindingsPicker on custom-fields editor; bind-on-save
3446f6f4 feat(fields): TypeBindingsPicker component + .type-bindings-picker__* CSS family
```

Plus the merge commit `a89ca557` and the chore `4d7c6e0a` from this session's earlier push.

---

## Architecture in one paragraph

`<ObjectTreeV2>` is now row-type generic. Its prop signature is `<T = WorkItem>` and it accepts an optional `adapter?: ObjectTreeAdapter<T>`. When omitted (the 5 production mounts: work-items, portfolio-items, risk, value-sprint x2), the inline WorkItem orchestration runs unchanged. When supplied, the component routes through the adapter for four orchestration paths:

1. **Columns** — `adapter.buildColumns(ctx)` runs instead of `buildWorkItemsColumns` when the adapter is set.
2. **Filter chips** — `adapter.useFiltersAndSort(opts).filterChips` wins over `wizardConfig.filterChips` and the inline `<WorkItemsFilterChips>`.
3. **Fetch** — `adapter.fetchPage(params)` translates the endpoint's native shape into the OTV2 `{items, total}` envelope; bypasses the default `apiSite<FetchResponse<T>>` call. CustomFields uses this to translate `{workspace_id, fields}` → `{items, total}`.
4. **Create-action** — when adapter is set, the ActionBar's "Create New" becomes a single-mode button that calls `setCreateFlyoutOpen(true)`. The adapter's `renderCreateFlyout` mounts above the grid.

Plus the per-row flyout: row click sets `flyoutRowId`; `adapter.renderRowFlyout(row, ctx)` mounts BELOW `<ResourceTree>`.

---

## File map

### New files (8)
- `app/components/ObjectTreeV2/adapters/types.ts` — `ObjectTreeAdapter<T>` interface (123 LOC; includes `fetchPage`, `useFiltersAndSort`, `useExtras`, `buildColumns`, `patchRow`, `buildCreateAction`, optional `renderRowFlyout` / `renderCreateFlyout` / `buildRowButtons`).
- `app/components/ObjectTreeV2/adapters/workItemsAdapter.tsx` — WorkItemsAdapter (398 LOC). Parallel to the inline code; not yet promoted to default. See "Open / deferred" below.
- `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` — CustomFieldsAdapter. Implements `fetchPage` (calls `getWorkspaceFields`, drops global-scope rows), `buildColumns`, `useFiltersAndSort`, `patchRow`, `buildCreateAction`, `buildRowButtons` (Edit + Archive), `renderRowFlyout`, `renderCreateFlyout`.
- `app/components/ObjectTreeV2/configs/p_wizard_custom_fields.json` — sidecar with `resourceUrl: "/workspaces/{workspace_id}/fields"`.
- `app/components/CustomFields/CustomFieldEditForm.tsx` — controlled component with the form state machine lifted from the legacy `[id]/page.tsx`. Hydrates bindings; Save handler is a faithful port (PATCH/POST field → replace bindings → error surface).
- `app/components/CustomFields/CustomFieldFlyout.tsx` — thin shell (header + EditForm).
- `app/components/CustomFields/CustomFieldsPageBody.tsx` — reusable list-page body (lives outside `app/(user)/...` because Next.js page.tsx files can't export named components).
- `app/components/CustomFields/TypeBindingsPicker.tsx` — landed earlier; unchanged this session except a className compose for `.action-btn--danger`.

### Modified files (in addition to above)
- `app/components/ObjectTreeV2/p_ObjectTree.tsx` — `<T = WorkItem>` signature; new `adapter` prop + `initialCreateFlyoutOpen` prop; adapter columns/chips/fetch/create-action wiring; flyout slots.
- `app/components/ObjectTreeV2/hooks/useObjectTreeWindow.ts` — new optional `fetchPage` option that bypasses the default fetch when supplied.
- `app/components/ObjectTreeV2/kinds/ActionBar.tsx` — exported the previously-private `CreateActionChip` so adapters can reuse the chip surface.
- `app/(user)/workspace-admin/custom-fields/page.tsx` (13 LOC) — thin delegator.
- `app/(user)/workspace-admin/custom-fields/[id]/page.tsx` (21 LOC) — thin delegator; reads `id` from `useParams`; mounts `<CustomFieldsPageBody initialOpenId={id} initialCreateMode={id === "new"} />`.
- `app/globals.css` — `.action-btn` family (default + `--primary` + `--danger`), `.custom-field-flyout`, `.custom-field-edit-form__Columns` (with `@media (max-width: 1024px)` single-column collapse), `.custom-fields-scope-chip`, `.objecttree__Row_adapter_flyout_open`.
- `dev/registries/page_description_exempt.json` — both new delegator routes exempted with rationale.

---

## Verification status

| Check | Result |
|---|---|
| `cd backend && go build ./...` | clean |
| `cd backend && go test ./internal/fields/... ./internal/savedviews/...` | PASS (cached + integration green at the last full run earlier this session) |
| `npx tsc --noEmit` | clean except pre-existing `app/(user)/scope/page.tsx(106,8)` — uncommitted WIP from before this session |
| `lint:addressables` | OK |
| `lint:page-description` | OK (delegators exempted) |
| `lint:savedviews-writer-only` | OK |
| `lint:savedviews-context-free` | OK |
| Backend running on :5100 (fresh build) | UP |
| Next dev on :5101 | UP |
| DB tunnel :5435 | UP |

**Not yet verified:** end-to-end smoke against the live page. User to reload `/workspace-admin/custom-fields` and confirm:
1. Single grid, no 3-panel layout.
2. ActionBar shows Search + Scope chip + "Create New" button.
3. Grid renders rows (Label / Name / Type / Scope / Updated columns).
4. Row click opens flyout below the row.
5. "Create New" opens flyout above the grid.
6. `/workspace-admin/custom-fields/<id>` deep-links open the flyout pre-loaded.

---

## Known caveats / deferred

1. **WorkItemsAdapter not yet promoted to default inside p_ObjectTree.tsx.** Today the inline WorkItem code path still runs when no adapter is passed; the WorkItemsAdapter is parallel and tsc-clean but unused by production mounts. Promoting it needs careful hook-order preservation. File as **TD-OTV2-WORKITEMS-ADAPTER-PROMOTE** when ready to ship.

2. **Sortable column headers in CustomFieldsAdapter.** `useFiltersAndSort` returns initial `label`/`asc` but doesn't wire column-header clicks yet. OTV2 grid supports it; adapter just needs `setSort` to thread through.

3. **Scope filter doesn't reach `useObjectTreeWindow`'s query params yet.** The chip updates `filtersRef` but the fetch ignores it (CustomFields' `fetchPage` ignores params; it returns all rows and React-side filters can't happen yet). Quick follow-up.

4. **Pagination on `/workspaces/{id}/fields`** — endpoint returns all rows. Fine at 66 live. Revisit at ~500.

5. **Pre-existing `app/(user)/scope/page.tsx` tsc error** — uncommitted WIP that was on main when this session started. Not mine.

6. **Uncommitted WIP in `p_ObjectTree.tsx`** — `urlPrefix`/`hideExpanders`/`showHeader` props came from someone's prior work and got pulled into my Task 4 commit because they were dirty on disk. Behaviour parity preserved.

---

## How to resume

```bash
# (1) Verify everything's still running:
lsof -nP -iTCP:5100 -sTCP:LISTEN   # backend
lsof -nP -iTCP:5101 -sTCP:LISTEN   # next dev
lsof -nP -iTCP:5435 -sTCP:LISTEN   # db tunnel

# (2) If backend is down:
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend"
go build -o /tmp/vector-server-fresh ./cmd/server
BACKEND_ENV=dev APP_ENV=development /tmp/vector-server-fresh > /tmp/vector-server.log 2>&1 &

# (3) If tunnel is down:
ssh -fN vector-dev-pg

# (4) Tail backend log:
tail -f /tmp/vector-server.log

# (5) Smoke:
open http://localhost:5101/workspace-admin/custom-fields
```

---

## Push status

Branch `main` is **+51 commits ahead of origin/main**. Not pushed. Awaits your say-so.

To push: `git push origin main` (the API-diff hook will warn about additive route changes — that's not a real breaking change, just the snapshot delta).
