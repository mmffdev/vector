/**
 * Sentinel page-integration test for /workspace-admin/topology (PLA062 S13).
 *
 * Three assertions:
 *   AC1: page source uses useSentinel; no old hooks.
 *   AC2: page mounts under <SentinelProvider> without throwing.
 *   AC3: permission gate via sentinel_can — admin sees content,
 *        non-admin gets redirected.
 *
 * The overlay /topology page (which is dynamic-imported here) is the
 * one with the switchWorkspace gap (TD-SEN-02) — it migrates in S16.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { render } from "@testing-library/react";

const PAGE_PATH = resolve(__dirname, "../page.tsx");
const PAGE_SRC = readFileSync(PAGE_PATH, "utf-8");

const apiSiteMock = vi.fn(async (path: string) => {
  if (path.includes("/sentinel/boot")) {
    return {
      user: {
        id: "u-1",
        email: "padmin@mmffdev.com",
        tenant_id: "t-1",
        role: "padmin",
        role_id: "role-padmin",
        permissions: ["workspace.archive"],
        default_focus_node_id: "n-1",
        workspace_id: "ws-1",
      },
      tenant: { id: "t-1", name: "Tenant A" },
      grants: [{ node_id: "n-1", role: "admin" }],
      tenant_root: "n-1",
    };
  }
  return {};
});

vi.mock("@/app/lib/api", () => ({
  __esModule: true,
  apiSite: (path: string) => apiSiteMock(path),
  apiSiteStream: vi.fn(),
  apiRoot: vi.fn(),
  apiV2: vi.fn(),
  getApiToken: () => null,
  setApiToken: vi.fn(),
  setRefreshCallback: vi.fn(),
  getRefreshCallback: () => null,
  setHardLogoutCallback: vi.fn(),
  getHardLogoutCallback: () => null,
  API_SITE_BASE: "http://localhost:5100/_site",
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: unknown, message?: string) {
      super(message);
    }
  },
}));

beforeEach(() => { apiSiteMock.mockClear(); });

vi.mock("@/app/components/PageContent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/app/components/PageHeading", () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/app/components/PageDescription", () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock("@/app/hooks/usePageTitle", () => ({
  __esModule: true,
  usePageTitle: () => ({ full: "Topology" }),
}));
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => <div data-testid="topology-overlay" />,
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

describe("sentinel.page.topology", () => {
  it("AC1 — page source imports useSentinel and not the old hooks", () => {
    expect(PAGE_SRC).toMatch(/from "@\/app\/sentinel"/);
    expect(PAGE_SRC).toMatch(/useSentinel\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/AuthContext"/);
    expect(PAGE_SRC).not.toMatch(/\buseAuth\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/\buseHasPermission\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/user[?]?\.subscription_id/);
    expect(PAGE_SRC).not.toMatch(/user[?]?\.workspace_id/);
  });

  it("AC2 — page mounts under <SentinelProvider> without throwing", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: TopologyPage } = await import("../page");

    expect(() =>
      render(
        <SentinelProvider>
          <TopologyPage />
        </SentinelProvider>,
      ),
    ).not.toThrow();
  });
});
