// Resolver for p_wizard.json component references.
// Maps component name strings to actual React components/functions.

import { buildWorkItemsColumns } from "@/app/components/work-items-tree-config";
import type { ObjectTreeDataConfig } from "@/app/components/ObjectTree/p_ObjectTree";

interface RawWizardConfig extends Partial<ObjectTreeDataConfig> {
  columnsComponent?: string;
  panelHeaderComponent?: string;
  filterChipsComponent?: string;
  [key: string]: any;
}

/**
 * Resolves string component references in a p_wizard.json config.
 * For functions like buildWorkItemsColumns, this calls them and includes the result.
 */
export function resolveWizardConfig(
  rawConfig: RawWizardConfig
): RawWizardConfig {
  const resolved: RawWizardConfig = { ...rawConfig };

  // Resolve columnsComponent to actual columns array
  if (rawConfig.columnsComponent === "buildWorkItemsColumns") {
    resolved.columns = buildWorkItemsColumns();
  }

  // Component name strings stay as-is for pages to instantiate as JSX
  return resolved;
}
