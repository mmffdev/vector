"use client";

// B16.8 P3 — Sentinel: thin coordination layer over AuthContext + ScopeContext.
//
// Problem it solves: switchWorkspace re-mints the JWT (new workspace_id
// claim) but did not, until this layer, trigger an immediate ScopeContext
// reload. The window between setUser(newUser) returning and React
// scheduling the useEffect that calls reload() could surface
// activeGrant.workspace_id pointing at the OLD workspace — manifesting
// as portfolio model "no bundle" 404s and other workspace-scoped misses.
//
// Coordination strategy:
//   1. ScopeContext registers its latest `reload` reference into the
//      module-level scopeReloadRef on every render (so closure
//      staleness over the `user` dependency is never an issue).
//   2. AuthContext.switchWorkspace awaits scopeReloadRef.current?.()
//      after applyLogin, so by the time switchWorkspace's promise
//      resolves, the grants have been refreshed against the new JWT.
//   3. SentinelProvider mounts above AuthProvider and exposes useSentinel()
//      — a composed view of {auth, scope} plus the derived workspaceInSync
//      predicate. Existing useAuth() / useScope() consumers are untouched.
//
// What this is NOT:
//   • Not a replacement for AuthContext / ScopeContext — they still own
//     their own state and side-effects.
//   • Not a shim layer around the artefact-type / artefact-priority
//     catalogues — those already invalidate correctly via useActiveWorkspace.
//   • Not an absorption of ShellContext — that is UI nav state, not
//     identity/scope.

import { createContext, useContext, type ReactNode } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";

// Module-level ref shared between ScopeContext (writer) and
// AuthContext.switchWorkspace (reader). A function (not a setter) so
// the registration site can register the freshest reload reference on
// every render — the reader always sees the latest closure.
//
// Defaults to a no-op so AuthContext.switchWorkspace works even when
// ScopeProvider is not mounted (e.g. /(overlay)/topology route, login
// pages, server-rendered shells before the user layout boots).
let _scopeReload: () => Promise<void> = async () => {};

export function registerScopeReload(fn: () => Promise<void>): void {
  _scopeReload = fn;
}

export function unregisterScopeReload(): void {
  _scopeReload = async () => {};
}

export async function triggerScopeReload(): Promise<void> {
  await _scopeReload();
}

// SentinelState is the union of auth + scope state plus the derived
// `workspaceInSync` predicate. Consumers wanting the full picture (the
// DebugPanel, future sentinel diagnostics) read this; consumers
// touching only one slice keep using useAuth() / useScope() directly.
export interface SentinelState {
  // Auth state pass-through (read-only view).
  user: ReturnType<typeof useAuth>["user"];
  role: ReturnType<typeof useAuth>["role"];
  authLoading: boolean;
  permissions: ReturnType<typeof useAuth>["permissions"];
  hasPermission: ReturnType<typeof useAuth>["hasPermission"];

  // Scope state pass-through.
  grants: ReturnType<typeof useScope>["grants"];
  activeNodeId: string | null;
  activeGrant: ReturnType<typeof useScope>["activeGrant"];
  scopeLoading: boolean;
  scopeError: string | null;

  // Derived: user.workspace_id normalised to null when empty.
  activeWorkspaceId: string | null;

  // Derived: true when there's no active grant OR the active grant's
  // workspace matches the JWT's workspace_id. false during the brief
  // desync window between a manual workspace switch and the
  // coordinated scope reload.
  workspaceInSync: boolean;
}

const Ctx = createContext<SentinelState | null>(null);

export function SentinelProvider({ children }: { children: ReactNode }) {
  // SentinelProvider intentionally renders no state itself — the
  // <SentinelBridge> below reads useAuth() + useScope() so it must be
  // mounted INSIDE both providers. Callers compose it like:
  //
  //   <AuthProvider>
  //     <ScopeProvider>      ← (user)/layout.tsx for the user shell
  //       <SentinelBridge>...</SentinelBridge>
  //     </ScopeProvider>
  //   </AuthProvider>
  //
  // Routes that don't mount ScopeProvider (login, /overlay/topology)
  // still work because useScope() returns its fallback shape when no
  // provider is present, and SentinelBridge surfaces that as
  // grants=[] + activeGrant=null + workspaceInSync=true.
  return <>{children}</>;
}

export function SentinelBridge({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const scope = useScope();

  const activeWorkspaceId = auth.user?.workspace_id || null;
  const workspaceInSync =
    !scope.activeGrant ||
    !activeWorkspaceId ||
    scope.activeGrant.workspace_id === activeWorkspaceId;

  const value: SentinelState = {
    user: auth.user,
    role: auth.role,
    authLoading: auth.loading,
    permissions: auth.permissions,
    hasPermission: auth.hasPermission,
    grants: scope.grants,
    activeNodeId: scope.activeNodeId,
    activeGrant: scope.activeGrant,
    scopeLoading: scope.loading,
    scopeError: scope.error,
    activeWorkspaceId,
    workspaceInSync,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSentinel(): SentinelState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useSentinel must be used inside <SentinelBridge>");
  }
  return v;
}
