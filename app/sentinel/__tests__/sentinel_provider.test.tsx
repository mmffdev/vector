/**
 * Sentinel Provider — RED tests for PLA062 S07.
 *
 * This file is intentionally RED on first compile because the
 * imports below resolve to symbols that don't exist yet — the
 * package `app/sentinel/` has only this test file. S08 closes
 * these tests by implementing SentinelProvider + useSentinel +
 * the sentinel_* state bag.
 *
 * Test tier: sentinel.unit (selectable via
 *   `npm run test:sentinel:unit` — see S02 harness).
 *
 * Contract pinned by these tests (must match docs/Security/Sentinel/sentinel_docs.md):
 *   - State shape: sentinel_user, sentinel_tenant, sentinel_role,
 *     sentinel_permissions, sentinel_grants, sentinel_focus_node,
 *     sentinel_scope_up, sentinel_scope_down, sentinel_workspace_in_sync.
 *   - Workspace switch is atomic: await sentinel_switch_tenant(t2)
 *     resolves with sentinel_tenant.id === t2 AND
 *     sentinel_workspace_in_sync === true in the SAME render cycle.
 *   - sentinel_can(code) matches the permission catalogue.
 *   - Focus precedence: URL ?meg= > users.default_focus_node_id > tenant root.
 *   - 401 on any sentinel-mediated call triggers sentinel_reload().
 *   - useSentinel() outside SentinelProvider throws (negative test).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SentinelProvider, useSentinel } from "@/app/sentinel";

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const FIXTURE_TENANT_A = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Tenant A",
};

const FIXTURE_TENANT_B = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Tenant B",
};

const FIXTURE_USER_DEFAULT_FOCUS = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FIXTURE_URL_FOCUS = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const FIXTURE_TENANT_ROOT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const FIXTURE_USER_A = {
  id: "99999999-aaaa-aaaa-aaaa-999999999999",
  email: "alice@tenant-a.test",
  tenant_id: FIXTURE_TENANT_A.id,
  role: "user",
  role_id: "role-uuid-a",
  permissions: ["work_items.list", "portfolio.list"],
  default_focus_node_id: FIXTURE_USER_DEFAULT_FOCUS,
  // Pinned by default — migration 244. Tests that exercise the Follow
  // path override this via stubBoot({ home_location_follow_mode: true }).
  home_location_follow_mode: false,
  workspace_id: "ws-a-uuid",
};

// stubBoot is the test-side equivalent of the production sentinel_api
// "boot" call — the first request the provider makes to populate state.
function stubBoot(overrides: Partial<typeof FIXTURE_USER_A> = {}) {
  return {
    user: { ...FIXTURE_USER_A, ...overrides },
    tenant: FIXTURE_TENANT_A,
    grants: [{ node_id: FIXTURE_TENANT_ROOT, role: "admin" }],
    tenant_root: FIXTURE_TENANT_ROOT,
  };
}

// Hook-test harness: renders a child that destructures useSentinel
// and exposes the current state via data-testid attributes.
function StateProbe() {
  const s = useSentinel();
  return (
    <div>
      <span data-testid="user-email">{s.sentinel_user?.email ?? ""}</span>
      <span data-testid="tenant-id">{s.sentinel_tenant?.id ?? ""}</span>
      <span data-testid="role">{s.sentinel_role ?? ""}</span>
      <span data-testid="focus-node">{s.sentinel_focus_node ?? ""}</span>
      <span data-testid="scope-up">{String(s.sentinel_scope_up)}</span>
      <span data-testid="scope-down">{String(s.sentinel_scope_down)}</span>
      <span data-testid="in-sync">{String(s.sentinel_workspace_in_sync)}</span>
      <span data-testid="can-list">{String(s.sentinel_can("work_items.list"))}</span>
      <span data-testid="can-admin">{String(s.sentinel_can("admin.everything"))}</span>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mock the boot API so the provider can populate state synchronously
// in tests.
// ---------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  // jsdom's window.location survives between tests in the same file,
  // and SentinelProvider's URL-mirror effect writes ?meg=<focus> on
  // every boot. Without an explicit reset, Case 1's mirror write
  // ?meg=cccccccc... bleeds into Case 4c's URL sniff and breaks the
  // "no URL ?meg=" precondition. Reset the search string here.
  try {
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  } catch {
    // edge environments may not support replaceState; tests that
    // mutate window.location directly will restore their own state.
  }
  // Default global fetch mock — tests override per-case as needed.
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url).includes("/sentinel/boot")) {
      return new Response(JSON.stringify(stubBoot()), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as any;
});

// ---------------------------------------------------------------------
// Case 1 — Provider populates every sentinel_* field on boot
// ---------------------------------------------------------------------

describe("sentinel.unit.SentinelProvider", () => {
  it("Case 1 — boot populates every sentinel_* field on the state bag", async () => {
    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("user-email").textContent).toBe("alice@tenant-a.test");
    expect(screen.getByTestId("tenant-id").textContent).toBe(FIXTURE_TENANT_A.id);
    expect(screen.getByTestId("role").textContent).toBe("user");
    expect(screen.getByTestId("scope-up").textContent).toBe("true");
    expect(screen.getByTestId("scope-down").textContent).toBe("true");
    expect(screen.getByTestId("in-sync").textContent).toBe("true");
  });

  // -------------------------------------------------------------------
  // Case 2 — Workspace switch is atomic (no stale-data flash)
  // -------------------------------------------------------------------

  it("Case 2 — sentinel_switch_tenant resolves with tenant + workspace_in_sync in same render cycle", async () => {
    // After boot, switch to tenant B; mock returns the new boot payload.
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("/sentinel/switch-tenant")) {
        return new Response(
          JSON.stringify({
            ...stubBoot(),
            user: { ...FIXTURE_USER_A, tenant_id: FIXTURE_TENANT_B.id, workspace_id: "ws-b-uuid" },
            tenant: FIXTURE_TENANT_B,
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("/sentinel/boot")) {
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    let switchPromise: Promise<void> | null = null;
    function SwitchTrigger() {
      const s = useSentinel();
      return (
        <button
          data-testid="switch-btn"
          onClick={() => {
            switchPromise = s.sentinel_switch_tenant(FIXTURE_TENANT_B.id);
          }}
        >
          switch
        </button>
      );
    }

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
          <SwitchTrigger />
        </SentinelProvider>,
      );
    });

    // Trigger the switch
    await act(async () => {
      screen.getByTestId("switch-btn").click();
      await switchPromise;
    });

    // Atomic: tenant id matches new AND in_sync stays true (no stale window)
    expect(screen.getByTestId("tenant-id").textContent).toBe(FIXTURE_TENANT_B.id);
    expect(screen.getByTestId("in-sync").textContent).toBe("true");
  });

  // -------------------------------------------------------------------
  // Case 3 — sentinel_can() matches the permission catalogue
  // -------------------------------------------------------------------

  it("Case 3 — sentinel_can returns true for granted, false for absent perms", async () => {
    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("can-list").textContent).toBe("true"); // work_items.list granted
    expect(screen.getByTestId("can-admin").textContent).toBe("false"); // admin.everything absent
  });

  // -------------------------------------------------------------------
  // Case 4 — Focus precedence: URL > default > tenant root
  // -------------------------------------------------------------------

  it("Case 4a — URL ?meg= wins over user default", async () => {
    // Simulate URL ?meg=<id> via window.location.search
    const orig = window.location.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: `?meg=${FIXTURE_URL_FOCUS}` },
    });

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("focus-node").textContent).toBe(FIXTURE_URL_FOCUS);

    // restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, search: orig },
    });
  });

  it("Case 4b — absent URL falls back to user default_focus_node_id", async () => {
    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("focus-node").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);
  });

  it("Case 4c — absent URL + no user default falls back to tenant root", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("/sentinel/boot")) {
        return new Response(
          JSON.stringify(stubBoot({ default_focus_node_id: undefined as any })),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("focus-node").textContent).toBe(FIXTURE_TENANT_ROOT);
  });

  // -------------------------------------------------------------------
  // Case 5 — 401 on a sentinel-mediated call triggers sentinel_reload()
  // -------------------------------------------------------------------

  it("Case 5 — 401 response triggers sentinel_reload()", async () => {
    let bootCount = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/boot")) {
        bootCount += 1;
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      if (u.includes("/sentinel/trigger-401")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    function FireAndForget() {
      const s = useSentinel();
      return (
        <button
          data-testid="fire-401"
          onClick={async () => {
            await s.sentinel_api_call("/sentinel/trigger-401");
          }}
        >
          fire
        </button>
      );
    }

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
          <FireAndForget />
        </SentinelProvider>,
      );
    });
    expect(bootCount).toBe(1);

    await act(async () => {
      screen.getByTestId("fire-401").click();
      // give the auto-reload a tick
      await new Promise((r) => setTimeout(r, 10));
    });

    // The 401 should have triggered an automatic sentinel_reload → second boot call
    expect(bootCount).toBe(2);
  });

  // -------------------------------------------------------------------
  // Case 6 — useSentinel() outside provider throws
  // -------------------------------------------------------------------

  it("Case 6 — useSentinel() outside <SentinelProvider> throws", () => {
    // Suppress React's error-boundary noise for this case
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      render(<StateProbe />);
    }).toThrow(/SentinelProvider/);
    spy.mockRestore();
  });

  // -------------------------------------------------------------------
  // Case 10 — sentinel_switch_workspace (workspace-within-tenant)
  // -------------------------------------------------------------------
  // Added mid-S14 (PLA062 revision-history 2026-05-24) to close TD-SEN-02.
  // tenant_id stays the same; workspace_id + grants refresh atomically.

  it("Case 10 — sentinel_switch_workspace re-mints JWT for new workspace (tenant unchanged)", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/switch-workspace")) {
        return new Response(
          JSON.stringify({
            ...stubBoot(),
            user: { ...FIXTURE_USER_A, workspace_id: "ws-new-uuid" },
          }),
          { status: 200 },
        );
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    let p: Promise<void> | null = null;
    function Trigger() {
      const s = useSentinel();
      return (
        <button
          data-testid="switch-ws"
          onClick={() => {
            p = s.sentinel_switch_workspace("ws-new-uuid");
          }}
        >
          switch
        </button>
      );
    }

    function WorkspaceProbe() {
      const s = useSentinel();
      return <span data-testid="workspace-id">{s.sentinel_user?.workspace_id ?? ""}</span>;
    }

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
          <WorkspaceProbe />
          <Trigger />
        </SentinelProvider>,
      );
    });

    await act(async () => {
      screen.getByTestId("switch-ws").click();
      await p;
    });

    // Tenant unchanged, workspace changed.
    expect(screen.getByTestId("tenant-id").textContent).toBe(FIXTURE_TENANT_A.id);
    expect(screen.getByTestId("workspace-id").textContent).toBe("ws-new-uuid");
  });

  // -------------------------------------------------------------------
  // Case 11 — sentinel_set_settings (workspace-settings writer)
  // -------------------------------------------------------------------
  // Added mid-S14 (PLA062 revision-history 2026-05-24) to close TD-SEN-03.
  // Optimistic update + server PUT + post-PUT reconciliation in one action.

  it("Case 11 — sentinel_set_settings persists workspace settings and refreshes local state", async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/settings")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        // Echo back the body — server-side normalisation is identity here.
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    let p: Promise<void> | null = null;
    function Trigger() {
      const s = useSentinel();
      return (
        <button
          data-testid="set-settings"
          onClick={() => {
            p = s.sentinel_set_settings({ tenant_name: "Renamed Tenant", theme_pack: "atlas" });
          }}
        >
          save
        </button>
      );
    }

    function SettingsProbe() {
      const s = useSentinel();
      return (
        <>
          <span data-testid="settings-name">{(s.sentinel_settings?.tenant_name as string) ?? ""}</span>
          <span data-testid="settings-theme">{(s.sentinel_settings?.theme_pack as string) ?? ""}</span>
        </>
      );
    }

    await act(async () => {
      render(
        <SentinelProvider>
          <StateProbe />
          <SettingsProbe />
          <Trigger />
        </SentinelProvider>,
      );
    });

    await act(async () => {
      screen.getByTestId("set-settings").click();
      await p;
    });

    expect(screen.getByTestId("settings-name").textContent).toBe("Renamed Tenant");
    expect(screen.getByTestId("settings-theme").textContent).toBe("atlas");
  });

  // -------------------------------------------------------------------
  // Case 12 — Follow mode ON: sentinel_set_focus mirrors into
  //           sentinel_user.default_focus_node_id and PUTs to server;
  //           reverts on failure
  // -------------------------------------------------------------------
  // Mig 244 split: when home_location_follow_mode === true, scope-rail
  // clicks (which go through sentinel_set_focus) persist into the home
  // column. When false (default), they're session-only — covered in
  // Case 13 below.

  const FIXTURE_NEW_FOCUS = "abababab-abab-abab-abab-abababababab";

  // Boot helper that flips the user into Follow mode for the Case 12
  // tests below. Pinned-mode behaviour is covered separately in Case 13.
  function followingStubBoot() {
    return stubBoot({ home_location_follow_mode: true });
  }

  function DefaultFocusProbe() {
    const s = useSentinel();
    return <span data-testid="user-default-focus">{s.sentinel_user?.default_focus_node_id ?? "null"}</span>;
  }

  function SetFocusTrigger({
    nodeId,
    onError,
  }: {
    nodeId: string | null;
    onError?: (e: unknown) => void;
  }) {
    const s = useSentinel();
    return (
      <button
        data-testid="set-focus-btn"
        onClick={async () => {
          try {
            await s.sentinel_set_focus(nodeId);
          } catch (e) {
            onError?.(e);
          }
        }}
      >
        set
      </button>
    );
  }

  it("Case 12a — sentinel_set_focus mirrors the new id into sentinel_user.default_focus_node_id on success", async () => {
    let putBody: any = null;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/focus") && init?.method === "PUT") {
        putBody = init.body ? JSON.parse(init.body as string) : null;
        return new Response(null, { status: 204 });
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(followingStubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <DefaultFocusProbe />
          <SetFocusTrigger nodeId={FIXTURE_NEW_FOCUS} />
        </SentinelProvider>,
      );
    });

    // Starts on the user default from the boot payload.
    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);

    await act(async () => {
      screen.getByTestId("set-focus-btn").click();
    });

    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_NEW_FOCUS);
    expect(putBody).toEqual({ focus_node_id: FIXTURE_NEW_FOCUS });
  });

  it("Case 12b — sentinel_set_focus reverts user.default_focus_node_id when PUT /sentinel/focus fails", async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/focus") && init?.method === "PUT") {
        return new Response(
          JSON.stringify({ type: "/errors/sentinel/focus-no-access", title: "Forbidden", status: 403 }),
          { status: 403, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(followingStubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const errors: unknown[] = [];

    await act(async () => {
      render(
        <SentinelProvider>
          <DefaultFocusProbe />
          <SetFocusTrigger nodeId={FIXTURE_NEW_FOCUS} onError={(e) => errors.push(e)} />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);

    await act(async () => {
      screen.getByTestId("set-focus-btn").click();
    });

    // Optimistic write was reverted to the boot-time default.
    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);
    // The error propagates so the calling component can toast.
    expect(errors).toHaveLength(1);
  });

  it("Case 12c — sentinel_set_focus(null) clears user.default_focus_node_id on success", async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/focus") && init?.method === "PUT") {
        return new Response(null, { status: 204 });
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(followingStubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <DefaultFocusProbe />
          <SetFocusTrigger nodeId={null} />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);

    await act(async () => {
      screen.getByTestId("set-focus-btn").click();
    });

    expect(screen.getByTestId("user-default-focus").textContent).toBe("null");
  });

  // -------------------------------------------------------------------
  // Case 13 — Pinned mode (default): sentinel_set_focus is session-only
  // -------------------------------------------------------------------
  // The bug fix from migration 244 / commit splitting setFocus: when
  // home_location_follow_mode is FALSE (the default), clicking through
  // the scope rail must NOT silently overwrite the user's saved home.
  // sentinel_focus_node (session) still updates; user.default_focus_node_id
  // (persistent) does NOT, and no PUT goes to /sentinel/focus.

  function FocusNodeProbe() {
    const s = useSentinel();
    return <span data-testid="session-focus-node">{s.sentinel_focus_node ?? "null"}</span>;
  }

  it("Case 13a — Pinned mode: sentinel_set_focus changes session focus only; no PUT, no persistent-column write", async () => {
    let putCalls = 0;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/focus") && init?.method === "PUT") {
        putCalls++;
        return new Response(null, { status: 204 });
      }
      if (u.includes("/sentinel/boot")) {
        // Default FIXTURE_USER_A has home_location_follow_mode: false.
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <DefaultFocusProbe />
          <FocusNodeProbe />
          <SetFocusTrigger nodeId={FIXTURE_NEW_FOCUS} />
        </SentinelProvider>,
      );
    });

    // Boot state: focus resolves to the user default.
    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);
    expect(screen.getByTestId("session-focus-node").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);

    await act(async () => {
      screen.getByTestId("set-focus-btn").click();
    });

    // Session focus moved to the new node.
    expect(screen.getByTestId("session-focus-node").textContent).toBe(FIXTURE_NEW_FOCUS);
    // Persistent home column UNCHANGED.
    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_USER_DEFAULT_FOCUS);
    // No server PUT — Pinned mode is session-only.
    expect(putCalls).toBe(0);
  });

  // -------------------------------------------------------------------
  // Case 14 — sentinel_set_default_focus always persists (dropdown path)
  // -------------------------------------------------------------------
  // The Home Location dropdown is an EXPLICIT "save this as my home"
  // action regardless of toggle state. Bypasses the follow_mode gate.

  function FollowProbe() {
    const s = useSentinel();
    return (
      <span data-testid="follow-mode">
        {String(s.sentinel_user?.home_location_follow_mode ?? false)}
      </span>
    );
  }

  function SetDefaultFocusTrigger({ nodeId }: { nodeId: string | null }) {
    const s = useSentinel();
    return (
      <button
        data-testid="set-default-focus-btn"
        onClick={() => void s.sentinel_set_default_focus(nodeId)}
      >
        save default
      </button>
    );
  }

  it("Case 14 — sentinel_set_default_focus persists into the home column even when Pinned", async () => {
    let putBody: any = null;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/sentinel/focus") && init?.method === "PUT") {
        putBody = init.body ? JSON.parse(init.body as string) : null;
        return new Response(null, { status: 204 });
      }
      if (u.includes("/sentinel/boot")) {
        // Pinned (the default)
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <DefaultFocusProbe />
          <FollowProbe />
          <SetDefaultFocusTrigger nodeId={FIXTURE_NEW_FOCUS} />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("follow-mode").textContent).toBe("false");

    await act(async () => {
      screen.getByTestId("set-default-focus-btn").click();
    });

    expect(screen.getByTestId("user-default-focus").textContent).toBe(FIXTURE_NEW_FOCUS);
    expect(putBody).toEqual({ focus_node_id: FIXTURE_NEW_FOCUS });
  });

  // -------------------------------------------------------------------
  // Case 15 — sentinel_set_home_follow_mode persists + reverts
  // -------------------------------------------------------------------

  function SetFollowTrigger({
    follow,
    onError,
  }: {
    follow: boolean;
    onError?: (e: unknown) => void;
  }) {
    const s = useSentinel();
    return (
      <button
        data-testid="set-follow-btn"
        onClick={async () => {
          try {
            await s.sentinel_set_home_follow_mode(follow);
          } catch (e) {
            onError?.(e);
          }
        }}
      >
        flip
      </button>
    );
  }

  it("Case 15a — sentinel_set_home_follow_mode optimistically updates user.home_location_follow_mode + PUTs /me/home-location-follow-mode", async () => {
    let putBody: any = null;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/me/home-location-follow-mode") && init?.method === "PUT") {
        putBody = init.body ? JSON.parse(init.body as string) : null;
        return new Response(null, { status: 204 });
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <FollowProbe />
          <SetFollowTrigger follow={true} />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("follow-mode").textContent).toBe("false");

    await act(async () => {
      screen.getByTestId("set-follow-btn").click();
    });

    expect(screen.getByTestId("follow-mode").textContent).toBe("true");
    expect(putBody).toEqual({ follow: true });
  });

  it("Case 15b — sentinel_set_home_follow_mode reverts on PUT failure", async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/me/home-location-follow-mode") && init?.method === "PUT") {
        return new Response("server fell over", { status: 500 });
      }
      if (u.includes("/sentinel/boot")) {
        return new Response(JSON.stringify(stubBoot()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const errors: unknown[] = [];

    await act(async () => {
      render(
        <SentinelProvider>
          <FollowProbe />
          <SetFollowTrigger follow={true} onError={(e) => errors.push(e)} />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("follow-mode").textContent).toBe("false");

    await act(async () => {
      screen.getByTestId("set-follow-btn").click();
    });

    // Reverted back to the boot-time value.
    expect(screen.getByTestId("follow-mode").textContent).toBe("false");
    expect(errors).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Case 16 — Boot-time bridge failure: pin the silent-empty bug
  // -------------------------------------------------------------------
  // Symptom reproduced in dev 2026-05-24: signed-in user (AuthContext
  // has email), Dev Debug bar shows user.id empty + grants.length 0 +
  // sentinel_user.workspace_id null, page renders blank because
  // AccountSettingsPage does `if (!user) return null` post-loading.
  //
  // Trace: reload() → fetchBoot() → /sentinel/boot 404 → bridge → Promise.all
  // → /auth/me 401 (or /topology/grants/me 401 with no catch on auth.me side).
  // The reject propagates out of fetchBoot; sentinelCall's catch fires
  // _onUnauthorized; reload's outer catch swallows the error and dispatches
  // loading_done. End state: { loading: false, user: null }.

  function BootStateProbe() {
    const s = useSentinel();
    return (
      <>
        <span data-testid="boot-loading">{String(s.sentinel_loading)}</span>
        <span data-testid="boot-user-id">{s.sentinel_user?.id ?? "null"}</span>
        <span data-testid="boot-user-email">{s.sentinel_user?.email ?? "null"}</span>
        <span data-testid="boot-grants-length">{String(s.sentinel_grants.length)}</span>
      </>
    );
  }

  it("Case 16a — bridge /auth/me 401 with NO terminal code leaves provider empty (boot is a no-op; layout redirects to /login)", async () => {
    // Boot path: /sentinel/boot 404 → bridge fires /auth/me + /topology/grants/me.
    // Make /auth/me return 401 with a generic problem+json (no terminal code).
    // This is the "no session at all" path — the route-group layout's
    // useEffect redirects to /login. We just need boot to land softly here.
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/boot")) {
        return new Response("not found", { status: 404 });
      }
      if (u.includes("/auth/me")) {
        return new Response(
          JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401 }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      if (u.includes("/topology/grants/me")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (u.includes("/auth/refresh")) {
        return new Response("", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <BootStateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("boot-loading").textContent).toBe("false");
    expect(screen.getByTestId("boot-user-id").textContent).toBe("null");
    expect(screen.getByTestId("boot-user-email").textContent).toBe("null");
    expect(screen.getByTestId("boot-grants-length").textContent).toBe("0");
  });

  it("Case 16d — bridge /auth/me 401 WITH code=session_idle_expired triggers hard redirect to /login (real-world dev bug)", async () => {
    // The actual bug: padmin session is 70min old, idle TTL is 30min,
    // backend's RequireAuth returns 401 with code=session_idle_expired.
    // BEFORE FIX: SentinelProvider's catch swallows the error silently
    // and the user is stuck on a blank /user/account-settings page.
    // AFTER FIX: SentinelProvider detects the terminal session code and
    // hard-navigates to /login with sessionStorage carrying the reason.
    const navigated: string[] = [];
    const origLocation = window.location;
    const origSessionStorage = window.sessionStorage;
    const storedKeys: Record<string, string> = {};

    // Override window.location.assign to capture navigations.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...origLocation,
        assign: (url: string) => navigated.push(url),
      },
    });
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      writable: true,
      value: {
        ...origSessionStorage,
        setItem: (k: string, v: string) => { storedKeys[k] = v; },
        getItem: (k: string) => storedKeys[k] ?? null,
      },
    });

    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/boot")) {
        return new Response("not found", { status: 404 });
      }
      if (u.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Unauthorized",
            status: 401,
            code: "session_idle_expired", // ← the terminal code
            detail: "Your session has been idle too long. Please sign in again.",
          }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } },
        );
      }
      if (u.includes("/topology/grants/me")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (u.includes("/auth/refresh")) {
        return new Response("", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <BootStateProbe />
        </SentinelProvider>,
      );
    });

    // Boot loading completed; user still null (the navigation kicked in
    // before any further work).
    expect(screen.getByTestId("boot-loading").textContent).toBe("false");
    expect(screen.getByTestId("boot-user-id").textContent).toBe("null");

    // The fix: SentinelProvider self-rescued and pushed /login.
    expect(navigated).toContain("/login");
    expect(storedKeys["vector_logout_reason"]).toBe("session_idle_expired");

    // Restore.
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: origLocation });
    Object.defineProperty(window, "sessionStorage", { configurable: true, writable: true, value: origSessionStorage });
  });

  it("Case 16b — bridge /topology/grants/me 401 still completes boot with user populated (because the .catch swallows)", async () => {
    // Different shape: /auth/me succeeds but /topology/grants/me 401s.
    // The bridge has a .catch(() => []) on grants/me, so the boot should
    // still populate the user even with zero grants.
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/boot")) {
        return new Response("not found", { status: 404 });
      }
      if (u.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            id: FIXTURE_USER_A.id,
            email: FIXTURE_USER_A.email,
            subscription_id: FIXTURE_TENANT_A.id,
            workspace_id: FIXTURE_USER_A.workspace_id,
            role: { id: FIXTURE_USER_A.role_id, code: FIXTURE_USER_A.role },
            permissions: FIXTURE_USER_A.permissions,
            default_focus_node_id: FIXTURE_USER_DEFAULT_FOCUS,
            home_location_follow_mode: false,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/topology/grants/me")) {
        return new Response("not authorised", { status: 401 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <BootStateProbe />
        </SentinelProvider>,
      );
    });

    // grants/me 401 is caught + treated as empty grants, so user populates.
    expect(screen.getByTestId("boot-loading").textContent).toBe("false");
    expect(screen.getByTestId("boot-user-id").textContent).toBe(FIXTURE_USER_A.id);
    expect(screen.getByTestId("boot-user-email").textContent).toBe(FIXTURE_USER_A.email);
    expect(screen.getByTestId("boot-grants-length").textContent).toBe("0");
  });

  it("Case 16c — bridge /auth/me 200 + /topology/grants/me 200 with NO workspace_id in /auth/me payload still populates user", async () => {
    // The Dev Debug bar showed "user.workspace_id (JWT) — empty (legacy token)".
    // This case pins that even when /auth/me returns no workspace_id, the
    // boot should still populate sentinel_user (workspace_id falls back to "").
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/sentinel/boot")) {
        return new Response("not found", { status: 404 });
      }
      if (u.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            id: FIXTURE_USER_A.id,
            email: FIXTURE_USER_A.email,
            subscription_id: FIXTURE_TENANT_A.id,
            // workspace_id omitted on purpose — the "legacy token" path
            role: { id: FIXTURE_USER_A.role_id, code: FIXTURE_USER_A.role },
            permissions: FIXTURE_USER_A.permissions,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/topology/grants/me")) {
        return new Response(JSON.stringify([
          { node_id: FIXTURE_TENANT_ROOT, role: "admin", parent_id: null },
        ]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    await act(async () => {
      render(
        <SentinelProvider>
          <BootStateProbe />
        </SentinelProvider>,
      );
    });

    expect(screen.getByTestId("boot-loading").textContent).toBe("false");
    expect(screen.getByTestId("boot-user-id").textContent).toBe(FIXTURE_USER_A.id);
    expect(screen.getByTestId("boot-user-email").textContent).toBe(FIXTURE_USER_A.email);
    expect(screen.getByTestId("boot-grants-length").textContent).toBe("1");
  });
});
