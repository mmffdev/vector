"use client";

// WorkItemsAdapter — the per-row-type orchestration shim that finishes the
// OTV2 row-type generalisation for Work Items (and Portfolio Items, which
// share the same artefact-items handler with a different scope hint).
//
// Background: until 2026-05-28 the WorkItem-specific helpers
// (buildWorkItemsColumns, useWorkItemsFilters, useWorkItemsSort,
// WorkItemsFilterChips, useWorkItemFlowStates, the artefact-type create
// picker) were inlined inside p_ObjectTree.tsx. This adapter packages all
// of that behind the ObjectTreeAdapter<T> contract so p_ObjectTree.tsx
// can stop importing anything WorkItem-specific in Task 4.
//
// Behaviour parity is the bar: every column shape, filter chip, sort
// behaviour, create-picker variant, and patch wire MUST match what
// p_ObjectTree.tsx does today. The 5 production mounts (work-items,
// portfolio-items, scope, risk, value-sprint) verify in Task 4.
//
// Spec: docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md
// Plan: docs/superpowers/plans/2026-05-28-objecttree-generic-rowtype.md
//
// Rules of hooks: every method whose name starts with `use` IS a React
// hook — the component will call them unconditionally in render. Other
// methods (buildColumns, patchRow, buildCreateAction) are pure / async
// and must NOT call hooks. The internal <WorkItemsCreateActionChip>
// component is the legal home for hooks the create-chip needs.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { workItems as workItemsApi, portfolioItems as portfolioItemsApi } from "@/app/lib/apiSite";
import { useSentinel } from "@/app/sentinel";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import {
  buildWorkItemsColumns,
  useArtefactTypeColours,
  useWorkItemsFilters,
  useWorkItemsSort,
  WorkItemsFilterChips,
  type SortKey,
  type WorkItem,
  type WorkItemsFilters,
} from "@/app/components/work-items-tree-config";
import { useObjectTreeFacets } from "@/app/components/ObjectTreeV2/hooks/useObjectTreeFacets";
import {
  CreateActionChip,
  type CreateActionConfig,
} from "@/app/components/ObjectTreeV2/kinds/ActionBar";
import type {
  AdapterColumnContext,
  AdapterCreateContext,
  AdapterFiltersResult,
  CreateActionResult,
  ObjectTreeAdapter,
} from "@/app/components/ObjectTreeV2/adapters/types";

// ── Adapter options ─────────────────────────────────────────────────────────

export interface WorkItemsAdapterOptions {
  /**
   * Resource URL used by the patch wire + facets fetch. Either
   * "/work-items" (default) or "/portfolio-items". The host derives
   * this from wizardConfig.resourceUrl ?? mode and threads it in.
   */
  resourceUrl?: "/work-items" | "/portfolio-items";
  /**
   * The optimistic-update callback the host passes through to its
   * upstream onPatched prop. The adapter does NOT call this directly —
   * the host wires patchRow → useObjectTreeWindow → onPatched. Carried
   * here for parity with the existing inline closure shape so swap-in
   * in Task 4 stays mechanical.
   */
  onPatched?: (body: Record<string, unknown>) => void;
  /**
   * Per-grid filter prefs namespace. Currently filtersPrefKey in
   * p_ObjectTree.tsx (e.g. "workitems.filters"). Used by
   * useFiltersAndSort to build the two pref keys for the underlying
   * useWorkItemsFilters + useWorkItemsSort hooks.
   *
   * When omitted, useFiltersAndSort accepts a prefKey arg of its own
   * (per the ObjectTreeAdapter contract); this option is kept on the
   * factory for callers that want adapter-level defaulting.
   */
  prefKey?: string;
  /**
   * URL-prefix for shareable query params (currently urlPrefix in
   * p_ObjectTree.tsx). Multi-grid pages (e.g. /value-sprint with
   * sprint-panel + backlog) pass distinct prefixes so chip writes on
   * one tree don't trample the sibling.
   */
  urlPrefix?: string;
  /**
   * Optional sidecar-supplied filter-chips override. When supplied,
   * useFiltersAndSort returns this node verbatim in `filterChips`
   * instead of rendering the default <WorkItemsFilterChips>. Matches
   * the existing `wizardConfig.filterChips ?? <WorkItemsFilterChips />`
   * fallback in p_ObjectTree.tsx.
   */
  filterChipsOverride?: React.ReactNode;
}

// ── Extras the adapter contributes via useExtras() ──────────────────────────
//
// The host can layer additional extras (flowStatesByType, onTypeBadgeClick)
// into ctx.extras before calling buildColumns; the adapter's contribution
// is the set of fields it owns by itself.

export interface WorkItemsAdapterExtras {
  flowStates: ReturnType<typeof useWorkItemFlowStates>;
  colourMap: ReturnType<typeof useArtefactTypeColours>;
  typeOptions: { value: string; label: string; color?: string }[];
  priorityOptions: { value: string; label: string; color?: string }[];
}

// ── Internal: create-action chip with self-owned state ──────────────────────
//
// buildCreateAction is NOT a hook (its name doesn't start with `use`), so
// it can't manage React state directly. The chip's actionTypeId state
// instead lives inside this small internal component, which buildCreateAction
// mounts unconditionally — owning its own hooks is legal because IT is the
// React component, not the adapter method.

interface WorkItemsCreateActionChipProps {
  scope: "work" | "strategy";
  createableTypeIds?: string[];
}

function WorkItemsCreateActionChip({
  scope,
  createableTypeIds,
}: WorkItemsCreateActionChipProps) {
  const scopedTypeOptions = useChipTypeOptions(scope);
  const actionTypeOptions = useMemo(() => {
    if (!createableTypeIds?.length) return scopedTypeOptions;
    const allow = new Set(createableTypeIds);
    return scopedTypeOptions.filter((o) => allow.has(o.value));
  }, [scopedTypeOptions, createableTypeIds]);
  const [actionTypeId, setActionTypeId] = useState<string>("");

  // Mirror the inline collapse-to-single-button behaviour: an allow-list
  // of exactly one type renders as "Create <Label>"; >1 renders the
  // type-picker dropdown.
  const config: CreateActionConfig =
    actionTypeOptions.length === 1
      ? {
          mode: "single",
          label: actionTypeOptions[0].label,
          onCreate: () => setActionTypeId(actionTypeOptions[0].value),
        }
      : {
          mode: "type-picker",
          label: "Create New",
          options: actionTypeOptions,
          selectedTypeId: actionTypeId,
          onSelectType: setActionTypeId,
          onCancel: () => setActionTypeId(""),
        };

  return <CreateActionChip action={config} />;
}

// ── Internal shared hook: extras computation ────────────────────────────────
//
// Pulled to a top-level hook so both useExtras() and useFiltersAndSort()
// can call it without relying on `this`-binding on the adapter object
// literal (which would break if a host destructured the method out).

function useWorkItemsAdapterExtras(resourceUrl: string): WorkItemsAdapterExtras {
  // sentinel_focus_node feeds useObjectTreeFacets for tenant-aware
  // chip option sets. Reads the same context the legacy inline code
  // does at p_ObjectTree.tsx:325.
  const { sentinel_focus_node: activeScopeNodeId } = useSentinel();
  const flowStates = useWorkItemFlowStates();
  const colourMap = useArtefactTypeColours();
  const { types: workspaceTypes } = useArtefactTypeCatalogue();
  const { priorities: workspacePriorities } = useArtefactPriorityCatalogue();
  const { typeIds: facetTypeIds, priorityIds: facetPriorityIds } =
    useObjectTreeFacets(resourceUrl, activeScopeNodeId ?? null);

  // Type-chip option set. Same source-order rule as p_ObjectTree.tsx
  // today (see comments at p_ObjectTree.tsx:827–839): the sidecar
  // allow-list wins when set, otherwise facets drive the wheel.
  // For the adapter we cannot read wizardConfig.createableTypeIds —
  // that lives on the host. So this implementation collapses to the
  // facets path; Task 4's host-side merge re-applies the allow-list
  // narrowing when present, or we extend WorkItemsAdapterOptions
  // with a createableTypeIds field if richer parity is needed.
  const typeOptions = useMemo(() => {
    const byId = new Map(workspaceTypes.map((t) => [t.id, t]));
    const out: { value: string; label: string; color?: string }[] = [];
    for (const id of facetTypeIds) {
      const t = byId.get(id);
      out.push({
        value: id,
        label: t?.name ?? id.slice(0, 8),
        color: t?.colour ?? undefined,
      });
    }
    out.sort((a, b) => {
      const ta = byId.get(a.value);
      const tb = byId.get(b.value);
      if (!ta || !tb) return a.label.localeCompare(b.label);
      return ta.sort_order - tb.sort_order || ta.name.localeCompare(tb.name);
    });
    return out;
  }, [facetTypeIds, workspaceTypes]);

  const priorityOptions = useMemo(() => {
    const byId = new Map(workspacePriorities.map((p) => [p.id, p]));
    const out: { value: string; label: string; color?: string }[] = [];
    for (const id of facetPriorityIds) {
      const p = byId.get(id);
      out.push({
        value: id,
        label: p?.name ?? id.slice(0, 8),
        color: p?.colour ?? undefined,
      });
    }
    out.sort((a, b) => {
      const pa = byId.get(a.value);
      const pb = byId.get(b.value);
      if (!pa || !pb) return a.label.localeCompare(b.label);
      return pa.sort_order - pb.sort_order || pa.name.localeCompare(pb.name);
    });
    return out;
  }, [facetPriorityIds, workspacePriorities]);

  return { flowStates, colourMap, typeOptions, priorityOptions };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createWorkItemsAdapter(
  opts: WorkItemsAdapterOptions = {},
): ObjectTreeAdapter<WorkItem> {
  const resourceUrl = opts.resourceUrl ?? "/work-items";
  // Match the bundle-selection rule in p_ObjectTree.tsx: portfolio routes
  // ride the portfolioItems bundle, everything else rides workItems.
  const apiBundle =
    resourceUrl === "/portfolio-items" ? portfolioItemsApi : workItemsApi;

  return {
    // ── Free-form extras the adapter contributes ────────────────────────
    useExtras(): Record<string, unknown> {
      const extras = useWorkItemsAdapterExtras(resourceUrl);
      return extras as unknown as Record<string, unknown>;
    },

    // ── Filter chips + sort state ────────────────────────────────────────
    useFiltersAndSort({
      prefKey,
      urlPrefix,
    }: {
      prefKey: string;
      urlPrefix?: string;
    }): AdapterFiltersResult {
      const effectivePrefKey = prefKey ?? opts.prefKey ?? "workitems";
      const effectiveUrlPrefix = urlPrefix ?? opts.urlPrefix;

      // Filters / sort live in users.preferences keyed by `<treeName>.filters`
      // / `<treeName>.sort`. Mirror the inline pref-key derivation: the
      // caller passes treeName-prefixed keys, so we just append the
      // dimension suffix. When the host passes a bare treeName (e.g.
      // "workitems") build the dimension keys here.
      const filtersPrefKey = effectivePrefKey.endsWith(".filters")
        ? effectivePrefKey
        : `${effectivePrefKey}.filters`;
      const sortPrefKey = effectivePrefKey.endsWith(".filters")
        ? effectivePrefKey.replace(/\.filters$/, ".sort")
        : `${effectivePrefKey}.sort`;

      // sortRef and filtersRef cross-wire the two hooks so URL writes
      // from either side carry both dimensions (TD-URL-SHAREABLE-VIEWS).
      const filtersRef = useRef<WorkItemsFilters>({
        type: [],
        status: [],
        priority: [],
        owner_id: [],
      });
      const { sortKey, sortDir, sortRef, setSort } = useWorkItemsSort(
        sortPrefKey,
        filtersRef,
        effectiveUrlPrefix,
      );
      const { filters } = useWorkItemsFilters(
        filtersPrefKey,
        sortRef,
        effectiveUrlPrefix,
      );
      // Keep filtersRef current so sort-side URL writes reflect latest
      // filters (matches p_ObjectTree.tsx's existing effect at L304).
      useEffect(() => {
        filtersRef.current = filters;
      }, [filters]);

      // Use the adapter's contributed extras to source the chip options
      // when the host hasn't supplied an override. Calling the shared
      // top-level hook here is a hook-on-hook — legal because
      // useFiltersAndSort is itself a hook and the contract requires
      // unconditional invocation.
      const extras = useWorkItemsAdapterExtras(resourceUrl);
      const filterChips =
        opts.filterChipsOverride ?? (
          <WorkItemsFilterChips
            prefKey={filtersPrefKey}
            typeOptions={extras.typeOptions}
            priorityOptions={extras.priorityOptions}
            urlPrefix={effectiveUrlPrefix}
          />
        );

      // The adapter contract types `filtersRef` as
      // MutableRefObject<unknown>; cast the inner ref shape so the host
      // can stash it back into the fetch hook without losing fidelity.
      // The caller resurrects WorkItemsFilters via its own cast.
      return {
        filterChips,
        sortKey,
        sortDir,
        setSort: (key: string, dir: "asc" | "desc") =>
          setSort(key as SortKey | null, dir),
        filtersRef: filtersRef as React.MutableRefObject<unknown>,
        // WorkItem filter state lives in the host's own useWorkItemsFilters
        // hook + filterQuery builder (a long-standing parallel-systems
        // arrangement). Returning an empty signature here makes
        // p_ObjectTree.tsx fall through to its own filterQuery — so
        // WorkItem mounts that supply this adapter (value-sprint et al.)
        // keep their existing refetch behaviour unchanged.
        filterQuery: "",
      };
    },

    // ── Column builder ──────────────────────────────────────────────────
    buildColumns(ctx: AdapterColumnContext<WorkItem>) {
      // Cast the free-form extras bag to the WorkItems shape contributed
      // by useExtras(); the host MAY add `flowStatesByType` +
      // `onTypeBadgeClick` keys on top of this base — those are derived
      // from windowRoots + the inline-form open state, which the host
      // owns. Both are optional from the column-builder's perspective.
      const extras = ctx.extras as unknown as WorkItemsAdapterExtras & {
        flowStatesByType?: Map<string, ReturnType<typeof useWorkItemFlowStates>[number][]>;
        onTypeBadgeClick?: (artefactId: string) => void;
      };
      const { flowStates, colourMap, flowStatesByType, onTypeBadgeClick } = extras;

      // patchAndApply is the host's optimistic-patch closure; the column
      // factory writes through it for inline edits (status pill, priority,
      // points, due date, summary). Cast to the legacy signature
      // (id, Record<string, unknown>) the column factory still uses.
      const patchAndApply = ctx.patchAndApply as unknown as (
        id: string,
        body: Record<string, unknown>,
      ) => void;

      return buildWorkItemsColumns(flowStates, patchAndApply, colourMap, {
        onTypeBadgeClick,
        flowStatesByType,
      });
    },

    // ── Patch wire ──────────────────────────────────────────────────────
    async patchRow(rowId: string, body: Partial<WorkItem>): Promise<WorkItem> {
      // The patch wire returns the updated row from the backend. We trust
      // the upstream optimistic-update path to keep the rendered window
      // in sync; this method exists so callers that don't have that path
      // (e.g. ad-hoc tests, future host migrations) get a typed result.
      const updated = (await apiBundle.patch(
        rowId,
        body as Record<string, unknown>,
      )) as WorkItem;
      return updated;
    },

    // ── Create action ───────────────────────────────────────────────────
    buildCreateAction(ctx: AdapterCreateContext): CreateActionResult {
      // The chip's actionTypeId state lives inside the internal component
      // (hook rules — buildCreateAction itself is not a hook). Mount the
      // self-contained component with the scope + allow-list arriving
      // from the sidecar via the AdapterCreateContext.
      return {
        node: (
          <WorkItemsCreateActionChip
            scope={ctx.scope ?? "work"}
            createableTypeIds={ctx.createableTypeIds}
          />
        ),
      };
    },

    // ── Row + create flyouts ────────────────────────────────────────────
    //
    // WorkItems uses an EXTERNAL slide-out panel for row detail and the
    // legacy ArtefactInlineForm header flyout for create. Neither lives
    // inside the adapter, so both flyout hooks return undefined. The
    // CustomFieldsAdapter (later task) WILL implement renderRowFlyout
    // for its inline two-column edit form.
    renderRowFlyout: undefined,
    renderCreateFlyout: undefined,

    // buildRowButtons intentionally omitted — the caller can still pass
    // `rowButtons` via the OTV2 prop, and that wins over an adapter
    // default per the interface comment.
  };
}
