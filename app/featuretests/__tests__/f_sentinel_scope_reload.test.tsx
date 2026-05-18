// F-SENTINEL — Coordinated workspace switch ⇄ scope reload.
//
// B16.8 P3. Covers the convergence contract documented in
// docs/c_sentinel_plan.md: switchWorkspace must trigger an immediate
// scope reload BEFORE its promise resolves, so consumers never see
// activeGrant.workspace_id != user.workspace_id after the call returns.
//
// The discovery trigger was portfolio-model "no bundle" 404s observed
// post-switchWorkspace via the DebugPanel — JWT had the new workspace_id
// but ScopeContext.activeGrant still pointed at the old one until the
// useEffect fired on the next React tick.
//
// Three pinned behaviours:
//   1. registerScopeReload(fn) makes triggerScopeReload() invoke fn.
//   2. unregisterScopeReload() restores the no-op default — so a
//      stale closure from an unmounted ScopeProvider can't run.
//   3. The default (nothing registered) is a no-op — switchWorkspace
//      still works on routes where ScopeProvider isn't mounted
//      (login pages, /(overlay)/topology).

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerScopeReload,
  unregisterScopeReload,
  triggerScopeReload,
} from "@/app/contexts/Sentinel";

describe("F-SENTINEL — scope reload coordination", () => {
  beforeEach(() => {
    unregisterScopeReload();
  });

  it("default state is a no-op (safe on routes without ScopeProvider)", async () => {
    // Should resolve without throwing even when nothing has registered.
    await expect(triggerScopeReload()).resolves.toBeUndefined();
  });

  it("registerScopeReload makes triggerScopeReload invoke the registered fn", async () => {
    const spy = vi.fn(async () => {});
    registerScopeReload(spy);

    await triggerScopeReload();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-registering replaces the previous fn (latest closure wins)", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    registerScopeReload(first);
    registerScopeReload(second);
    await triggerScopeReload();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unregisterScopeReload restores the no-op (stale closure can't run)", async () => {
    const spy = vi.fn(async () => {});
    registerScopeReload(spy);
    unregisterScopeReload();

    await triggerScopeReload();
    expect(spy).not.toHaveBeenCalled();
  });

  it("triggerScopeReload awaits the registered fn (caller can't proceed until reload completes)", async () => {
    let resolved = false;
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    registerScopeReload(slow);

    await triggerScopeReload();
    expect(resolved).toBe(true);
  });

  it("registered fn errors propagate (caller decides how to handle)", async () => {
    const boom = vi.fn(async () => {
      throw new Error("scope reload failed");
    });
    registerScopeReload(boom);

    await expect(triggerScopeReload()).rejects.toThrow("scope reload failed");
  });
});
