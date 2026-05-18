# Sentinel.tsx — Convergence Plan

**Confidence: 82%**  
**Status: PLANNED — not yet implemented**  
**Trigger:** JWT workspace_id ≠ scope workspace_id mismatch causing portfolio model "no bundle" + other workspace-scoped 404s. Discovery method: DebugPanel (Vector logo → sticky debug bar).

---

## Problem

The frontend carries workspace/scope/permissions state across four separate contexts with no coordination layer:

| Context | Owns | Gap |
|---|---|---|
| `AuthContext` | user, JWT workspace_id, permissions, switchWorkspace | `switchWorkspace` does not trigger scope reload |
| `ScopeContext` | topology grants, activeNodeId, activeGrant | Reloads on user identity change only — can be stale post-switch |
| `ArtefactTypeCatalogueContext` | per-workspace artefact types | Invalidates on `useActiveWorkspace()` change — correct but disconnected |
| `ArtefactPriorityCatalogueContext` | per-workspace priorities | Same as above |

Root cause of mismatch: `switchWorkspace` in AuthContext re-mints the JWT (new `workspace_id` claim) but does not immediately reload ScopeContext grants. Until the next `user` identity change propagates through the effect chain, `activeGrant.workspace_id` can differ from `user.workspace_id`.

---

## Solution: `app/contexts/Sentinel.tsx`

A thin coordination layer. Does **not** rewrite any existing provider — wraps them and coordinates. All existing hooks become one-liner shims (zero consumer changes).

### Architecture

```
<SentinelProvider>             ← app/layout.tsx
  <AuthProvider>               ← internal to Sentinel.tsx
    <ScopeProvider>            ← stays in (user)/layout.tsx; ref-injection for reload
      <ArtefactTypeCatalogueProvider>
        <ArtefactPriorityCatalogueProvider>
          <SentinelBridge>     ← reads all four hooks, writes SentinelCtx
            {children}
          </SentinelBridge>
        </ArtefactPriorityCatalogueProvider>
      </ArtefactTypeCatalogueProvider>
    </ScopeProvider>
  </AuthProvider>
</SentinelProvider>
```

`SentinelBridge` is a private component inside `Sentinel.tsx`. It calls `useAuth()`, `useScope()`, `useArtefactTypeCatalogue()`, `useArtefactPriorityCatalogue()` and assembles `SentinelState`.

---

## SentinelState interface

```ts
export interface SentinelState {
  // ── Auth ──────────────────────────────────────────────────────────
  user:             AuthUser | null;
  role:             Role | null;
  authLoading:      boolean;
  permissions:      Set<string>;
  hasPermission:    (code: string) => boolean;
  login:            (email: string, password: string) => Promise<AuthUser>;
  logout:           () => Promise<void>;
  refresh:          () => Promise<void>;
  switchWorkspace:  (workspaceID: string) => Promise<AuthUser>; // COORDINATED
  setUser:          (u: AuthUser) => void;

  // ── Derived workspace ─────────────────────────────────────────────
  activeWorkspaceId: string | null; // user.workspace_id normalised to null if ""

  // ── Scope ─────────────────────────────────────────────────────────
  grants:           MyGrant[];
  activeNodeId:     string | null;
  activeGrant:      MyGrant | null;
  scopeLoading:     boolean;
  scopeError:       string | null;
  setActiveNodeId:  (id: string | null) => void;
  reloadScope:      () => Promise<void>;

  // ── Artefact type catalogue ────────────────────────────────────────
  catalogueTypes:   ArtefactType[];
  catLoading:       boolean;
  catError:         string | null;

  // ── Artefact priority catalogue ────────────────────────────────────
  priorities:       ArtefactPriority[];
  priorityLoading:  boolean;
  priorityError:    string | null;

  // ── Derived status ─────────────────────────────────────────────────
  // true: !authLoading && user && activeWorkspaceId && !scopeLoading && !catLoading && !priorityLoading
  ready: boolean;

  // true: activeGrant === null OR activeGrant.workspace_id === activeWorkspaceId
  // false: JWT workspace differs from scope workspace (brief desync window)
  workspaceInSync: boolean;
}
```

---

## Coordinated switchWorkspace

```ts
async function switchWorkspace(workspaceID: string): Promise<AuthUser> {
  const newUser = await authSwitchWorkspace(workspaceID); // re-mints JWT
  await scopeReload();                                     // immediate grant refresh
  // Catalogue invalidates automatically: useActiveWorkspace() derived from
  // user.workspace_id changes; ArtefactType/Priority providers' useEffects fire.
  return newUser;
}
```

The `scopeReload` reference is injected via a module-level ref that `ScopeProvider` registers into on mount, and `SentinelBridge` writes. This avoids moving `ScopeProvider` to root layout.

---

## Files to change

| File | Change | Consumer impact |
|---|---|---|
| `app/contexts/Sentinel.tsx` | **CREATE** — provider, bridge, `useSentinel()`, coordinated `switchWorkspace` | New export |
| `app/contexts/AuthContext.tsx` | Convert to shim — all exports re-exported from Sentinel | Zero — same signatures |
| `app/contexts/ScopeContext.tsx` | Convert provider to shim — `useScope()` delegates to `useSentinel()` | Zero |
| `app/contexts/ArtefactTypeCatalogueContext.tsx` | Convert to shim — retain `ArtefactTypeCatalogueProvider` export for test compat | Zero |
| `app/contexts/ArtefactPriorityCatalogueContext.tsx` | Same shim pattern | Zero |
| `app/hooks/useActiveWorkspace.ts` | `return useSentinel().activeWorkspaceId` | Zero |
| `app/layout.tsx` | Wrap with `<SentinelProvider>` replacing `<AuthProvider>` | No child changes |
| `app/(user)/layout.tsx` | No change — `ScopeProvider` stays here; ref-injection handles coordination | No child changes |

**No changes to any consumer file.** 48+ `useAuth` sites, 7 `useScope` sites, 11 `useActiveWorkspace` sites, 8 catalogue sites — all compile unchanged.

---

## Risks

### Risk 1: ScopeProvider cross-route coordination (medium)
`(overlay)/topology/page.tsx` is outside `(user)/layout.tsx` so `ScopeProvider` is not mounted there. The coordinated `switchWorkspace` must degrade gracefully (no-op reload) when `ScopeProvider` is unmounted. Implement: ref-injected reload defaults to `async () => {}` when unregistered.

### Risk 2: profileSeededRef on workspace switch (medium)
`ScopeContext.profileSeededRef` resets when `user` identity changes. On `switchWorkspace`, `user` identity *does* change (via `applyLogin` → `setUser`), so the profile seed re-runs. Verify this still runs correctly when scope reload is triggered *before* the user identity effect fires. If not: explicitly reset `profileSeededRef.current = false` inside the coordinated `switchWorkspace` before calling `scopeReload`.

### Risk 3: Feature test provider import paths (low)
`f5_catalogue_chip_localstorage.test.tsx` and `f9_priority_chip_customisation.test.tsx` import `ArtefactTypeCatalogueProvider` / `ArtefactPriorityCatalogueProvider` by module path. Keep these as named re-exports in the shim files. File TD entry to remove when tests are updated.

---

## Pre-implementation checklist

- [ ] Verify `useScope().reload` is stable (same reference across renders) — it is (`useCallback`)
- [ ] Verify `profileSeededRef` reset path on workspace switch
- [ ] Confirm `(overlay)/topology/page.tsx` does not call `useScope()` directly — it does not
- [ ] Write `f-sentinel` feature test asserting scope reload fires after `switchWorkspace`

---

## What this does NOT do

- Does not absorb `ShellContext` — that is UI nav state, not identity/scope state
- Does not change any API call signatures
- Does not modify any backend code
- Does not change URL routing or JWT claim structure
