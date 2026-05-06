"use client";

// WorkItemsTree — work-items preset over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// work-items-tree-config.tsx. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every work-items concern lives in the config file.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import BulkActionBar from "@/app/components/BulkActionBar";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import {
  buildWorkItemsColumns,
  useWorkItemsFilters,
  useWorkItemsSort,
  useWorkItemsWindow,
  WorkItemsFilterChips,
  WorkItemsPanelHeader,
  type SortKey,
  type WorkItem,
} from "@/app/components/work-items-tree-config";

export type { WorkItem };

export default function WorkItemsTree({
  selectedId,
  onSelect,
  onPatched,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
}) {
  const flowStates = useWorkItemFlowStates();
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

  const { windowRoots, total, loadingWindow, patchAndApply, fetchChildren } =
    useWorkItemsWindow(pageSize, pageIndex, sortKey, sortDir, filters, onPatched);

  // Patch wrapper to satisfy the ResourceTree contract (returns the row).
  const patchRemote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      patchAndApply(id, body);
      return { id, ...body } as unknown as WorkItem;
    },
    [patchAndApply],
  );

  const columns = useMemo(
    () => buildWorkItemsColumns(flowStates, patchAndApply),
    [flowStates, patchAndApply],
  );

  const handleSortChange = useCallback(
    (key: string | null, dir: "asc" | "desc") => {
      setSort(key as SortKey | null, dir);
    },
    [setSort],
  );

  return (
    <div>
      <WorkItemsPanelHeader />
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
      <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
      <ResourceTree<WorkItem>
        roots={windowRoots}
        total={total}
        getId={(r) => r.id}
        getParentId={(r) => r.parent_id}
        getChildrenCount={(r) => r.children_count}
        fetchChildren={fetchChildren}
        patch={patchRemote}
        columns={columns}
        pagination={{ pageSize, options: [25, 50, 100] }}
        search={{ placeholder: "Search work items…", accessor: (r) => `${r.title} vec-${r.key_num}` }}
        sort={{ key: sortKey, dir: sortDir, onChange: handleSortChange }}
        dnd={{ resourceType: "work_item" }}
        selection={{ mode: "multi", selectedIds, onSelectionChange: setSelectedIds }}
        selectedId={selectedId}
        onSelect={onSelect}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onPageSizeChange={setPageSize}
        loading={loadingWindow}
        filterChips={<WorkItemsFilterChips />}
        ariaLabel="Work items dense grid"
        name="workitems"
      />
    </div>
  );
}
