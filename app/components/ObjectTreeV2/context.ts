"use client";

// ObjectTreeV2 context registry — Slice 1.5 of the ObjectTree refactor
// (docs/c_c_objecttree_refactor_plan.md).
//
// Maps JSON-config context string names to React hook accessors. A
// wizard config's `context` block looks like:
//
//   {
//     "context": {
//       "workspaceId":  { "from": "auth.user.subscription_id", "required": true,
//                         "passToFetchAs": "workspace_id" },
//       "scopeNodeId":  { "from": "scope.activeNodeId", "required": false,
//                         "passToFetchAs": "meg", "passToFetchOn": ["GET"] }
//     }
//   }
//
// At mount, useResolveContext (below) reads each entry's `from` field,
// looks up the matching accessor here, calls it, and returns the
// resolved values to the shell. Data hooks consume the flat object;
// they never call useAuth() / useScope() themselves.
//
// Why a registry instead of direct imports: configs are STRINGS (JSON,
// agent-introspectable, tenant-shippable). Strings reference accessors
// by stable name. Adding a new context dimension (theme, feature flag,
// permission) = new entry here; configs reference it without code
// change. Same property the component / rule / plugin registries
// provide for their respective categories.

import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";

// ── Type ────────────────────────────────────────────────────────────────────

/**
 * A context accessor is a React hook that returns the current value of
 * one slot. Called inside React render — same rules-of-hooks apply.
 * Must be cheap; called on every shell render plus every resolve cycle.
 */
export type ContextAccessor = () => unknown;

// ── Registry ────────────────────────────────────────────────────────────────

export const contextRegistry: Record<string, ContextAccessor> = {
  // Auth — the user identity slot. Configs reference these for any
  // call that needs "who is the caller". subscription_id is the
  // workspace clamp on every grid in Vector.
  "auth.user.id": () => useAuth().user?.id ?? null,
  "auth.user.subscription_id": () => useAuth().user?.subscription_id ?? null,
  "auth.user.role": () => useAuth().user?.role ?? null,
  "auth.user.email": () => useAuth().user?.email ?? null,

  // Scope — the topology-clamp slot. activeNodeId drives the ?meg=
  // forwarding on GETs; direction toggles ascend/descend semantics
  // for reports.
  "scope.activeNodeId": () => useScope().activeNodeId,
  "scope.direction": () => useScope().direction,

  // Future inhabitants (registered when needed by a config):
  //   "tenant.theme"          — theme pack id
  //   "featureFlags.<name>"   — individual flag readers
  //   "permissions.<code>"    — useHasPermission(code) wrappers
};

// ── Public lookup ───────────────────────────────────────────────────────────

export function getContextAccessor(name: string): ContextAccessor {
  const entry = contextRegistry[name];
  if (!entry) {
    throw new Error(
      `[ObjectTreeV2 context registry] no accessor for "${name}" — ` +
        `add it to app/components/ObjectTreeV2/context.ts before a ` +
        `wizard config references it.`,
    );
  }
  return entry;
}

// ── Declarative resolver ────────────────────────────────────────────────────

/**
 * Wizard-config-style context declaration. Each entry says:
 *   from      registry key (e.g. "auth.user.subscription_id")
 *   required  block render when missing (false = optional, default value used)
 *   default   fallback when the accessor returns null/undefined
 */
export interface ContextDecl {
  from: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Result shape from useResolveContext. `isReady` is false when any
 * required slot is missing — the shell renders an empty state instead
 * of mounting the grid against partial context.
 */
export interface ResolvedContext {
  isReady: boolean;
  missing: string[];
  values: Record<string, unknown>;
}

/**
 * Resolve a context decl-map into actual values. Called inside the
 * shell's render — rules-of-hooks apply (the accessors are hooks).
 *
 * **Important:** the decl-map's KEYS are stable across renders (they
 * come from a JSON config that doesn't mutate). So the for-of loop
 * calling hooks is safe — the order is fixed. If a config ever mutated
 * its context decl keys at runtime, that would break rules of hooks,
 * but configs are declarative + immutable per shell instance.
 */
export function useResolveContext(decl: Record<string, ContextDecl>): ResolvedContext {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const [name, slot] of Object.entries(decl)) {
    const accessor = getContextAccessor(slot.from);
    // Calling the accessor IS calling the hook. The decl-map's key
    // order is stable across renders (sourced from a fixed JSON
    // config), so the hook-call sequence is stable too.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const raw = accessor();
    const value = raw ?? slot.default ?? null;
    if (value == null && slot.required) {
      missing.push(name);
      continue;
    }
    values[name] = value;
  }

  return {
    isReady: missing.length === 0,
    missing,
    values,
  };
}
