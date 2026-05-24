/**
 * Sentinel — frontend type surface.
 *
 * The single source of truth for identity / tenant / scope on the
 * client. Every field is `sentinel_*`-prefixed so it's unambiguous
 * at call sites that the value came from Sentinel and not from a
 * legacy AuthContext / ScopeContext / TenantContext fragment.
 *
 * See docs/Security/Sentinel/sentinel_docs.md § Synopsis for the
 * narrative; this file pins the type contract.
 */

/** Permission code (lower_snake.dotted) — e.g. "work_items.list". */
export type SentinelPermission = string;

/** A grant the user holds on a topology node. */
export interface SentinelGrant {
  node_id: string;
  /** Role on that node — "admin" | "editor" | "viewer". */
  role: string;
}

export interface SentinelUser {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  role_id: string;
  permissions: SentinelPermission[];
  /** Per-user persisted focus node (S06). null = no preference. */
  default_focus_node_id: string | null;
  /** The user's current workspace (from JWT claim, S05 absorption). */
  workspace_id: string;
}

export interface SentinelTenant {
  id: string;
  name: string;
}

/**
 * Workspace-level settings absorbed by Sentinel mid-S14 (PLA062
 * revision-history 2026-05-24). Carries the writer surface that
 * `workspace-admin/workspace-details/page.tsx` and the theme bootstrap
 * use to refresh per-workspace cache after a successful PUT.
 */
export interface SentinelWorkspaceSettings {
  tenant_name?: string;
  /** Theme pack id (e.g. "vector-mono"). */
  theme_pack?: string;
  /** Arbitrary forward-compat slot for additional settings fields. */
  [key: string]: unknown;
}

/**
 * The full state bag exposed by useSentinel(). All fields are read-
 * only views; mutate via the action methods.
 *
 * `sentinel_workspace_in_sync` is the derived predicate that closes
 * the race the original Sentinel patched: true when there's no
 * active grant, or when the active grant's tenant matches the
 * user's current tenant. Goes false only during the desync window
 * between a manual workspace switch and the coordinated reload —
 * with the atomic switch contract, that window has zero size.
 */
export interface SentinelState {
  // Identity slice
  sentinel_user: SentinelUser | null;
  sentinel_role: string | null;
  sentinel_permissions: ReadonlySet<SentinelPermission>;

  // Tenant slice
  sentinel_tenant: SentinelTenant | null;

  // Scope slice
  sentinel_grants: ReadonlyArray<SentinelGrant>;
  sentinel_focus_node: string | null;
  sentinel_scope_up: boolean;
  sentinel_scope_down: boolean;

  // Workspace-settings slice (absorbed mid-S14)
  sentinel_settings: SentinelWorkspaceSettings | null;

  // Derived
  sentinel_workspace_in_sync: boolean;
  sentinel_loading: boolean;

  // Actions
  /** Switch to a different tenant — re-mints JWT + reloads grants atomically. */
  sentinel_switch_tenant: (tenantId: string) => Promise<void>;
  /** Switch to a different workspace within the current tenant — re-mints JWT with new workspace_id claim. */
  sentinel_switch_workspace: (workspaceId: string) => Promise<void>;
  /** Set focus node — persists to users.default_focus_node_id on the server. */
  sentinel_set_focus: (nodeId: string | null) => Promise<void>;
  /** Persist workspace settings (theme, tenant_name, prefs) to server + refresh local cache. */
  sentinel_set_settings: (settings: SentinelWorkspaceSettings) => Promise<void>;
  /** Returns true if the user holds the named permission. */
  sentinel_can: (code: SentinelPermission) => boolean;
  /** Force a reload of the full Sentinel boot payload. */
  sentinel_reload: () => Promise<void>;
  /**
   * Wrapper around fetch() that auto-triggers sentinel_reload() on
   * any 401 response. All sentinel-mediated server calls should go
   * through this rather than raw fetch so the workspace-switch race
   * + the role-revocation case both refresh state automatically.
   */
  sentinel_api_call: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Wire shape of GET /sentinel/boot. */
export interface SentinelBootPayload {
  user: SentinelUser;
  tenant: SentinelTenant;
  grants: SentinelGrant[];
  tenant_root: string;
  /** Optional in the wire shape so the backend can ship boot without
   *  settings during the absorption rollout (S14 → S22). When absent,
   *  the provider leaves sentinel_settings at null. */
  settings?: SentinelWorkspaceSettings;
}
