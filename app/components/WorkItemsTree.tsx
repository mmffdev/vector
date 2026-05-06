"use client";

// WorkItemsTree — work-items preset over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// work-items-tree-config.tsx. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every work-items concern lives in the config file.

import React, { useCallback, useMemo, useState } from "react";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import {
  buildWorkItemsColumns,
  sortRoots,
  useWorkItemsWindow,
  WorkItemsFilterChips,
  WorkItemsPanelHeader,
  type SortDir,
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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { windowRoots, total, loadingWindow, patchAndApply, fetchChildren } =
    useWorkItemsWindow(pageSize, pageIndex, sortKey, sortDir, onPatched);

  // Local sort over the loaded window — only `id` is server-driven.
  const sortedRoots = useMemo(() => {
    if (!sortKey || sortKey === "id") return windowRoots;
    return sortRoots(windowRoots, sortKey, sortDir);
  }, [windowRoots, sortKey, sortDir]);

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
      setSortKey(key as SortKey | null);
      setSortDir(dir);
    },
    [],
  );

  return (
    <div>
      <WorkItemsPanelHeader />
      <ResourceTree<WorkItem>
        roots={sortedRoots}
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
        selectedId={selectedId}
        onSelect={onSelect}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onPageSizeChange={setPageSize}
        loading={loadingWindow}
        filterChips={<WorkItemsFilterChips />}
        ariaLabel="Work items dense grid"
      />
    </div>
  );
}
