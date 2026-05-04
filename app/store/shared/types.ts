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
  //
  // PLA-0008 — A value may be a plain HTML string (legacy: rendered as
  // body_html only) OR a UiAppHelpDocFragment carrying title + body +
  // optional YouTube videos + optional images, mirroring the backend
  // page_help shape.
  helpDefaults?: Record<string, string | UiAppHelpDocFragment>;
}

// PLA-0008 — Shape a custom-app manifest can ship as fallback help copy.
// All fields except body_html are optional. URLs are validated by the
// frontend renderer (YouTube allowlist + http/https for images) so a bad
// manifest cannot leak a non-whitelisted iframe into the DOM.
export interface UiAppHelpDocFragment {
  title?: string;
  body_html?: string;
  video_embeds?: Array<{ url: string; title?: string; position?: number }>;
  image_urls?: Array<{ url: string; alt?: string; caption?: string; position?: number }>;
}

export interface UiAppProps {
  appId: string;
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}
