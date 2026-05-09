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
