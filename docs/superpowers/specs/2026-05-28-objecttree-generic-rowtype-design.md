# ObjectTreeV2 — Generic Row Type & Custom-Fields Admin Surface

**Date:** 2026-05-28
**Branch:** `main` (post saved-views + custom-field-bindings merge)
**Status:** Draft (autonomous mode; user out)
**Origin:** User flagged that the custom-fields list page should look like work-items (`<ObjectTreeV2>` chrome, ActionBar with "Create Field", flyout edit below the row, themed action buttons). Investigation showed the OTV2 refactor genericised the data-fetch (`useObjectTreeWindow<T>`) and the renderer (`ResourceTree<WorkItem>`) but the **orchestration layer in `p_ObjectTree.tsx` still hardcodes the WorkItem story** (columns builder, filters, sort, flowStates, patch handler, addressable hooks). The prop signature pins `WorkItem` even though the inner generics are ready.

This spec finishes the refactor: push the `WorkItem` generic all the way through the component's prop surface, extract the WorkItem-specific orchestration into a sidecar-driven adapter, and mount a `custom-fields` instance on the workspace-admin page.

---

## 1. Synopsis

Two complete pieces of work, designed together because they're each other's forcing function:

1. **Generalise `<ObjectTreeV2>` to `<T>`** — prop signature, sidecar config, columns builder, filters, sort prefs, row-patch handler. The WorkItem-specific bits move behind a per-data-type adapter so the component body is type-agnostic. Existing 5 production mounts (work-items, portfolio-items, risk, value-sprint x2) keep working — they pass `<WorkItem>` explicitly and a WorkItems adapter does the orchestration. (Net: zero regression for production surfaces.)

2. **Custom-fields admin redesign** — drop the 3-panel `<Table>` layout, drop the "Create field" form panel, drop the wrapper "Custom Fields" panel, mount one `<ObjectTreeV2<WorkspaceField>>` that resembles the work-items chrome. ActionBar gets a "Create Field" button (replaces the old top form). Edit form moves into a **two-column flyout below the clicked row**: left column = field properties (name, label, data type, visibility, description, options); right column = the existing `<TypeBindingsPicker>`. All "Edit" / "Archive" / "Remove" buttons in the picker use the project's standard button class — no more dark slabs.

The `/workspace-admin/custom-fields/[id]` route stays for deep-linking; it redirects to the list page with `?open=<id>` so the flyout opens for that row.

---

## 2. Problem

### 2.1 Why the existing list is wrong
- Three `<Panel>`-wrapped `<Table>` instances (Tenant / Workspace / Global) plus a top "Create field" form panel. Four panels on one page; visual noise; the form panel duplicates what an "Add" action belongs on.
- Per-row Edit / Archive buttons render as raw dark-slab buttons — wrong theme tokens, jarring against the rest of the admin chrome (the work-items page has a clean ActionBar story).
- Clicking Edit navigates to a separate page (`/[id]`) — context-loss for what should be an inline operation.
- The "Acceptance Criteria" duplicate that the user spotted earlier was hidden in the Tenant table — would have been more obvious on a unified dense grid with a sort-by-updated-at column.

### 2.2 Why genericising is the right path
- The refactor commit history is half-done (`useObjectTreeWindow<T>` generic, `ResourceTree<T>` generic, `ObjectTreeDataConfig<T>` generic) but `p_ObjectTree.tsx` still pins `WorkItem` at the prop boundary. That's a half-finished refactor — leaving it that way means every new admin surface (this one, future: artefact-types admin, flow-states admin, role-permissions admin) either copies the chrome (drift) or fakes a WorkItem shape (hack).
- A hack-adapter ("pretend WorkspaceField is a WorkItem") fails the HARD RULE on no-hacks-disguised-as-fixes. The right answer is to finish the refactor.
- The five production OTV2 mounts (work-items, portfolio-items, risk, value-sprint panel + backlog) all pass `<WorkItem>` rows today. They keep working if the new generic defaults to `WorkItem` AND the orchestration body conditionally fires the WorkItem-specific helpers only when the WorkItems adapter is in play.

---

## 3. Goals & non-goals

### Goals
- `<ObjectTreeV2<T>>` accepts any row type. Type parameter flows through every prop (selectedId callback, wizardConfig, rowButtons, refetchRef, onPatched).
- WorkItem-specific orchestration (flowStates fetch, columns builder, filters component, sort prefs, patch endpoints, addressable hooks) moves behind a per-data-type adapter interface. WorkItems gets one adapter; CustomFields gets another.
- All 5 existing production mounts work unchanged — they explicitly pass `<WorkItem>` and the WorkItemsAdapter is selected by default. Verified by tsc + a smoke pass.
- Custom-fields list page mounts a single `<ObjectTreeV2<WorkspaceField>>` with a CustomFieldsAdapter. ActionBar shows a "Create Field" button. Row-click opens an inline two-column flyout (field form + bindings picker). All buttons themed to project standard.
- `/workspace-admin/custom-fields/[id]` stays as a deep-link, redirects to `?open=<id>` on the list page.

### Non-goals
- No new database tables, no new permissions.
- No flow-states integration for custom-fields (catalogue rows don't have flow states).
- No drag-and-drop reordering of catalogue rows (out of scope; can land later if needed).
- No multi-select bulk archive (could be added later; not asked for).
- No saved-views on the catalogue grid (could enable later; not asked for).
- No hierarchy / parent-child on catalogue rows (they're flat).
- We do NOT delete `/[id]/page.tsx` — it becomes a thin redirect, preserving deep-link compatibility.

---

## 4. Architecture

### 4.1 The adapter shape

Replace the hardcoded WorkItem-specific calls in `p_ObjectTree.tsx` with a single `ObjectTreeAdapter<T>` interface. The component asks the adapter for everything WorkItem-specific:

```ts
export interface ObjectTreeAdapter<T> {
  // Build the columns. Replaces the inline buildWorkItemsColumns call.
  // Receives the runtime context (flowStates if applicable, the patch
  // function, colour map, type catalogue) — the adapter decides which it
  // needs. WorkItemsAdapter consumes all; CustomFieldsAdapter ignores
  // flowStates/colourMap/typeCatalogue.
  buildColumns(ctx: AdapterColumnContext<T>): ColumnDef<T>[];

  // Filters + sort surface. Replaces the inline useWorkItemsFilters /
  // useWorkItemsSort hooks. Returns the filterChips React node + the
  // sort state. WorkItemsAdapter returns <WorkItemsFilterChips> + the
  // existing hooks' return; CustomFieldsAdapter returns simpler chips
  // (scope filter: All / Tenant / Workspace / Global) + a basic sort.
  useFiltersAndSort(opts: { prefKey: string; urlPrefix?: string }): {
    filterChips: React.ReactNode;
    sortKey: string | null;
    sortDir: "asc" | "desc";
    setSort: (key: string, dir: "asc" | "desc") => void;
    filtersRef: React.MutableRefObject<unknown>;
  };

  // Row-patch implementation. Replaces the inline patchAndApply for
  // WorkItems. Receives the row id + patch body, returns the updated row
  // (or throws). WorkItemsAdapter calls /work-items/{id} PATCH;
  // CustomFieldsAdapter calls /workspaces/{ws}/fields/{id} PATCH.
  patchRow(rowId: string, body: Partial<T>): Promise<T>;

  // The ActionBar's create-action wiring. For WorkItems this returns the
  // existing artefact-type picker; for CustomFields it returns a single
  // "Create Field" button that opens the flyout in create-new mode.
  buildCreateAction(ctx: AdapterCreateContext): CreateAction;

  // Optional: render the per-row expanded flyout. When the user clicks
  // a row, ObjectTree calls this with the row + a close-handler. Returns
  // null to disable inline flyout (the default — current behaviour).
  // CustomFieldsAdapter returns the two-column edit form; WorkItemsAdapter
  // returns null (its detail surface is the existing slide-out panel).
  renderRowFlyout?(row: T, ctx: { onClose: () => void; onSaved: (next: T) => void }): React.ReactNode;
}
```

The component imports nothing WorkItem-specific. Two concrete adapters live alongside:

- `app/components/ObjectTreeV2/adapters/workItemsAdapter.tsx` — wraps all the existing buildWorkItemsColumns / useWorkItemsFilters / useWorkItemsSort / patchAndApply logic that's inline in `p_ObjectTree.tsx` today. Behaviour identical.
- `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` — new. Returns the catalogue columns, the scope filter chips, calls the fields API for patches, renders the two-column flyout.

### 4.2 What stays in `p_ObjectTree.tsx`

The orchestration body keeps:
- `useObjectTreeWindow<T>` fetch loop (already generic).
- `ResourceTree<T>` mount (already generic).
- ActionBar, search, column picker, savedViews mount, addressable name plumbing, multi-select state, bulk action bar, flyout open/close state.

It loses:
- Direct imports of `buildWorkItemsColumns`, `useWorkItemsFilters`, `useWorkItemsSort`, `WorkItemsFilterChips`, `useWorkItemFlowStates`.
- The inline `patchAndApply` closure (moves to the adapter).
- The hardcoded `WorkItem` type on the props.

### 4.3 The custom-fields list page (new shape)

```tsx
// app/(user)/workspace-admin/custom-fields/page.tsx
"use client";
import ObjectTree from "@/app/components/ObjectTreeV2/p_ObjectTree";
import { customFieldsAdapter } from "@/app/components/ObjectTreeV2/adapters/customFieldsAdapter";
import customFieldsWizardJson from "@/app/components/ObjectTreeV2/configs/p_wizard_custom_fields.json";
import { resolveWizardConfig } from "@/app/lib/wizardLoader";
import { useSentinel } from "@/app/sentinel";
import { useSearchParams } from "next/navigation";

export default function CustomFieldsPage() {
  const { sentinel_user } = useSentinel();
  const workspaceId = sentinel_user?.workspace_id ?? null;
  const params = useSearchParams();
  const openId = params.get("open"); // /[id] redirect lands here

  const wizardConfig = useMemo(() => resolveWizardConfig(
    customFieldsWizardJson as Record<string, unknown>,
  ), []);

  return (
    <PageContent>
      <PageHeading level={1} title="Custom Fields" subtitle="…" />
      <ObjectTree<WorkspaceField>
        title="Custom Fields"
        addressableName="custom_fields_grid"
        subtitle="Catalogue & artefact-type bindings"
        adapter={customFieldsAdapter({ workspaceId })}
        wizardConfig={wizardConfig}
        initialOpenRowId={openId}
      />
    </PageContent>
  );
}
```

No more `<Panel>` wrapping; the OTV2 chrome owns the panel title. No more 3-Table split — a `scope` filter chip on the ActionBar replaces it.

### 4.4 The `/[id]` redirect

`app/(user)/workspace-admin/custom-fields/[id]/page.tsx` becomes a thin client redirect:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function CustomFieldRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    if (id === "new") router.replace("/workspace-admin/custom-fields?new=1");
    else router.replace(`/workspace-admin/custom-fields?open=${encodeURIComponent(id)}`);
  }, [id, router]);
  return null;
}
```

The list page reads `?new=1` and `?open=<id>` and opens the flyout accordingly. Deep-links keep working forever.

### 4.5 The two-column flyout

The CustomFieldsAdapter's `renderRowFlyout(row, { onClose, onSaved })` returns:

```
┌──────────────────────────────────────────────────────────┐
│ Edit: <field label>                            [Close ×] │
├────────────────────────────┬─────────────────────────────┤
│  Field properties          │  Applies to artefact types  │
│  • Name (machine ID)       │  ┌──────────┬───────────┐   │
│  • Label                   │  │ Work     │ Selected  │   │
│  • Data type               │  │ Strategy │           │   │
│  • Visibility              │  └──────────┴───────────┘   │
│  • Description             │                             │
│  • Options (if applicable) │                             │
│                            │                             │
├────────────────────────────┴─────────────────────────────┤
│                                  [Cancel] [Save changes] │
└──────────────────────────────────────────────────────────┘
```

The flyout mounts BELOW the clicked row, similar to the existing OTV2 detail-row pattern. Width = full grid width. The form on the left reuses the same state machine that `[id]/page.tsx` had (just lifted into a component); the picker on the right is the existing `<TypeBindingsPicker>` unchanged.

Save handler: same as today — `updateWorkspaceField` (or `createWorkspaceField` if creating new), then `replaceFieldTypeBindings`. On success: `onSaved(next)` so the parent can refresh the row in-place; flyout closes.

The existing 424-line `[id]/page.tsx` editor logic moves into a reusable `<CustomFieldEditForm>` component used by the flyout. The page file shrinks to the redirect above.

### 4.6 Button theming

A new `.dui-actionbar-btn` / extend the existing button family in `app/globals.css` so every action button (Edit, Archive, Remove, Cancel, the picker's per-row Remove) uses the same `border: 1px solid var(--border)` + `background: var(--surface)` + `color: var(--ink)` + hover `background: var(--surface-hover)` story that the ActionBar uses today. Replace the picker's `.type-bindings-picker__RemoveBtn` with this shared family. Replace inline-styled buttons in the new `<CustomFieldEditForm>` with the shared family.

### 4.7 Backend list shape

The existing `GET /workspaces/{id}/fields` returns the right shape — name, label, data_type, scope, options_json, config_json, description, archived_at, created_at, updated_at. The CustomFieldsAdapter's columns read these directly. **No backend change.**

For pagination + sort + filter — the existing endpoint doesn't paginate (returns all fields for the workspace). At current scale (66 rows on the live tenant) that's fine. If catalogue size grows, add `?limit / ?offset / ?sort / ?scope` later. **YAGNI today.**

---

## 5. Data model — no change

No new tables. No migration. The `artefacts_fields_library` shape is unchanged.

---

## 6. I/O contract — no change

The fields API endpoints (`GET / POST / PATCH / DELETE /workspaces/{id}/fields[/{id}]` and the new `/types` binding routes) all stay as-is.

---

## 7. Components (file plan)

### New
- `app/components/ObjectTreeV2/adapters/types.ts` — `ObjectTreeAdapter<T>` interface + supporting types.
- `app/components/ObjectTreeV2/adapters/workItemsAdapter.tsx` — wraps the existing WorkItem orchestration into an adapter.
- `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` — new adapter for catalogue rows.
- `app/components/ObjectTreeV2/configs/p_wizard_custom_fields.json` — sidecar config.
- `app/components/CustomFields/CustomFieldEditForm.tsx` — extracted from the old `[id]/page.tsx`, used by the flyout.
- `app/components/CustomFields/CustomFieldFlyout.tsx` — two-column flyout shell.

### Modified
- `app/components/ObjectTreeV2/p_ObjectTree.tsx` — type signature genericised; WorkItem-specific imports removed; orchestration calls adapter methods. Default adapter is the WorkItemsAdapter so the 5 existing mounts work unchanged.
- `app/(user)/workspace-admin/custom-fields/page.tsx` — total rewrite to single OTV2 mount.
- `app/(user)/workspace-admin/custom-fields/[id]/page.tsx` — replaced with the redirect.
- `app/globals.css` — add a `.action-btn` family (or reuse `.dui-button` if it's a fit), repaint `.type-bindings-picker__RemoveBtn` to use it.

### Files unchanged
- `useObjectTreeWindow.ts` — already generic.
- `ResourceTree.tsx` — already generic.
- All 5 existing OTV2 mount pages (work-items, portfolio-items, risk, value-sprint, scope harness) — they pass `<WorkItem>` explicitly and the default adapter handles it identically.

---

## 8. How to use (UX walkthrough)

### 8.1 List view
1. Admin lands on `/workspace-admin/custom-fields`.
2. Sees a single dense grid styled like work-items: ActionBar at top with a search box, scope filter chip ("All scopes / Workspace / Tenant / Global"), and a primary "Create Field" button.
3. Grid rows: Label · Name · Type · Scope · Updated. Click a column header to sort.
4. No Edit/Archive buttons inline — they live in a cog menu on the right (existing OTV2 pattern) OR as `rowButtons` (TBD by the adapter — use rowButtons for cleaner UX since the actions are immediate).

### 8.2 Create flow
1. Click "Create Field" in the ActionBar.
2. A blank flyout opens at the top of the grid (no specific row — it's a header-mounted new-row flyout).
3. Fill in name, label, data type, visibility, description, options. Pick artefact types in the right column.
4. Click "Create" → POST `/fields` → PUT `/fields/{id}/types` → flyout closes → row appears at the top of the grid.

### 8.3 Edit flow
1. Click any grid row.
2. The flyout expands BELOW that row (existing detail-row pattern).
3. Left: field properties pre-filled. Right: picker pre-loaded with current bindings.
4. Make changes, click "Save changes". On success the row updates in place and the flyout closes.
5. Cancel closes without saving.

### 8.4 Archive flow
1. Row's rowButtons include "Archive".
2. Click → confirm → DELETE `/fields/{id}` → row disappears (filter by archived_at IS NULL is server-side already).

### 8.5 Deep link
A bookmark to `/workspace-admin/custom-fields/abc-123` → redirects to `/workspace-admin/custom-fields?open=abc-123` → list mounts → flyout opens for that row automatically.

---

## 9. Examples (Q: what does the WorkItems mount look like AFTER genericisation?)

Existing call (today):
```tsx
<ObjectTree
  title="Work items"
  addressableName="work_items_grid_tree_ll"
  wizardConfig={wizardConfig}
  savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET }}
  multiSelectEnabled
  dropColumnKeys={WORK_ITEMS_DROP_COLS}
/>
```

After (no breaking change at the callsite):
```tsx
<ObjectTree<WorkItem>
  title="Work items"
  addressableName="work_items_grid_tree_ll"
  wizardConfig={wizardConfig}
  savedViews={{ kind: "objecttree", target: SAVED_VIEW_TARGET }}
  multiSelectEnabled
  dropColumnKeys={WORK_ITEMS_DROP_COLS}
  // adapter prop is optional; defaults to workItemsAdapter
/>
```

The explicit `<WorkItem>` is for clarity; TS inference plus the default-adapter default would let it be omitted, but the codebase is type-strict so explicit wins.

---

## 10. Constraints

- The 5 existing OTV2 mounts MUST keep working. Verification: tsc clean + a fresh dev-server smoke against `/work-items`, `/portfolio-items`, `/risk`, `/value-sprint` after the refactor. Any visible regression aborts the build.
- The flyout uses the existing OTV2 detail-row pattern. If that pattern doesn't exist generically (it might be WorkItem-coupled too), the adapter renders the flyout in a row-spanning React portal-ish slot the component exposes. Worst case: the component takes a `renderRowDetail?: (row: T) => React.ReactNode` prop and renders it in a row-spanning band when a row is selected.
- Atomic save in the flyout: field PATCH → bindings PUT. Same posture as the current `[id]/page.tsx` — if the PATCH succeeds and the PUT fails, surface the error inline; don't close.
- Button theming is one CSS family, not inline styles, not invented variable names. Use the project's real tokens (`--surface`, `--ink`, `--border`, `--surface-hover`) — same fix as the picker repaint.

---

## 11. Backlog (deferred)

- Pagination on `/workspaces/{id}/fields` when catalogue grows past ~500 rows.
- Saved-views on the catalogue grid.
- Multi-select bulk archive (rowButtons + bulk-action-bar already supported by OTV2 — just needs adapter wiring).
- Sortable columns (the OTV2 grid supports it; adapter needs to surface the sort keys).
- Drag-reorder of artefact-type bindings inside the flyout (today: numeric position input).

---

## 12. Change Log

- **2026-05-28** — Initial spec (autonomous mode).
