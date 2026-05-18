"use client";

// ObjectTree — generic dumb primitive over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// a config object. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every data-type concern lives in the config.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import BulkActionBar from "@/app/components/BulkActionBar";
import Panel from "@/app/components/Panel";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import {
  buildWorkItemsColumns,
  useArtefactItemsWindow,
  useArtefactTypeColours,
  useWorkItemsFilters,
  useWorkItemsSort,
  WorkItemsFilterChips,
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
  title,
  addressableName,
  subtitleBadge,
  subtitle,
  description,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
  mode?: "work_items" | "portfolio_items";
  wizardConfig?: ObjectTreeDataConfig<WorkItem>;
  // Chrome props. ObjectTree renders its own outer <Panel> + sunken header;
  // pages no longer wrap with <Panel>. `title` + `addressableName` are
  // required for the new chrome; `subtitleBadge` / `subtitle` / `description`
  // fill the sunken header band below the title.
  title?: string;
  addressableName?: string;
  subtitleBadge?: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
}) {
  // For now, build config based on mode. Once we have multiple data types,
  // this could accept a config prop or look it up from the registry.
  const flowStates = useWorkItemFlowStates();
  const colourMap = useArtefactTypeColours();
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);

  // Per-user filter/sort preferences are namespaced by treeName so
  // /work-items and /portfolio-items don't bleed across pages
  // (TD-URL-FILTER-CHIPS pay-down). Default keys when consumer hasn't
  // passed treeName: fall back to mode for back-compat.
  const treeName = wizardConfig?.treeName ?? (mode === "portfolio_items" ? "portfolioitems" : "workitems");
  const filtersPrefKey = `${treeName}.filters`;
  const sortPrefKey = `${treeName}.sort`;

  const { filters } = useWorkItemsFilters(filtersPrefKey);
  const { sortKey, sortDir, setSort } = useWorkItemsSort(sortPrefKey);

  // PLA-0021 / 00456 — multi-select state lives here; the tree consumes
  // it via the SelectionConfig prop set, and BulkActionBar reads it to
  // decide whether to render itself.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Filter or sort changes invalidate the page offset — page 5 of an
  // unfiltered/default-sorted set is meaningless on a filtered/resorted set.
  // Multi-value filters are arrays; join to a stable string so identity
  // churn from `useMemo` doesn't fire this effect every render.
  const filterFingerprint =
    filters.type.join(",") + "|" +
    filters.status.join(",") + "|" +
    filters.priority.join(",") + "|" +
    filters.owner_id.join(",");
  useEffect(() => {
    setPageIndex(0);
  }, [filterFingerprint, sortKey, sortDir]);

  // resourceUrl resolution order:
  //   1. wizardConfig.resourceUrl (sidecar JSON — preferred path, PLA-0037)
  //   2. mode-derived fallback (back-compat for callers not on sidecars yet)
  // Both endpoints land on artefactitems with different scope (work | strategy).
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

  // Per-row cog-menu items. Wiring deferred — handlers log for now; the
  // visual surface and dropdown behaviour are the contract for this card.
  const buildCogMenu = useCallback(
    (row: WorkItem) => [
      { key: "edit",      label: "Edit",      onSelect: () => console.log("edit", row.id) },
      { key: "duplicate", label: "Duplicate", onSelect: () => console.log("duplicate", row.id) },
      { key: "move",      label: "Move",      onSelect: () => console.log("move", row.id) },
      { key: "split",     label: "Split",     onSelect: () => console.log("split", row.id) },
      { key: "delete",    label: "Delete",    onSelect: () => console.log("delete", row.id) },
    ],
    [],
  );

  // Build config based on mode or accept from wizardConfig (p_wizard.json).
  // When wizardConfig.filterChips is missing OR doesn't already carry our
  // prefKey-bound chips, we provide them here so the page doesn't have to
  // know the prefKey namespace (TD-URL-FILTER-CHIPS).
  const config = useMemo<ObjectTreeDataConfig<WorkItem>>(() => {
    if (wizardConfig) {
      return {
        ...wizardConfig,
        columns,
        filterChips: wizardConfig.filterChips ?? <WorkItemsFilterChips prefKey={filtersPrefKey} />,
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
      filterChips: <WorkItemsFilterChips prefKey={filtersPrefKey} />,
      paginationOptions: [25, 50, 100],
      defaultPageSize: 25,
      resourceUrl: isPortfolio ? "/portfolio-items" : "/work-items",
      scope: isPortfolio ? "strategy" : "work",
    };
  }, [mode, columns, wizardConfig]);

  // Sunken header band — badge + title + subtitle below the panel title.
  const headerNode = (subtitleBadge || subtitle || description) ? (
    <header className="tree_accordion-dense__panel-head">
      {subtitleBadge && (
        <span className="tree_accordion-dense__panel-head-num">{subtitleBadge}</span>
      )}
      <div className="tree_accordion-dense__panel-head-body">
        {subtitle && (
          <h3 className="tree_accordion-dense__panel-head-title">{subtitle}</h3>
        )}
        {description && (
          <p className="tree_accordion-dense__panel-head-subtitle">{description}</p>
        )}
      </div>
    </header>
  ) : null;

  const inner = (
    <>
      {headerNode}
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
        paginationPosition="bottom"
        search={{ placeholder: config.searchPlaceholder, accessor: config.searchAccessor }}
        sort={{ key: sortKey, dir: sortDir, onChange: handleSortChange }}
        {...(config.dndEnabled && { dnd: { resourceType: config.dndResourceType } })}
        selection={{ mode: "multi", selectedIds, onSelectionChange: setSelectedIds }}
        cogMenu={buildCogMenu}
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
    </>
  );

  // When the page passes title + addressableName, ObjectTree owns its own
  // <Panel>. Otherwise (legacy callers still wrapping with their own Panel)
  // we render bare.
  if (title && addressableName) {
    return (
      <Panel name={addressableName} title={title}>
        {inner}
      </Panel>
    );
  }
  return <div>{inner}</div>;
}
