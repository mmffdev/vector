// allowedRoles is a list of role codes (e.g. "user", "padmin", "gadmin",
// or any tenant-defined code post-PLA-0007). Authoring tools that emit
// manifests don't need to know the structured role row; only the codes.
export type AllowedRoleCode = string;

export interface UiAppManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  author: string;
  category: "dashboard" | "planning" | "reporting" | "integration" | "utility" | "custom";
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  allowedRoles: AllowedRoleCode[];
  requiredScopes?: string[];
  configurable?: boolean;
  // PLA-0005 — Samantha SDK help-manifest contract.
  // Optional fallback help copy keyed by "<kind>:<name_pattern>" (e.g.
  // "panel:work_items_filters", "table:*"). Resolution order at popover
  // open: page_help row -> library_help_defaults -> SDK manifest entry
  // -> null. Patterns support a trailing "*" wildcard for kind-wide
  // defaults, mirroring the backend's library_help_defaults behaviour.
  helpDefaults?: Record<string, string>;
}

export interface UiAppProps {
  appId: string;
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}
