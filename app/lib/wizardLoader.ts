// Resolver for p_wizard.json component references.
// Maps component name strings to actual React components/functions.
// Functions like getParentId and getChildrenCount must be built by the page.

import { buildWorkItemsColumns } from "@/app/components/work-items-tree-config";
import type { ObjectTreeDataConfig } from "@/app/components/ObjectTree/p_ObjectTree";
import type { WorkItem } from "@/app/components/work-items-tree-config";

interface RawWizardConfig extends Partial<ObjectTreeDataConfig> {
  columnsComponent?: string;
  filterChipsComponent?: string;
  _functions?: {
    getParentId?: string;
    getChildrenCount?: string;
    searchAccessor?: string;
  };
  [key: string]: any;
}

/**
 * Resolves string component references in a p_wizard.json config.
 * For functions like buildWorkItemsColumns, this calls them.
 * For hierarchy/search functions, returns descriptors that pages interpret.
 */
export function resolveWizardConfig(
  rawConfig: RawWizardConfig
): RawWizardConfig {
  const resolved: RawWizardConfig = { ...rawConfig };

  // Resolve columnsComponent to actual columns array
  if (rawConfig.columnsComponent === "buildWorkItemsColumns") {
    resolved.columns = buildWorkItemsColumns();
  }

  // Keep _functions descriptors so pages can build the actual closures
  return resolved;
}

/**
 * Builds hierarchy and search functions for work-items config.
 * Pages call this to interpret the _functions descriptors.
 */
export function buildWorkItemsFunctions() {
  return {
    getParentId: (row: WorkItem) => row.parent_id,
    getChildrenCount: (row: WorkItem) => row.children_count,
    searchAccessor: (row: WorkItem) => `${row.title} vec-${row.key_num}`,
  };
}
