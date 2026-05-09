"use client";

import React from "react";
import { WorkItemsPanelHeader } from "@/app/components/work-items-tree-config";
import { WorkItemsFilterChips } from "@/app/components/work-items-tree-config";
import type { WorkItem } from "@/app/components/work-items-tree-config";
import type { ObjectTreeConfig } from "@/app/components/ObjectTree/p_ObjectTreeRegistry";
import {
  buildWorkItemColumns,
  renderTitle,
  renderStatus,
  renderPriority,
  renderOwner,
  renderSprint,
  renderDueDate,
} from "@/app/components/work-items-tree-config";

export const workItemsConfig: ObjectTreeConfig<WorkItem> = {
  dataType: "work_items",
  label: "Work items",
  searchPlaceholder: "Search work items…",
  ariaLabel: "Work items dense grid",
  treeName: "workitems",
  summaryEndpoint: "/work-items/summary",
  columns: buildWorkItemColumns(),
  dnd: {
    enabled: true,
    resourceType: "work_item",
  },
  sort: {
    defaultKey: "key_num",
    defaultDir: "asc",
  },
  selection: {
    multiSelect: true,
  },
  hierarchy: {
    getParentId: (row: WorkItem) => row.parent_id,
    getChildrenCount: (row: WorkItem) => row.children_count,
  },
  search: {
    accessor: (row: WorkItem) => `${row.title} ${row.key_num}`,
  },
  pagination: {
    options: [10, 25, 50, 100],
    defaultPageSize: 25,
  },
  panelHeader: <WorkItemsPanelHeader />,
  filterChips: <WorkItemsFilterChips />,
};
