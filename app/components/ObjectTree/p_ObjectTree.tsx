"use client";

// ObjectTree — generic dumb primitive over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// a config object. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every data-type concern lives in the config.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import BulkActionBar from "@/app/components/BulkActionBar";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import {
  buildWorkItemsColumns,
  useArtefactItemsWindow,
  useArtefactTypeColours,
  useWorkItemsFilters,
  useWorkItemsSort,
  WorkItemsFilterChips,
  WorkItemsPanelHeader,
  type SortKey,
  type WorkItem,
} from "@/app/components/work-items-tree-config";
import type { ColumnDef } from "@/app/components/ResourceTree";

export type { WorkItem };

// ObjectTree configuration interface — tells ObjectTree how to fetch, render,
// and interact with a specific data type. Built inline based on `mode` for now;
// when we have multiple data types, this comes from the registry.
export interface ObjectTreeDataConfig<T = any> {
  // UI labels and messaging
  label: string; // e.g. "Work items", "Portfolio items"
  searchPlaceholder: string; // e.g. "Search work items…"
  ariaLabel: string; // e.g. "Work items dense grid"
  treeName: string; // e.g. "workitems", "portfolioitems" (for addressing)

  // Columns and rendering
  columns: ColumnDef<T>[];

  // Drag-and-drop configuration
  dndResourceType: string; // e.g. "work_item", "portfolio_item"
  dndEnabled: boolean;

  // Sorting configuration
  defaultSortKey: string | null;
  defaultSortDir: "asc" | "desc";

  // Hierarchy accessors
  getParentId: (row: T) => string | null;
  getChildrenCount: (row: T) => number;

  // Search accessor
  searchAccessor: (row: T) => string;

  // Optional UI elements
  panelHeader?: React.ReactNode;
  filterChips?: React.ReactNode;

  // Pagination configuration
  paginationOptions: number[];
  defaultPageSize: number;

  // Backend wiring (PLA-0037 / B21) — apiSite path prefix for the artefact
  // resource ("/work-items" or "/portfolio-items"). When omitted, derived
  // from `mode` for back-compat. Supplied by p_wizard_*.json sidecars.
  resourceUrl?: string;
  // Optional scope hint for diagnostics / addressing — does NOT influence
  // routing (the backend route already encodes the scope).
  scope?: "work" | "strategy";
}

export default function ObjectTree({
  selectedId,
  onSelect,
  onPatched,
  mode = "work_items",
  wizardConfig,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
  mode?: "work_items" | "portfolio_items";
  wizardConfig?: ObjectTreeDataConfig<WorkItem>;
}) {
  // For now, build config based on mode. Once we have multiple data types,
  // this could accept a config prop or look it up from the registry.
  const flowStates = useWorkItemFlowStates();
  const colourMap = useArtefactTypeColours();
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);
  const { filters } = useWorkItemsFilters();
  const { sortKey, sortDir, setSort } = useWorkItemsSort();

  // PLA-0021 / 00456 — multi-select state lives here; the tree consumes
  // it via the SelectionConfig prop set, and BulkActionBar reads it to
  // decide whether to render itself.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Filter or sort changes invalidate the page offset — page 5 of an
  // unfiltered/default-sorted set is meaningless on a filtered/resorted set.
  useEffect(() => {
    setPageIndex(0);
  }, [filters.type, filters.status, filters.priority, filters.owner_id, sortKey, sortDir]);

  // resourceUrl resolution order:
  //   1. wizardConfig.resourceUrl (sidecar JSON — preferred path, PLA-0037)
  //   2. mode-derived fallback (back-compat for callers not on sidecars yet)
  // Both endpoints land on artefactitemsv2 with different scope (work | strategy).
  const resourceUrl =
    wizardConfig?.resourceUrl ?? (mode === "portfolio_items" ? "/portfolio-items" : "/work-items");

  const { windowRoots, total, loadingWindow, patchAndApply, fetchChildren } =
    useArtefactItemsWindow({
      resourceUrl,
      pageSize,
      pageIndex,
      sortKey,
      sortDir,
      filters,
      onPatched,
    });

  // Patch wrapper to satisfy the ResourceTree contract (returns the row).
  const patchRemote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      patchAndApply(id, body);
      return { id, ...body } as unknown as WorkItem;
    },
    [patchAndApply],
  );

  const columns = useMemo(
    () => buildWorkItemsColumns(flowStates, patchAndApply, colourMap),
    [flowStates, patchAndApply, colourMap],
  );

  const handleSortChange = useCallback(
    (key: string | null, dir: "asc" | "desc") => {
      setSort(key as SortKey | null, dir);
    },
    [setSort],
  );

  // Build config based on mode or accept from wizardConfig (p_wizard.json).
  const config = useMemo<ObjectTreeDataConfig<WorkItem>>(() => {
    if (wizardConfig) {
      return {
        ...wizardConfig,
        columns,
      };
    }
    const isPortfolio = mode === "portfolio_items";
    return {
      label: isPortfolio ? "Portfolio items" : "Work items",
      searchPlaceholder: isPortfolio ? "Search portfolio items…" : "Search work items…",
      ariaLabel: isPortfolio ? "Portfolio items dense grid" : "Work items dense grid",
      treeName: isPortfolio ? "portfolioitems" : "workitems",
      columns,
      dndResourceType: isPortfolio ? "portfolio_item" : "work_item",
      dndEnabled: true,
      defaultSortKey: null,
      defaultSortDir: "asc",
      getParentId: (r) => r.parent_id,
      getChildrenCount: (r) => r.children_count,
      searchAccessor: (r) => `${r.title} vec-${r.key_num}`,
      panelHeader: <WorkItemsPanelHeader />,
      filterChips: <WorkItemsFilterChips />,
      paginationOptions: [25, 50, 100],
      defaultPageSize: 25,
      resourceUrl: isPortfolio ? "/portfolio-items" : "/work-items",
      scope: isPortfolio ? "strategy" : "work",
    };
  }, [mode, columns, wizardConfig]);

  return (
    <div>
      {config.panelHeader}
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
      <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
      <ResourceTree<WorkItem>
        roots={windowRoots}
        total={total}
        getId={(r) => r.id}
        getParentId={config.getParentId}
        getChildrenCount={config.getChildrenCount}
        fetchChildren={fetchChildren}
        patch={patchRemote}
        columns={config.columns}
        pagination={{ pageSize, options: config.paginationOptions }}
        search={{ placeholder: config.searchPlaceholder, accessor: config.searchAccessor }}
        sort={{ key: sortKey, dir: sortDir, onChange: handleSortChange }}
        {...(config.dndEnabled && { dnd: { resourceType: config.dndResourceType } })}
        selection={{ mode: "multi", selectedIds, onSelectionChange: setSelectedIds }}
        selectedId={selectedId}
        onSelect={onSelect}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onPageSizeChange={setPageSize}
        loading={loadingWindow}
        filterChips={config.filterChips}
        ariaLabel={config.ariaLabel}
        name={config.treeName}
      />
    </div>
  );
}
