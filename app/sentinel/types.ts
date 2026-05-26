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

/**
 * A grant the user holds on a topology node.
 * Mirrors the MyGrant shape from topologyApi (legacy ScopeContext)
 * so pages migrated to Sentinel can read the same surface they used
 * to read off `activeGrant`/`grants[]`.
 */
export interface SentinelGrant {
  grant_id?: string;
  node_id: string;
  workspace_id?: string;
  parent_id?: string | null;
  /** Node name (display). */
  name?: string;
  /** User-set label override (display). */
  label_override?: string | null;
  /** Optional colour hex. */
  colour?: string | null;
  /** Optional icon name. */
  icon?: string | null;
  /** Role on that node — "admin" | "editor" | "viewer". */
  role: string;
  granted_at?: string;
  /** Sibling sort order from topology_nodes.sort_order. */
  position?: number;
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
  /**
   * Pinned (false, default) vs Follow (true) mode for the Home Location
   * dropdown on /user/account-settings (migration 244). When true,
   * sentinel_set_focus also persists into default_focus_node_id; when
   * false, scope-rail clicks stay session-only.
   */
  home_location_follow_mode: boolean;
  /** The user's current workspace (from JWT claim, S05 absorption). */
  workspace_id: string;
  /** Whether the user has enrolled in TOTP MFA — drives step-up TOTP prompt. */
  mfa_enrolled?: boolean;
  /** Whether the user must change their password on next sign-in. */
  force_password_change?: boolean;
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
  /**
   * Active scope direction — "descend" means the focus node + its
   * descendants are in scope (default); "ascend" means the focus node
   * + its ancestors. Mirrors the legacy ScopeContext direction prop so
   * tree panels can drive the toggle through Sentinel.
   */
  sentinel_scope_direction: "ascend" | "descend";

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
  /**
   * Set focus node. Always pins the session focus (focus_override) and
   * writes ?meg=. ONLY persists to users.default_focus_node_id when
   * sentinel_user.home_location_follow_mode is true; otherwise the
   * persistent home column is left alone.
   */
  sentinel_set_focus: (nodeId: string | null) => Promise<void>;
  /**
   * Persist a new home topology node — direct write to
   * users.default_focus_node_id via PUT /sentinel/focus, and re-anchor
   * the current session focus + URL to the same node so stale ?meg=
   * state cannot keep the shell pointed elsewhere. Used by the Home
   * Location dropdown on /user/account-settings (which is an explicit
   * "save this as my home" action regardless of follow mode).
   */
  sentinel_set_default_focus: (nodeId: string | null) => Promise<void>;
  /**
   * Persist the Pinned (false) vs Follow (true) home-location toggle.
   * Optimistic local update + PUT /me/home-location-follow-mode; reverts
   * on server failure.
   */
  sentinel_set_home_follow_mode: (follow: boolean) => Promise<void>;
  /** Toggle scope direction — local-only state for now (no server persistence). */
  sentinel_set_scope_direction: (dir: "ascend" | "descend") => void;
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
