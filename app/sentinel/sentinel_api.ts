/**
 * Sentinel — HTTP wrapper.
 *
 * Every sentinel-mediated server call goes through the canonical
 * `apiSite()` helper in app/lib/api.ts — that helper owns env
 * resolution (NEXT_PUBLIC_API_BASE), DPoP proofs, and the silent
 * refresh-and-retry flight for 401s. Per the lint:api-caller-discipline
 * rule, no one outside `app/lib/api.ts` should read those env vars
 * directly.
 *
 * Sentinel adds one layer on top of `apiSite()`: a 401 hook that
 * lets the provider re-boot transparently when the server invalidates
 * the session (workspace switch, role revocation, token rotation).
 * The hook fires AFTER api.ts's own refresh+retry has already failed,
 * so it only triggers for terminal 401s that need full reload, not
 * for transient token expiry.
 *
 * The setUnauthorizedHandler mechanism is what closes the workspace-
 * switch race structurally: when the JWT goes stale, the next call
 * surfaces a 401, we re-boot the provider, and consumers see the
 * new state on the next render — no module-level escape hatches.
 */

import { apiSite, ApiError } from "@/app/lib/api";
import type { SentinelBootPayload, SentinelWorkspaceSettings } from "./types";

export type UnauthorizedHandler = () => void;

let _onUnauthorized: UnauthorizedHandler | null = null;

/** Register the provider's reload-on-401 callback. Called once on mount. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  _onUnauthorized = fn;
}

/**
 * sentinelCall wraps apiSite() with the sentinel 401 hook. Any 401
 * that apiSite() couldn't transparently recover from (i.e. silent
 * refresh-and-retry failed) fires the registered handler, which the
 * provider uses to re-boot itself. The original 401 still throws.
 */
async function sentinelCall<T = unknown>(path: string, opts?: Parameters<typeof apiSite>[1]): Promise<T> {
  try {
    return await apiSite<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && _onUnauthorized) {
      _onUnauthorized();
    }
    throw err;
  }
}

/**
 * GET /sentinel/boot — populates the provider's full state bag.
 *
 * Tries the canonical /sentinel/boot route first; falls back to a
 * client-side synthesis from /auth/me + /topology/grants/me when the
 * backend route isn't mounted (PLA062 follow-up). Wire shape returned
 * to the provider is identical in both paths.
 */
export async function fetchBoot(): Promise<SentinelBootPayload> {
  // Path 1 — canonical /sentinel/boot. When the route is mounted this
  // is the only round-trip; when it 404s we fall through. Other status
  // codes (401, 500) bubble up unchanged so the provider's error
  // handling (and the 401 reload hook) keeps working.
  try {
    return await sentinelCall<SentinelBootPayload>("/sentinel/boot");
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    // fall through to the bridge
  }

  // Path 2 — bridge synthesis. /auth/me carries identity + permissions;
  // /topology/grants/me carries the scope grants. Both exist today.
  interface AuthMeResp {
    id: string;
    email: string;
    subscription_id: string;
    workspace_id: string;
    role: { id: string; code: string };
    permissions: string[];
    mfa_enrolled?: boolean;
    force_password_change?: boolean;
    // Mirrors users.default_focus_node_id (migration 243). Drives the
    // home-topology-node preference in account-settings; null when the
    // user hasn't picked one yet (resolveFocusNode falls through to
    // tenant root).
    default_focus_node_id?: string | null;
    // Mirrors users.home_location_follow_mode (migration 244). FALSE
    // (Pinned, default) means scope-rail clicks are session-only;
    // TRUE (Follow) means they also persist into default_focus_node_id.
    home_location_follow_mode?: boolean;
  }
  interface GrantRow {
    grant_id?: string;
    node_id: string;
    workspace_id?: string;
    parent_id?: string | null;
    name?: string;
    label_override?: string | null;
    colour?: string | null;
    icon?: string | null;
    role: string;
    granted_at?: string;
    position?: number;
  }
  // Fire in parallel. Either call 401-ing surfaces as the same error
  // the original sentinelCall would have thrown.
  const [me, grantsRaw] = await Promise.all([
    sentinelCall<AuthMeResp>("/auth/me"),
    sentinelCall<{ grants?: GrantRow[] } | GrantRow[]>("/topology/grants/me").catch(() => [] as GrantRow[]),
  ]);
  const grants: GrantRow[] = Array.isArray(grantsRaw) ? grantsRaw : (grantsRaw?.grants ?? []);
  // Pick a tenant root: prefer the topmost grant (no parent_id); fall
  // back to the first grant's node_id; fall back to empty string.
  const root = grants.find((g) => !g.parent_id)?.node_id ?? grants[0]?.node_id ?? "";
  return {
    user: {
      id: me.id,
      email: me.email,
      tenant_id: me.subscription_id,
      role: me.role?.code ?? "user",
      role_id: me.role?.id ?? "",
      permissions: me.permissions ?? [],
      default_focus_node_id: me.default_focus_node_id ?? null,
      home_location_follow_mode: me.home_location_follow_mode ?? false,
      workspace_id: me.workspace_id ?? "",
      mfa_enrolled: me.mfa_enrolled,
      force_password_change: me.force_password_change,
    },
    tenant: {
      id: me.subscription_id,
      name: "",
    },
    grants,
    tenant_root: root,
  };
}

/** POST /sentinel/switch-tenant — re-mints JWT for the new tenant. */
export async function postSwitchTenant(tenantId: string): Promise<SentinelBootPayload> {
  return sentinelCall<SentinelBootPayload>("/sentinel/switch-tenant", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId }),
  });
}

/**
 * POST /sentinel/switch-workspace — re-mints JWT for a different
 * workspace within the current tenant. tenant_id stays; workspace_id
 * + grants refresh.
 *
 * Replaces the prior `AuthContext.switchWorkspace` after S14 (mid-S14
 * scope expansion, PLA062 revision-history 2026-05-24).
 */
export async function postSwitchWorkspace(workspaceId: string): Promise<SentinelBootPayload> {
  return sentinelCall<SentinelBootPayload>("/sentinel/switch-workspace", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

/**
 * PUT /sentinel/settings — persist workspace settings (theme, tenant_name,
 * arbitrary forward-compat slots). Server returns the saved record so
 * the provider's reducer can refresh sentinel_settings atomically.
 */
export async function putSettings(settings: SentinelWorkspaceSettings): Promise<SentinelWorkspaceSettings> {
  return sentinelCall<SentinelWorkspaceSettings>("/sentinel/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** PUT /sentinel/focus — persists users.default_focus_node_id. */
export async function putFocus(nodeId: string | null): Promise<void> {
  await sentinelCall<void>("/sentinel/focus", {
    method: "PUT",
    body: JSON.stringify({ focus_node_id: nodeId }),
  });
}

/**
 * PUT /me/home-location-follow-mode — persists the Pinned/Follow toggle
 * (users.home_location_follow_mode, migration 244). Lives on /me/ (not
 * /sentinel/) because the column is a simple per-user preference rather
 * than part of the request-time clamp substrate.
 */
export async function putHomeFollowMode(follow: boolean): Promise<void> {
  await sentinelCall<void>("/me/home-location-follow-mode", {
    method: "PUT",
    body: JSON.stringify({ follow }),
  });
}

/**
 * sentinel_api_call exposes the sentinelCall behaviour to consumers
 * that need to fire arbitrary site-API endpoints with the 401-reload
 * semantics. The Sentinel-provided action passed to `useSentinel()`
 * delegates here so test cases can mock the boot+401 path uniformly.
 *
 * Returns a Response-like shape for test ergonomics (status + json())
 * even though apiSite() throws on non-2xx; we catch ApiError and
 * synthesize a Response-shaped wrapper so the test's `fetch` mock
 * pattern works without rewriting around throw semantics.
 */
export async function sentinel_api_call(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: () => Promise<unknown> }> {
  try {
    const body = await sentinelCall<unknown>(path, {
      method: (init?.method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | undefined) ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return { status: 200, json: async () => body };
  } catch (err) {
    if (err instanceof ApiError) {
      return { status: err.status, json: async () => err.body };
    }
    throw err;
  }
}
