"use client";

import React from "react";
import type { ObjectTreeConfig } from "@/app/components/ObjectTree/p_ObjectTreeRegistry";

export interface StrategyItem {
  id: string;
  number: string;
  title: string;
  description: string | null;
  position: number;
  type_id: string;
  type_name: string;
  type_prefix: string;
  layer_depth: number | null;
  parent_artefact_id: string | null;
  parent_title: string | null;
  parent_prefix: string | null;
  parent_number: string | null;
  created_at: string;
  updated_at: string;
}

// Column renderers — placeholder stubs (to be implemented per UX spec)
const renderStrategyTitle = (row: StrategyItem) => row.title;
const renderStrategyType = (row: StrategyItem) => row.type_name;

export const strategyItemsConfig: ObjectTreeConfig<StrategyItem> = {
  dataType: "strategy_items",
  label: "Strategy items",
  searchPlaceholder: "Search strategy items…",
  ariaLabel: "Strategy items dense grid",
  treeName: "strategyitems",
  summaryEndpoint: "/strategy-items/summary",
  columns: [
    { key: "number", label: "ID", width: 80, sortable: true },
    {
      key: "title",
      label: "Summary",
      width: 200,
      cellRenderer: renderStrategyTitle,
    },
    {
      key: "type_name",
      label: "Type",
      width: 120,
      cellRenderer: renderStrategyType,
    },
    { key: "description", label: "Description", width: 300 },
    { key: "position", label: "Position", width: 80 },
  ],
  dnd: {
    enabled: true,
    resourceType: "strategy_item",
  },
  sort: {
    defaultKey: "position",
    defaultDir: "asc",
  },
  selection: {
    multiSelect: true,
  },
  hierarchy: {
    getParentId: (row: StrategyItem) => row.parent_artefact_id,
    getChildrenCount: () => 0, // computed server-side; not in StrategyItem
  },
  search: {
    accessor: (row: StrategyItem) => `${row.title} ${row.number}`,
  },
  pagination: {
    options: [10, 25, 50],
    defaultPageSize: 25,
  },
  filterChips: undefined, // TODO: implement StrategyFilterChips
};
