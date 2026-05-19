// PLA-0052 Story 14 — /risk page vitest.
//
// Verifies the page mounts, fetches /_site/risks/summary on first render,
// renders the summary cells with the returned values, and mounts the
// ObjectTree shell (which is mocked here — its own behaviour is exercised
// by its own suite). The Risks panel header + filter chips smoke-test the
// risk-tree-config wiring path through the wizardConfig resolver.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────

// apiSite — controlled mock returning the Story 10 /risks/summary wire shape.
const apiSiteMock = vi.fn();
vi.mock("@/app/lib/api", () => ({
  __esModule: true,
  apiSite: (...args: unknown[]) => apiSiteMock(...args),
}));

// usePageTitle — return a stable title string.
vi.mock("@/app/hooks/usePageTitle", () => ({
  __esModule: true,
  usePageTitle: () => ({ full: "Risk" }),
}));

// PageContent / Panel / PageHeading — render children passthrough so we can
// query content without addressables substrate involvement.
vi.mock("@/app/components/PageContent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/app/components/Panel", () => ({
  __esModule: true,
  default: ({ children, title }: { children?: React.ReactNode; title?: string }) => (
    <section data-testid={`panel-${title ?? "untitled"}`}>{children}</section>
  ),
}));
vi.mock("@/app/components/PageHeading", () => ({
  __esModule: true,
  default: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <header><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</header>
  ),
}));

// PageSummaryHeader — real, since we want to assert the cells render.
// No mock; uses the real component.

// ObjectTree — mock to a marker DIV so we don't have to wire its dependencies.
vi.mock("@/app/components/ObjectTree/p_ObjectTree", () => ({
  __esModule: true,
  default: () => <div data-testid="object-tree-mock">ObjectTree mounted</div>,
}));

// wizardLoader — return predictable shape; the page calls resolveWizardConfig
// + buildWorkItemsFunctions and only reads a few keys back.
vi.mock("@/app/lib/wizardLoader", () => ({
  __esModule: true,
  resolveWizardConfig: (raw: any) => raw,
  buildWorkItemsFunctions: () => ({
    getParentId: () => null,
    getChildrenCount: () => 0,
    searchAccessor: () => "",
  }),
}));

// risk-tree-config — stub the named exports the page imports.
vi.mock("@/app/components/risk-tree-config", () => ({
  __esModule: true,
  RisksFilterChips: () => <div data-testid="risks-filter-chips" />,
}));

// ArtefactTypeCatalogueContext — page gates ObjectTree mount on
// `types.length > 0`. Provide a non-empty fixture so the gate opens.
vi.mock("@/app/contexts/ArtefactTypeCatalogueContext", () => ({
  __esModule: true,
  useArtefactTypeCatalogue: () => ({
    types: [{ id: "risk-type-uuid", slot_ref: "wrk_risk", name: "risk" }],
  }),
}));

import RiskPage from "@/app/(user)/risk/page";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_SUMMARY = {
  total: 42,
  open: 17,
  by_severity: { critical: 3, high: 7, medium: 12, low: 20 },
  by_likelihood: { high: 5, medium: 14, low: 23 },
  matrix: [
    [2, 3, 2],
    [4, 5, 3],
    [3, 6, 11],
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("/risk page (PLA-0052 Story 14)", () => {
  beforeEach(() => {
    apiSiteMock.mockReset();
  });

  it("fetches /risks/summary on mount and renders the cell values", async () => {
    apiSiteMock.mockResolvedValueOnce(SAMPLE_SUMMARY);
    render(<RiskPage />);

    await waitFor(() => {
      expect(apiSiteMock).toHaveBeenCalledWith("/risks/summary");
    });

    await waitFor(() => {
      expect(screen.getByText("42")).toBeTruthy(); // TOTAL RISKS
    });
    expect(screen.getByText("17")).toBeTruthy(); // OPEN
    expect(screen.getByText("3")).toBeTruthy();  // CRITICAL
    expect(screen.getByText("7")).toBeTruthy();  // HIGH SEV
    expect(screen.getByText("5")).toBeTruthy();  // HIGH LIK
  });

  it("renders zero-filled cells when /risks/summary errors", async () => {
    apiSiteMock.mockRejectedValueOnce(new Error("network"));
    render(<RiskPage />);

    // Wait for the fetch to settle, then assert the zero state.
    await waitFor(() => {
      expect(apiSiteMock).toHaveBeenCalledWith("/risks/summary");
    });
    // All cells should show 0 — they share the value so we expect multiple matches.
    const zeros = await screen.findAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(5);
  });

  it("mounts the ObjectTree shell inside the register Panel", async () => {
    apiSiteMock.mockResolvedValueOnce(SAMPLE_SUMMARY);
    render(<RiskPage />);

    const tree = await screen.findByTestId("object-tree-mock");
    expect(tree).toBeTruthy();
    // The real ObjectTree wraps itself in a Panel titled "Risk register",
    // but the mock collapses that wrapper. Asserting mount is enough.
  });

  it("renders the page heading and header panel addressable", async () => {
    apiSiteMock.mockResolvedValueOnce(SAMPLE_SUMMARY);
    render(<RiskPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Risk");
    expect(screen.getByTestId("panel-Risk")).toBeTruthy();
  });
});
