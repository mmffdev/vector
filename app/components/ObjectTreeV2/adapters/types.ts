// ObjectTreeAdapter — the per-data-type orchestration contract that
// finishes the OTV2 row-type generalisation.
//
// Background: the OTV2 refactor (weeks before 2026-05-28) genericised
// useObjectTreeWindow<T>, ResourceTree<T>, and ObjectTreeDataConfig<T>;
// the orchestration in p_ObjectTree.tsx still inlines WorkItem-specific
// helpers (buildWorkItemsColumns, useWorkItemsFilters, useWorkItemsSort,
// WorkItemsFilterChips, useWorkItemFlowStates, patchAndApply). This
// interface is the seam those helpers move behind — one adapter per
// row type. The component body stops importing anything WorkItem-
// specific and asks the adapter for everything it needs.
//
// Spec: docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md

import type React from "react";
import type { ColumnDef, RowButton } from "@/app/components/ResourceTree";

// Context the component passes to the adapter when asking for columns.
// `patchAndApply` is the optimistic-update helper the adapter wires into
// inline edit columns. `extras` is a free-form bag so the WorkItemsAdapter
// can pull in flowStates / colourMap / typeOptions without forcing every
// adapter to depend on them; CustomFieldsAdapter just ignores the bag.
export interface AdapterColumnContext<T> {
  patchAndApply: (rowId: string, body: Partial<T>) => Promise<void>;
  extras: Record<string, unknown>;
}

// What the adapter's useFiltersAndSort hook returns. The component
// renders `filterChips` into the ActionBar's filter-chip cluster and
// feeds the sort state into useObjectTreeWindow's fetch params.
export interface AdapterFiltersResult {
  filterChips: React.ReactNode;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  setSort: (key: string, dir: "asc" | "desc") => void;
  // Free-form ref so the component can stash filter state for the fetch
  // hook to consume. Adapters cast as needed.
  filtersRef: React.MutableRefObject<unknown>;
}

// Context the component passes to buildCreateAction. Sourced from the
// sidecar (scope, createableTypeIds) plus a callback the adapter calls
// when the user kicks off a create. For OTV2-with-flyout adapters
// (CustomFields), onCreate triggers the header flyout to open with a
// null `initial`; for OTV2-with-modal adapters (WorkItems), onCreate
// drives the existing artefact-type create picker.
export interface AdapterCreateContext {
  scope?: "work" | "strategy";
  createableTypeIds?: string[];
  onOpenCreateFlyout?: () => void;
}

// What buildCreateAction returns — currently just the React node to
// drop into the ActionBar's create-action slot. Wrapping in an object
// gives us a place to add metadata later (e.g. disabled-with-reason).
export interface CreateActionResult {
  node: React.ReactNode;
}

// Context the component passes when asking the adapter to render the
// inline row flyout. onClose dismisses; onSaved gets the updated row
// so the component can refresh its window.
export interface RenderRowFlyoutContext<T> {
  onClose: () => void;
  onSaved: (next: T) => void;
}

// Context for the create flyout. Same shape, different callback name
// for clarity at the call site.
export interface RenderCreateFlyoutContext<T> {
  onClose: () => void;
  onCreated: (next: T) => void;
}

// The adapter itself. Every method is plain (synchronous) except patchRow.
// The two hook-shaped methods (useFiltersAndSort, useExtras) are explicit
// hooks — name starts with `use` so React's rules-of-hooks linter is happy
// and the component MUST call them unconditionally.
export interface ObjectTreeAdapter<T> {
  // Build the columns from runtime context (the optimistic-patch helper
  // plus the free-form extras bag).
  buildColumns(ctx: AdapterColumnContext<T>): ColumnDef<T>[];

  // Filter chips + sort state. Called unconditionally from the component
  // render body. Adapters that don't need sort state can return a fixed
  // pair.
  useFiltersAndSort(opts: {
    prefKey: string;
    urlPrefix?: string;
  }): AdapterFiltersResult;

  // Free-form extras the adapter wants to inject into AdapterColumnContext.
  // WorkItemsAdapter returns { flowStates, colourMap, typeOptions, priorityOptions };
  // CustomFieldsAdapter returns {}. Called unconditionally — must be a hook.
  useExtras(): Record<string, unknown>;

  // The row-patch implementation. Receives the row id + the diff body,
  // returns the updated row (or throws). The component closes over this
  // to produce the optimistic patchAndApply passed to buildColumns.
  patchRow(rowId: string, body: Partial<T>): Promise<T>;

  // Build the create-action that the component renders in the ActionBar.
  // The result.node is React; the adapter is free to render a button,
  // dropdown, or popover.
  buildCreateAction(ctx: AdapterCreateContext): CreateActionResult;

  // Optional: per-row row-buttons (rendered inline in each table row).
  // The component already accepts a rowButtons prop at the call site;
  // this is the adapter's chance to provide one by default. Caller's
  // prop wins if both are set.
  buildRowButtons?(row: T, ctx: { onOpenFlyout?: () => void }): RowButton[];

  // Optional: render the inline detail flyout under a clicked row. When
  // omitted, no flyout — clicking only updates selectedId. CustomFields
  // returns the two-column edit form; WorkItems leaves it null (it uses
  // an external slide-out panel for detail).
  renderRowFlyout?(row: T, ctx: RenderRowFlyoutContext<T>): React.ReactNode;

  // Optional: render a header-level flyout for create-new flows. When
  // the create action fires `onOpenCreateFlyout`, the component shows
  // this above the grid.
  renderCreateFlyout?(ctx: RenderCreateFlyoutContext<T>): React.ReactNode;
}
