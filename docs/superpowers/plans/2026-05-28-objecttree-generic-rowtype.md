# OTV2 generic row-type + custom-fields admin — Implementation Plan

> **For agentic workers:** subagent-per-task. Orchestrator drives git; subagents do NOT commit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the OTV2 row-type genericisation; mount custom-fields admin on the result.

**Architecture:** Define `ObjectTreeAdapter<T>` interface; extract existing WorkItem orchestration into a `WorkItemsAdapter` so the 5 production mounts (work-items, portfolio-items, risk, value-sprint x2) keep working unchanged. New `CustomFieldsAdapter` handles catalogue rows. Custom-fields list page becomes one OTV2 mount with a flyout for edit/create.

**Tech Stack:** Next.js 15 + React 19 + TS strict; Go 1.22 backend (no backend change needed — existing `/workspaces/{id}/fields` is fine).

**Spec:** [docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md](../specs/2026-05-28-objecttree-generic-rowtype-design.md)

---

## Task 1 — Define the adapter interface

**Files:**
- Create: `app/components/ObjectTreeV2/adapters/types.ts`

- [ ] **Step 1: Write the adapter interface + supporting types.**

The interface mirrors what `p_ObjectTree.tsx` does inline today for WorkItems. Read `p_ObjectTree.tsx` lines 70-110, 280-310, 1100-1200 to confirm the exact shapes:
- `flowStates` — currently `useWorkItemFlowStates()` at line ~283; only WorkItems needs it.
- `colourMap` — read via `useArtefactTypeColours()`.
- `typeOptions`, `priorityOptions` — built from artefact-type catalogue + WorkItem priority enum.
- `patchAndApply` — closure over apiSite + onPatched callback; ~line 1100 area.

Define:

```ts
// app/components/ObjectTreeV2/adapters/types.ts
import type { ColumnDef } from "@/app/components/ResourceTree";
import type { ObjectTreeDataConfig } from "@/app/components/ObjectTreeV2/p_ObjectTree";
import type React from "react";

// Context passed into adapter.buildColumns. Adapters take what they need
// and ignore the rest. WorkItemsAdapter consumes flowStates/colourMap/
// typeOptions/priorityOptions; CustomFieldsAdapter consumes none of them.
export interface AdapterColumnContext<T> {
  patchAndApply: (id: string, body: Partial<T>) => Promise<void>;
  // Free-form bag — adapters cast as needed. Avoids forcing every adapter
  // to depend on the WorkItem-specific contexts.
  extras: Record<string, unknown>;
}

export interface AdapterFiltersResult {
  filterChips: React.ReactNode;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  setSort: (key: string, dir: "asc" | "desc") => void;
  filtersRef: React.MutableRefObject<unknown>;
}

export interface AdapterCreateContext {
  scope?: "work" | "strategy";
  createableTypeIds?: string[];
  onCreated?: (newRow: unknown) => void;
}

export interface CreateAction {
  // Rendered into the ActionBar's create-action slot. Either a button
  // (CustomFields: single "Create Field" button) or a multi-option picker
  // (WorkItems: artefact-type picker with N options).
  node: React.ReactNode;
}

export interface ObjectTreeAdapter<T> {
  // Required: build the columns from runtime context.
  buildColumns(ctx: AdapterColumnContext<T>): ColumnDef<T>[];

  // Required: filter chips + sort state. Used as the React node in the
  // ActionBar's filterChips slot, and the sort state drives the
  // useObjectTreeWindow fetch.
  useFiltersAndSort(opts: { prefKey: string; urlPrefix?: string }): AdapterFiltersResult;

  // Required: row-patch implementation. Returns the updated row.
  patchRow(rowId: string, body: Partial<T>): Promise<T>;

  // Required: build the create-action that goes in the ActionBar.
  buildCreateAction(ctx: AdapterCreateContext): CreateAction;

  // Optional: render the inline detail flyout under a clicked row.
  // When omitted, no flyout — clicking a row only updates selectedId.
  renderRowFlyout?(row: T, ctx: {
    onClose: () => void;
    onSaved: (next: T) => void;
  }): React.ReactNode;

  // Optional: render a header-level "new row" flyout (above the grid)
  // for the create flow when there is no specific row to expand.
  // When omitted, the create action is responsible for its own UX.
  renderCreateFlyout?(ctx: {
    onClose: () => void;
    onCreated: (next: T) => void;
  }): React.ReactNode;
}
```

- [ ] **Step 2: `npx tsc --noEmit` — clean.**

- [ ] **Step 3: Orchestrator commits.**

Commit message:
```
feat(otv2): adapter interface — ObjectTreeAdapter<T>
```

---

## Task 2 — Extract WorkItems orchestration into WorkItemsAdapter

**Files:**
- Create: `app/components/ObjectTreeV2/adapters/workItemsAdapter.tsx`
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx` (later in Task 4 — DO NOT modify in this task)

This task ONLY creates the adapter — does NOT yet wire it into the component. The component continues to inline the WorkItem helpers; the adapter is a parallel that we'll switch to in Task 4.

- [ ] **Step 1: Read these regions of `p_ObjectTree.tsx` to extract the orchestration:**
  - **Imports lines 67-82** — the WorkItem-specific imports.
  - **Lines 280-310** — `useWorkItemFlowStates`, `useWorkItemsSort`, `useWorkItemsFilters`.
  - **Lines 1100-1140** — the `patchAndApply` closure.
  - **Line 1136** — `buildWorkItemsColumns(flowStates, patchAndApply, colourMap, …)`.
  - **Line 1174** — the inline `<WorkItemsFilterChips>` mount.
  - **The createAction wiring around line 1145-1170** (search for `createAction`).

- [ ] **Step 2: Write `workItemsAdapter.tsx`** that exposes a factory `createWorkItemsAdapter(opts)` returning `ObjectTreeAdapter<WorkItem>`. The adapter:
  - `buildColumns(ctx)` — calls `buildWorkItemsColumns(extras.flowStates, ctx.patchAndApply, extras.colourMap, …)`.
  - `useFiltersAndSort({ prefKey, urlPrefix })` — wraps the existing `useWorkItemsFilters` + `useWorkItemsSort` hooks and returns `<WorkItemsFilterChips>`.
  - `patchRow(rowId, body)` — calls `apiSite.workItems.patch(rowId, body)`.
  - `buildCreateAction(ctx)` — returns whatever the current inline create-action logic produces.
  - `renderRowFlyout` — omitted (WorkItems uses an external slide-out, not inline).
  - `renderCreateFlyout` — omitted.

The adapter is a pure refactor — code COPIED from `p_ObjectTree.tsx` with the dependencies passed in via `ctx.extras` (flowStates, colourMap, typeOptions, priorityOptions) rather than read via hooks inside.

- [ ] **Step 3: `npx tsc --noEmit` — clean.**

- [ ] **Step 4: Orchestrator commits.**

Commit message:
```
feat(otv2): extract WorkItemsAdapter from p_ObjectTree inline code
```

---

## Task 3 — Build CustomFieldsAdapter + sidecar config + EditForm + Flyout

This is the new code for the custom-fields surface. Pure additions; no existing file modified.

**Files:**
- Create: `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx`
- Create: `app/components/ObjectTreeV2/configs/p_wizard_custom_fields.json`
- Create: `app/components/CustomFields/CustomFieldEditForm.tsx`
- Create: `app/components/CustomFields/CustomFieldFlyout.tsx`
- Modify: `app/globals.css` (append the `.action-btn` family + flyout layout CSS; ~120 lines)

- [ ] **Step 1: `p_wizard_custom_fields.json`:**

```json
{
  "_comment": "Custom fields catalogue admin grid. dataType='custom_fields' so the registry routes a separate config; resourceUrl points at the workspace fields endpoint. No createableTypeSlots — the adapter's create-action is a single 'Create Field' button.",
  "dataType": "custom_fields",
  "label": "Custom Fields",
  "searchPlaceholder": "Search fields…",
  "ariaLabel": "Custom fields catalogue grid",
  "treeName": "customfields",
  "resourceUrl": "/workspaces/{workspace_id}/fields",
  "scope": "work",
  "dndResourceType": "custom_field",
  "dndEnabled": false,
  "defaultSortKey": "label",
  "defaultSortDir": "asc",
  "paginationOptions": [25, 50, 100, 250],
  "defaultPageSize": 50
}
```

Note `{workspace_id}` token in `resourceUrl` — the adapter's column-context interpolates it from the workspaceId opt. If the existing wizard loader doesn't support tokens, the adapter constructs the URL itself and the JSON's `resourceUrl` is informational.

- [ ] **Step 2: `CustomFieldEditForm.tsx`** — extract the form state machine from the current `app/(user)/workspace-admin/custom-fields/[id]/page.tsx`. Make it a pure controlled component:

```tsx
interface Props {
  workspaceId: string;
  // null = create-mode; populated = edit-mode.
  initial: WorkspaceField | null;
  onCancel: () => void;
  onSaved: (next: WorkspaceField) => void;
}
```

The component owns:
- Name / label / data type / scope / description / options state.
- Bindings + bindingsDirty state.
- The Save handler (same logic as `[id]/page.tsx` Save): create-or-update field, then replace bindings, surface errors.
- The picker is mounted in the right column (parent of this form provides the two-column layout).

- [ ] **Step 3: `CustomFieldFlyout.tsx`** — the two-column flyout shell. Owns the layout (left = `<CustomFieldEditForm>`, right = `<TypeBindingsPicker>`), the close button, the Save/Cancel buttons.

Wait — the picker is INSIDE the form per Task 9's wiring. Reconcile: keep the picker inside `CustomFieldEditForm` (already wired); the Flyout is just a layout shell with a header (close button) and the form below. Simpler.

```tsx
interface FlyoutProps {
  workspaceId: string;
  initial: WorkspaceField | null;
  onClose: () => void;
  onSaved: (next: WorkspaceField) => void;
}

export function CustomFieldFlyout({ workspaceId, initial, onClose, onSaved }: FlyoutProps) {
  return (
    <div className="custom-field-flyout">
      <div className="custom-field-flyout__Header">
        <h3>{initial ? `Edit: ${initial.label}` : "Create field"}</h3>
        <button className="action-btn" onClick={onClose}>Close</button>
      </div>
      <CustomFieldEditForm
        workspaceId={workspaceId}
        initial={initial}
        onCancel={onClose}
        onSaved={onSaved}
      />
    </div>
  );
}
```

`CustomFieldEditForm` keeps the two-column layout (form left, picker right) as it does today on the `[id]` page.

- [ ] **Step 4: `customFieldsAdapter.tsx`**:

```tsx
export function createCustomFieldsAdapter(opts: { workspaceId: string }): ObjectTreeAdapter<WorkspaceField> {
  return {
    buildColumns(ctx) {
      return [
        { key: "label", header: "Label", render: r => r.label },
        { key: "name", header: "Name", render: r => <code>{r.name}</code> },
        { key: "data_type", header: "Type", render: r => r.data_type },
        { key: "scope", header: "Scope", render: r => r.scope },
        { key: "updated_at", header: "Updated", render: r => formatDate(r.updated_at) },
      ];
    },
    useFiltersAndSort({ prefKey }) {
      // Simple: scope filter chip + label sort. Inline state in the hook.
      const [scope, setScope] = useState<"all" | "tenant" | "workspace" | "global">("all");
      const [sortKey, setSortKey] = useState<string>("label");
      const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
      const filtersRef = useRef<unknown>({ scope });
      return {
        filterChips: (
          <ScopeFilterChip value={scope} onChange={setScope} />
        ),
        sortKey, sortDir,
        setSort: (k, d) => { setSortKey(k); setSortDir(d); },
        filtersRef,
      };
    },
    async patchRow(rowId, body) {
      return await updateWorkspaceField(opts.workspaceId, rowId, body);
    },
    buildCreateAction(ctx) {
      return {
        node: (
          <button className="action-btn action-btn--primary" onClick={() => ctx.onCreated?.(null as unknown)}>
            Create Field
          </button>
        ),
      };
    },
    renderRowFlyout(row, ctx) {
      return (
        <CustomFieldFlyout
          workspaceId={opts.workspaceId}
          initial={row}
          onClose={ctx.onClose}
          onSaved={ctx.onSaved}
        />
      );
    },
    renderCreateFlyout(ctx) {
      return (
        <CustomFieldFlyout
          workspaceId={opts.workspaceId}
          initial={null}
          onClose={ctx.onClose}
          onSaved={ctx.onCreated}
        />
      );
    },
  };
}
```

- [ ] **Step 5: CSS — `.action-btn` family + flyout layout in `app/globals.css`:**

```css
/* Shared action button — used by ActionBar buttons and any per-row /
   flyout action button. Replaces the dark-slab inline-styled buttons. */
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 80ms ease;
}
.action-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn--primary {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--accent);
}
.action-btn--primary:hover:not(:disabled) {
  opacity: 0.9;
}
.action-btn--danger:hover:not(:disabled) {
  border-color: var(--danger, #c33);
  color: var(--danger, #c33);
}

/* Flyout — the inline edit/create surface that expands under a grid row. */
.custom-field-flyout {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 20px;
  margin: 12px 0;
}
.custom-field-flyout__Header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.custom-field-flyout__Header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

/* Two-column form inside the flyout. */
.custom-field-edit-form__Columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 24px;
}
```

Also replace `.type-bindings-picker__RemoveBtn` to use `.action-btn` styling — or just give it `class="action-btn action-btn--danger"` and delete its bespoke CSS.

- [ ] **Step 6: `npx tsc --noEmit` — clean.**

- [ ] **Step 7: Orchestrator commits.**

Commit message:
```
feat(custom-fields): CustomFieldsAdapter + EditForm + Flyout + .action-btn CSS
```

---

## Task 4 — Genericise `p_ObjectTree.tsx` to use the adapter

This is the surgical refactor. The component currently inlines WorkItem-specific code; we replace those inline blocks with calls into `adapter.*`. Default adapter = `WorkItemsAdapter` so the 5 existing mounts work unchanged.

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

- [ ] **Step 1: Change the prop signature:**

```tsx
export default function ObjectTree<T = WorkItem>({
  // …all existing props…
  adapter,
  // …
}: {
  selectedId: string | null;
  onSelect: (item: T) => void;
  onPatched?: (body: Partial<T>) => void;
  wizardConfig?: ObjectTreeDataConfig<T>;
  rowButtons?: (row: T) => RowButton[];
  // …
  adapter?: ObjectTreeAdapter<T>;
}) {
  const effectiveAdapter = adapter ?? (createWorkItemsAdapter({}) as ObjectTreeAdapter<T>);
  // …
}
```

`<T = WorkItem>` keeps existing callsites valid (they don't pass `<T>`, so TS infers `WorkItem`).

- [ ] **Step 2: Replace inline WorkItem-specific calls with adapter calls:**

  - Replace `const flowStates = useWorkItemFlowStates()` and friends — leave them in the WorkItemsAdapter; the component no longer reads them directly. Instead the adapter encapsulates these hooks (it can still use React hooks since it returns from a hook-shaped `useFiltersAndSort`).
  - Replace `buildWorkItemsColumns(flowStates, patchAndApply, colourMap, …)` with `effectiveAdapter.buildColumns({ patchAndApply, extras: { flowStates, colourMap, typeOptions, priorityOptions } })`. The WorkItemsAdapter unpacks `extras`. CustomFieldsAdapter ignores them.
  - Replace `useWorkItemsFilters(...)` + `useWorkItemsSort(...)` with `const { filterChips, sortKey, sortDir, setSort, filtersRef } = effectiveAdapter.useFiltersAndSort({ prefKey: filtersPrefKey, urlPrefix })`.
  - Replace `patchAndApply` closure with one that calls `effectiveAdapter.patchRow(id, body)` and applies the optimistic update.
  - Replace the inline createAction with `effectiveAdapter.buildCreateAction({...})`.

  **Critical:** the WorkItemsAdapter MUST still run `useWorkItemFlowStates` etc. via React hooks. Since adapters return from a hook function (`useFiltersAndSort`), they can call other hooks inside it. For the column-building path, the component reads flowStates etc. AT THE TOP, then passes them to `buildColumns` via `extras` — this preserves Rules of Hooks. The WorkItemsAdapter exposes a helper hook `useWorkItemsAdapterExtras()` that the component calls only when `effectiveAdapter` IS the WorkItemsAdapter (a `kind: "workitems"` discriminator on the adapter).

  Actually simpler: add a `useExtras?: () => Record<string, unknown>` method on the adapter. The component calls it unconditionally; CustomFieldsAdapter returns `{}`.

- [ ] **Step 3: Wire the flyout slot.**

  Add render logic: when a row is selected AND `effectiveAdapter.renderRowFlyout` is defined, render the flyout in a row-spanning band below the selected row. The OTV2 grid has selection state already; the new bit is mounting the adapter's React node below the row index.

  Implementation hint: instead of inlining the flyout into the table row markup, render it BELOW the entire `<ResourceTree>` mount in a container that's visible only when `selectedId` is set AND the adapter renders a flyout. Position is "right under the grid" rather than "between rows" — simpler, still looks right for a flat catalogue.

  Also add a `headerFlyoutOpen` state for the create-action flow: when the create button is clicked, `headerFlyoutOpen = true` → render `effectiveAdapter.renderCreateFlyout(...)` above the `<ResourceTree>`. On `onCreated` callback, close it and refetch.

- [ ] **Step 4: Verify the 5 production mounts still tsc + render.**

  ```bash
  npx tsc --noEmit
  ```

  Expected: clean. If anything breaks at a callsite, the prop signature changed in a way the default-adapter doesn't cover; revisit.

- [ ] **Step 5: Manual smoke (orchestrator):**

  Restart the dev server, visit `/work-items`, `/portfolio-items`, `/risk`, `/value-sprint`. Each grid renders identically to before the refactor. ActionBar, filters, sort, columns, row click → detail flyout: all unchanged.

  If any regression: revert this commit, debug, retry.

- [ ] **Step 6: Orchestrator commits.**

Commit message:
```
refactor(otv2): genericise p_ObjectTree to <T> via adapter; WorkItemsAdapter default
```

---

## Task 5 — Replace the custom-fields list page

**Files:**
- Modify: `app/(user)/workspace-admin/custom-fields/page.tsx` (total rewrite)
- Modify: `app/(user)/workspace-admin/custom-fields/[id]/page.tsx` (becomes a redirect)

- [ ] **Step 1: Rewrite the list page** to mount one OTV2 with the CustomFieldsAdapter. Read `?open=<id>` and `?new=1` from the URL on mount; pass them to OTV2 as `initialOpenRowId` / `initialCreateMode`. OTV2 honours these to auto-open the flyout.

Add `initialOpenRowId?: string | null` and `initialCreateMode?: boolean` props to the OTV2 prop signature (in Task 4 actually — go back and add).

- [ ] **Step 2: Replace `[id]/page.tsx`** with a thin redirect:

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

- [ ] **Step 3: `npx tsc --noEmit` — clean.**

- [ ] **Step 4: Orchestrator commits.**

Commit message:
```
feat(custom-fields): mount OTV2 on list page; deep-link redirect on /[id]
```

---

## Task 6 — Final sweep + commit handover

- [ ] **Step 1: Repaint `.type-bindings-picker__RemoveBtn` to use `.action-btn`** (delete the bespoke CSS).

- [ ] **Step 2: Manual smoke on the new custom-fields page:**
  - Land on `/workspace-admin/custom-fields` — single grid, no 3-panel layout.
  - Click "Create Field" in ActionBar — flyout opens at top.
  - Fill + save → row appears in grid.
  - Click an existing row — flyout opens below.
  - Edit + save → row updates in place.
  - Click an Archive button — row disappears.
  - Bookmark `/workspace-admin/custom-fields/<some-id>` — redirects + opens flyout.

- [ ] **Step 3: `cd backend && go test ./internal/fields/... -tags=integration` — still green (no backend touch but verify).**

- [ ] **Step 4: `npx tsc --noEmit` — clean.**

- [ ] **Step 5: Write `handovers/handover_otv2_generic_custom_fields.md`** — same shape as the saved-views handover. Final state + commits + smoke results + deferred work.

- [ ] **Step 6: Orchestrator commits the handover.**

---

## Risks / Open questions

1. **`useFiltersAndSort` is a hook** — calling adapter methods that themselves use hooks is fine as long as the call site is in a render path AND the call is unconditional. Both conditions hold. But TS strict will reject if the type doesn't make this clear: the method name MUST start with `use` so the linter (and humans) understand.
2. **The 5 existing mounts smoke-pass before merging.** Any visible regression aborts.
3. **The CustomFieldsAdapter's `useFiltersAndSort` doesn't use shared sort/filter prefs hooks today** — using inline `useState` is fine for now; persistence can come later.
4. **The flyout's two-column layout on narrow viewports** — gracefully collapse to one column with `@media (max-width: 1024px)` in the CSS.
