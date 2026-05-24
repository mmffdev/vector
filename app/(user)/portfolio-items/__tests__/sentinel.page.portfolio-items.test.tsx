/**
 * Sentinel page-integration test for /portfolio-items (PLA062 S11).
 *
 * Mirrors the S10 shape — see app/(user)/work-items/__tests__/sentinel.page.work-items.test.tsx
 * for the documented test pattern.
 *
 * Three assertions:
 *   AC1: page source imports useSentinel; no old hooks; no direct
 *        user.subscription_id / workspace_id reads.
 *   AC2: page mounts under <SentinelProvider> without throwing.
 *   AC3: page reaches its first apiSite call (sentinel hydration smoke).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { render, waitFor } from "@testing-library/react";

const PAGE_PATH = resolve(__dirname, "../page.tsx");
const PAGE_SRC = readFileSync(PAGE_PATH, "utf-8");

const FIXTURE_TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FIXTURE_USER_ID = "99999999-aaaa-aaaa-aaaa-999999999999";
const FIXTURE_FOCUS = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const apiSiteMock = vi.fn(async (path: string) => {
  if (path.includes("/sentinel/boot")) {
    return {
      user: {
        id: FIXTURE_USER_ID,
        email: "alice@tenant-a.test",
        tenant_id: FIXTURE_TENANT_ID,
        role: "user",
        role_id: "role-uuid-a",
        permissions: ["portfolio.list"],
        default_focus_node_id: FIXTURE_FOCUS,
        workspace_id: "ws-a-uuid",
      },
      tenant: { id: FIXTURE_TENANT_ID, name: "Tenant A" },
      grants: [{ node_id: FIXTURE_FOCUS, role: "admin" }],
      tenant_root: FIXTURE_FOCUS,
    };
  }
  return { total: 0, blocked: 0, by_type: {} };
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

beforeEach(() => {
  apiSiteMock.mockClear();
});

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
vi.mock("@/app/components/PageSummaryHeader", () => ({
  __esModule: true,
  default: () => <div data-testid="summary-header" />,
}));
vi.mock("@/app/components/Panel", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock("@/app/components/VisualisationPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="viz-panel" />,
}));
vi.mock("@/app/components/ObjectTreeV2/p_ObjectTree", () => ({
  __esModule: true,
  default: () => <div data-testid="object-tree" />,
}));
vi.mock("@/app/hooks/useHintOnce", () => ({
  __esModule: true,
  useHintOnce: () => {},
}));
vi.mock("@/app/lib/hints", () => ({
  __esModule: true,
  useHintOnce: () => {},
}));
vi.mock("@/app/hooks/usePageTitle", () => ({
  __esModule: true,
  usePageTitle: () => ({ full: "Portfolio Items" }),
}));
vi.mock("@/app/lib/wizardLoader", () => ({
  __esModule: true,
  resolveWizardConfig: () => ({}),
  buildWorkItemsFunctions: () => ({}),
}));
vi.mock("@/app/contexts/ArtefactTypeCatalogueContext", () => ({
  __esModule: true,
  useArtefactTypeCatalogue: () => ({ types: [] }),
}));
vi.mock("@/app/contexts/DomRegistryContext", () => ({
  __esModule: true,
  useDomRegistry: () => ({ register: () => () => {} }),
}));
vi.mock("@/app/hooks/useRefetchOnPush", () => ({
  __esModule: true,
  useRefetchOnPush: () => {},
}));
vi.mock("@/app/hooks/useRealtimeSubscription", () => ({
  __esModule: true,
  rankTopic: () => "",
}));

describe("sentinel.page.portfolio-items", () => {
  it("AC1 — page source imports useSentinel and not the old hooks", () => {
    expect(PAGE_SRC).toMatch(/from "@\/app\/sentinel"/);
    expect(PAGE_SRC).toMatch(/useSentinel\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/AuthContext"/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/ScopeContext"/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/TenantContext"/);
    expect(PAGE_SRC).not.toMatch(/\buseAuth\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/\buseScope\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/\buseTenant\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/(?<!sentinel_)user[?]?\.subscription_id/);
    expect(PAGE_SRC).not.toMatch(/(?<!sentinel_)user[?]?\.workspace_id/);
  });

  it("AC2 — page mounts under <SentinelProvider> without throwing", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: PortfolioItemsPage } = await import("../page");

    expect(() =>
      render(
        <SentinelProvider>
          <PortfolioItemsPage />
        </SentinelProvider>,
      ),
    ).not.toThrow();
  });

  it("AC3 — page reads tenant + focus from Sentinel (smoke)", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: PortfolioItemsPage } = await import("../page");

    render(
      <SentinelProvider>
        <PortfolioItemsPage />
      </SentinelProvider>,
    );

    await waitFor(() => {
      expect(apiSiteMock).toHaveBeenCalled();
    });
  });
});
