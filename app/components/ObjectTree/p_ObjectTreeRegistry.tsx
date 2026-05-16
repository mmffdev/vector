"use client";

// ObjectTree configuration registry — pluggable data-type definitions.
// Each entry maps a dataType string (work_items, portfolio_items, releases, etc.)
// to a configuration object that tells ObjectTree how to fetch, render, and interact
// with that data type. Configuration is the single source of truth for DnD enablement,
// columns, endpoints, filters, sort orders, and all other data-type-specific behavior.
//
// Future: As we add releases, sprints, and other data types, each will register
// its own config here. ObjectTree remains dumb — it just consumes the config and
// delegates all data-type-specific behavior to it.

import React from "react";
import type { ColumnDef } from "@/app/components/ResourceTree";

// ─── Public types ─────────────────────────────────────────────────────────────

// Full ObjectTreeConfig for future use when we register multiple data types.
// For now, ObjectTree builds a partial config internally based on the `mode` prop.
export interface ObjectTreeConfig<T> {
  // Data type identifier (work_items, portfolio_items, releases, sprints, etc.)
  dataType: string;

  // UI labels and messaging
  label: string; // e.g. "Work items", "Portfolio items"
  searchPlaceholder: string; // e.g. "Search work items…"
  ariaLabel: string; // e.g. "Work items dense grid"
  treeName: string; // e.g. "workitems", "portfolioitems" (for addressing)

  // Data I/O endpoints
  summaryEndpoint: string; // e.g. "/work-items/summary"

  // Columns and rendering
  columns: ColumnDef<T>[];

  // Drag-and-drop configuration
  dnd: {
    enabled: boolean;
    resourceType: string; // e.g. "work_item", "portfolio_item"
  };

  // Sorting configuration
  sort: {
    defaultKey: string | null;
    defaultDir: "asc" | "desc";
  };

  // Selection behavior
  selection: {
    multiSelect: boolean;
  };

  // Expansion/hierarchy
  hierarchy: {
    getParentId: (row: T) => string | null;
    getChildrenCount: (row: T) => number;
  };

  // Search accessor
  search: {
    accessor: (row: T) => string; // e.g. `${title} vec-${key_num}`
  };

  // Pagination
  pagination: {
    options: number[];
    defaultPageSize: number;
  };

  // Optional panel header and filter chips (renderable React nodes)
  panelHeader?: React.ReactNode;
  filterChips?: React.ReactNode;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const objectTreeRegistry: Record<string, ObjectTreeConfig<any>> = {};

export function registerObjectTreeConfig<T>(
  dataType: string,
  config: ObjectTreeConfig<T>,
): void {
  objectTreeRegistry[dataType] = config;
}

export function getObjectTreeConfig<T>(
  dataType: string,
): ObjectTreeConfig<T> | null {
  return objectTreeRegistry[dataType] ?? null;
}

// ─── Example Configs (for reference) ──────────────────────────────────────────
//
// Example A: work_items tree
//
//   export interface WorkItem {
//     id: string; key_num: number; item_type: "epic" | "story" | "task" | "defect" | "risk";
//     title: string; status: string; flow_state_id: string; flow_state_name: string;
//     priority: string | null; story_points: number | null; sprint_id: string | null;
//     sprint: { id: string; alias: string } | null; owner: { id: string; display_name: string } | null;
//     due_date: string | null; parent_id: string | null; children_count: number; created_at: string; updated_at: string;
//   }
//
//   const workItemsConfig: ObjectTreeConfig<WorkItem> = {
//     dataType: "work_items",
//     label: "Work items",
//     searchPlaceholder: "Search work items…",
//     ariaLabel: "Work items dense grid",
//     treeName: "workitems",
//     summaryEndpoint: "/work-items/summary",
//     columns: [
//       { key: "key_num", label: "ID", width: 80, sortable: true },
//       { key: "title", label: "Summary", width: 200, cellRenderer: renderTitle },
//       { key: "flow_state_name", label: "Status", width: 120, cellRenderer: renderStatus },
//       { key: "priority", label: "Pri", width: 60, cellRenderer: renderPriority },
//       { key: "story_points", label: "Pts", width: 60 },
//       { key: "owner", label: "Owner", width: 120, cellRenderer: renderOwner },
//       { key: "sprint", label: "Sprint", width: 100, cellRenderer: renderSprint },
//       { key: "due_date", label: "Due", width: 80, cellRenderer: renderDueDate },
//     ],
//     dnd: { enabled: true, resourceType: "work_item" },
//     sort: { defaultKey: "key_num", defaultDir: "asc" },
//     selection: { multiSelect: true },
//     hierarchy: {
//       getParentId: (row) => row.parent_id,
//       getChildrenCount: (row) => row.children_count,
//     },
//     search: { accessor: (row) => `${row.title} ${row.key_num}` },
//     pagination: { options: [10, 25, 50, 100], defaultPageSize: 25 },
//     panelHeader: <WorkItemsPanelHeader />,
//     filterChips: <WorkItemsFilterChips />,
//   };
//
//
// Example B: strategy-items tree (portfolio model layer)
//
//   export interface StrategyItem {
//     id: string; number: string; title: string; description: string | null;
//     position: number; type_id: string; type_name: string; type_prefix: string;
//     layer_depth: number | null; parent_artefact_id: string | null;
//     parent_title: string | null; parent_prefix: string | null; parent_number: string | null;
//     created_at: string; updated_at: string;
//   }
//
//   const strategyItemsConfig: ObjectTreeConfig<StrategyItem> = {
//     dataType: "strategy_items",
//     label: "Strategy items",
//     searchPlaceholder: "Search strategy items…",
//     ariaLabel: "Strategy items dense grid",
//     treeName: "strategyitems",
//     summaryEndpoint: "/strategy-items/summary",
//     columns: [
//       { key: "number", label: "ID", width: 80, sortable: true },
//       { key: "title", label: "Summary", width: 200, cellRenderer: renderTitle },
//       { key: "type_name", label: "Type", width: 120, cellRenderer: renderType },
//       { key: "description", label: "Description", width: 300 },
//       { key: "position", label: "Position", width: 80 },
//     ],
//     dnd: { enabled: true, resourceType: "strategy_item" },
//     sort: { defaultKey: "position", defaultDir: "asc" },
//     selection: { multiSelect: true },
//     hierarchy: {
//       getParentId: (row) => row.parent_artefact_id,
//       getChildrenCount: (row) => 0, // computed server-side; not in StrategyItem
//     },
//     search: { accessor: (row) => `${row.title} ${row.number}` },
//     pagination: { options: [10, 25, 50], defaultPageSize: 25 },
//     panelHeader: <StrategyPanelHeader />,
//     filterChips: <StrategyFilterChips />,
//   };
//
// Both configs are registered via registerObjectTreeConfig(dataType, config).
// ObjectTree.tsx queries the registry via getObjectTreeConfig(mode) and applies
// the config to ResourceTree. Future data types (releases, sprints, etc.) register
// the same way — ObjectTree remains generic.
