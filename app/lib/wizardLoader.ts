// Resolver for p_wizard.json component references.
// Maps component name strings to actual React components/functions.
// Functions like getParentId and getChildrenCount must be built by the page.

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

// Pages own column construction (buildWorkItemsColumns requires runtime
// flowStates + patchAndApply that JSON can't carry). resolveWizardConfig
// keeps descriptor strings unmodified — pages dispatch on the
// columnsComponent / filterChipsComponent / _functions descriptors.
export function resolveWizardConfig(
  rawConfig: RawWizardConfig
): RawWizardConfig {
  return { ...rawConfig };
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
