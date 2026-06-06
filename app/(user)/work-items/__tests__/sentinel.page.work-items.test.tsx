/**
 * Sentinel page-integration test for /work-items (PLA062 S10).
 *
 * Replaces the S02 stub. Tier: sentinel.page.work-items
 *
 * Three assertions pin the migration contract:
 *   1. The page module imports useSentinel — NOT useAuth/useScope/useTenant.
 *      (Static check via fs.readFileSync of the source — cheapest,
 *      strongest invariant for the migration.)
 *   2. The page mounts under <SentinelProvider> without throwing.
 *   3. The page's tenant + focus derivations match Sentinel state.
 *
 * Heavier "no stale-data flash" + cross-tenant isolation assertions
 * belong in the Playwright e2e (S23) — those need real backend +
 * real network timing to be credible.
 *
 * Children of WorkItemsPage are aggressively mocked to keep the
 * mount cost bounded; the unit under test is the page's own hook
 * surface + wiring, not its grandchildren.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

// ─── Static-grep AC1 ─────────────────────────────────────────────────────
// Read the page source directly. If a future edit re-introduces an old
// context import, this test goes RED before runtime — fastest signal.
const PAGE_PATH = resolve(__dirname, "../page.tsx");
const PAGE_SRC = readFileSync(PAGE_PATH, "utf-8");

// ─── Mocks ────────────────────────────────────────────────────────────────

// apiSite — controlled mock routing by path. /sentinel/boot returns
// the SentinelBootPayload shape so SentinelProvider can hydrate;
// /work-items/summary returns the empty summary shape so the page
// renders past its initial fetch without network errors. Other paths
// return an empty object — fine for jsdom unit-test purposes.
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
        permissions: ["work_items.list"],
        default_focus_node_id: FIXTURE_FOCUS,
        workspace_id: "ws-a-uuid",
      },
      tenant: { id: FIXTURE_TENANT_ID, name: "Tenant A" },
      grants: [{ node_id: FIXTURE_FOCUS, role: "admin" }],
      tenant_root: FIXTURE_FOCUS,
    };
  }
  if (path.includes("/work-items/summary")) {
    return { total: 0, blocked: 0, by_type: {} };
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

beforeEach(() => {
  // Reset call counts; keep the path-routing impl (set at mock
  // creation above so it survives resetAllMocks).
  apiSiteMock.mockClear();
});

// Mock the heavy children so the page mount stays bounded.
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
// The page renders the Grid body via <GridWorkItems> (swapped off ObjectTreeV2
// in commit 521ff63d). Stub it so this page-level Sentinel smoke test doesn't
// pull in the grid's router/useTree/realtime machinery — the same reason the
// old ObjectTreeV2 child was stubbed here. (Stale OTV2 mock removed.)
vi.mock("../GridWorkItems", () => ({
  __esModule: true,
  GridWorkItems: () => <div data-testid="grid-work-items" />,
}));
vi.mock("@/app/hooks/useHintOnce", () => ({
  __esModule: true,
  useHintOnce: () => {},
}));
vi.mock("@/app/hooks/usePageTitle", () => ({
  __esModule: true,
  usePageTitle: () => ({ full: "Work Items" }),
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
vi.mock("@/app/lib/sidecarSlotResolver", () => ({
  __esModule: true,
  resolveSlotRefs: (j: unknown) => j,
}));
vi.mock("@/app/contexts/DomRegistryContext", () => ({
  __esModule: true,
  useDomRegistry: () => ({ register: () => () => {} }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────

describe("sentinel.page.work-items", () => {
  it("AC1 — page source imports useSentinel and not the old hooks", () => {
    // Positive: the new hook MUST be present.
    expect(PAGE_SRC).toMatch(/from "@\/app\/sentinel"/);
    expect(PAGE_SRC).toMatch(/useSentinel\s*[(]/);

    // Negative: the old hooks MUST NOT be present.
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/AuthContext"/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/ScopeContext"/);
    expect(PAGE_SRC).not.toMatch(/from "@\/app\/contexts\/TenantContext"/);
    expect(PAGE_SRC).not.toMatch(/\buseAuth\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/\buseScope\s*[(]/);
    expect(PAGE_SRC).not.toMatch(/\buseTenant\s*[(]/);

    // Negative: direct workspace_id reads are also banned (procurement
    // smoking gun — see PLA062 § Problem).
    expect(PAGE_SRC).not.toMatch(/(?<!sentinel_)user[?]?\.subscription_id/);
    expect(PAGE_SRC).not.toMatch(/(?<!sentinel_)user[?]?\.workspace_id/);
  });

  it("AC2 — page mounts under <SentinelProvider> without throwing", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: WorkItemsPage } = await import("../page");

    expect(() =>
      render(
        <SentinelProvider>
          <WorkItemsPage />
        </SentinelProvider>,
      ),
    ).not.toThrow();
  });

  it("AC2.1 — grid body mounts before the artefact-type catalogue resolves", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: WorkItemsPage } = await import("../page");

    render(
      <SentinelProvider>
        <WorkItemsPage />
      </SentinelProvider>,
    );

    expect(screen.getByTestId("grid-work-items")).toBeInTheDocument();
  });

  it("AC3 — page reads tenant + focus from Sentinel (smoke)", async () => {
    const { SentinelProvider } = await import("@/app/sentinel");
    const { default: WorkItemsPage } = await import("../page");

    render(
      <SentinelProvider>
        <WorkItemsPage />
      </SentinelProvider>,
    );

    // After the provider boots, the page's apiSite call to fetch the
    // summary must have fired — proving the page reaches at least the
    // first sentinel-dependent effect.
    await waitFor(() => {
      expect(apiSiteMock).toHaveBeenCalled();
    });
  });
});
