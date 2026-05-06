import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import type { WorkItem } from "@/app/components/work-items-tree-config";

// jsdom lacks ResizeObserver; ResourceTree's resize-fit useEffect needs it.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
});

// ─── Mocks ───────────────────────────────────────────────────────────────
// useWorkItemsFilters / useWorkItemsSort read URL state via next/navigation.
// The smoke tests don't exercise URL plumbing — return inert stand-ins.
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => "/work-items",
  useSearchParams: () => new URLSearchParams(),
}));

// Track every useRegisterAddressable call so the test can assert that
// ResourceTree registers itself + 5 prop-set sub-addresses.
const registerCalls: Array<{ kind: string; name: string }> = [];

vi.mock("@/app/contexts/DomRegistryContext", () => ({
  __esModule: true,
  useRegisterAddressable: (args: { kind: string; name: string }) => {
    registerCalls.push({ kind: args.kind, name: args.name });
    return {
      address: `samantha._test.${args.kind}.${args.name}`,
      addressable_id: `id-${args.kind}-${args.name}`,
      helpable: false,
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
  },
  useParentAddress: () => "samantha._viewport.app",
  useDomRegistry: () => ({
    get: () => null,
    ready: false,
    pageRoute: "/work-items",
    claimMount: () => "ok",
    releaseMount: () => undefined,
  }),
  useStrictRoute: () => false,
}));

// Stub work-item I/O — return a 5-row fixture deterministically.
const FIXTURE: WorkItem[] = Array.from({ length: 5 }, (_, i) => ({
  id: `00000000-0000-0000-0000-00000000000${i + 1}`,
  key_num: 100 + i,
  item_type: i === 0 ? "epic" : i === 1 ? "story" : "task",
  title: `Fixture row ${i + 1}`,
  status: "active",
  flow_state_id: "fs-1",
  flow_state_name: "Backlog",
  flow_state_code: "backlog",
  priority: "medium",
  story_points: i === 0 ? null : (i + 1) * 2,
  rollup_points: null,
  // PLA-0021 / 00458 — first fixture row carries a real sprint ref so the
  // Sprint-cell renderer test below can find an aliased cell; remaining
  // rows stay null so the em-dash placeholder branch is also covered.
  sprint_id: i === 0 ? "sprint-1" : null,
  sprint: i === 0 ? { id: "sprint-1", alias: "S-1" } : null,
  parent_id: null,
  owner_id: `user-0000${i}`,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-06T00:00:00Z",
  children_count: 0,
}));

vi.mock("@/app/components/work-items-tree-config", async () => {
  const actual =
    await vi.importActual<typeof import("@/app/components/work-items-tree-config")>(
      "@/app/components/work-items-tree-config",
    );
  return {
    ...actual,
    useWorkItemsWindow: () => ({
      windowRoots: FIXTURE,
      total: FIXTURE.length,
      loadingWindow: false,
      refetchWindow: vi.fn(),
      patchAndApply: vi.fn(),
      fetchChildren: vi.fn(async () => []),
    }),
    WorkItemsPanelHeader: () => <header data-testid="wi-panel-head" />,
    WorkItemsFilterChips: () => <div data-testid="wi-filter-chips" />,
  };
});

vi.mock("@/app/components/useWorkItemFlowStates", () => ({
  __esModule: true,
  useWorkItemFlowStates: () => [
    { id: "fs-1", name: "Backlog", code: "backlog", color: "#888" },
    { id: "fs-2", name: "Doing", code: "doing", color: "#48f" },
    { id: "fs-3", name: "Done", code: "done", color: "#4a4" },
  ],
}));

vi.mock("@/app/lib/api", () => ({
  __esModule: true,
  api: vi.fn(async () => ({ items: [], total: 0 })),
}));

// PLA-0021 / 00456 — BulkActionBar reads useHasPermission unconditionally
// (hooks run before its empty-selection early return). The smoke harness
// doesn't mount AuthProvider, so stub the hook to a permissive default.
vi.mock("@/app/contexts/AuthContext", () => ({
  __esModule: true,
  useHasPermission: () => true,
}));

import WorkItemsTree from "@/app/components/WorkItemsTree";

// ─── Tests ──────────────────────────────────────────────────────────────

describe("WorkItemsTree (PLA-0021 smoke)", () => {
  beforeEach(() => {
    registerCalls.length = 0;
  });

  it("registers tree + 5 prop-set sub-addresses", () => {
    render(
      <WorkItemsTree
        selectedId={null}
        onSelect={() => undefined}
        onPatched={() => undefined}
      />,
    );

    const tree = registerCalls.filter(
      (c) => c.kind === "tree" && c.name === "workitems",
    );
    expect(tree.length).toBeGreaterThanOrEqual(1);

    const propsets = registerCalls.filter((c) => c.kind === "propset");
    const propsetNames = propsets.map((c) => c.name).sort();
    expect(propsetNames).toEqual([
      "cogmenu",
      "colour",
      "data",
      "features",
      "scaffold",
    ]);
  });

  it("renders the 7 work-items columns and 5 fixture rows", () => {
    const { container } = render(
      <WorkItemsTree
        selectedId={null}
        onSelect={() => undefined}
        onPatched={() => undefined}
      />,
    );

    // Headers — sort buttons render the column label as text.
    expect(screen.getByText("ID")).toBeTruthy();
    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Pri")).toBeTruthy();
    expect(screen.getByText("PtsOwner")).toBeTruthy();
    expect(screen.getByText("Sprint")).toBeTruthy();
    expect(screen.getByText("Due")).toBeTruthy();

    // 5 data rows from the fixture (the row class comes from ResourceTree).
    const rows = container.querySelectorAll(".tree_accordion-dense__row");
    expect(rows.length).toBe(5);

    // Each fixture title is rendered.
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByText(`Fixture row ${i}`)).toBeTruthy();
    }
  });

  it("exposes a search input via the ResourceTree search prop", () => {
    render(
      <WorkItemsTree
        selectedId={null}
        onSelect={() => undefined}
        onPatched={() => undefined}
      />,
    );
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"], input[placeholder*="Search work items"]',
    );
    expect(search).not.toBeNull();
  });

  // PLA-0021 / 00458 — Sprint column renders the joined sprint alias when
  // the row carries a real `sprint = {id, alias}`, and falls back to the
  // em-dash placeholder when sprint is null. The fixture is built with the
  // first row sprint=`{id:"sprint-1", alias:"S-1"}` and the rest null;
  // we count cells, not specific rows, because ResourceTree decorates the
  // table layout with header/handle/expander cells that shift indices.
  it("renders the joined sprint alias for sprint-bearing rows and em-dash for null", () => {
    const { container } = render(
      <WorkItemsTree
        selectedId={null}
        onSelect={() => undefined}
        onPatched={() => undefined}
      />,
    );

    // Find every body cell rendered for the Sprint column. The Sprint
    // column carries cellModifier:"sprint" → a stable
    // `tree_accordion-dense__cell--sprint` class on each <td>. We filter
    // to <tbody> so the (themed) header strip is not picked up.
    const sprintCells = container.querySelectorAll(
      "tbody td.tree_accordion-dense__cell--sprint",
    );
    expect(sprintCells.length).toBe(5);

    // Row 0 carries the real sprint — text must contain "S-1".
    expect(sprintCells[0].textContent ?? "").toMatch(/S-1/);

    // Rows 1..4 have sprint = null — must render the em-dash placeholder.
    for (let i = 1; i < 5; i++) {
      expect(sprintCells[i].textContent ?? "").toBe("—");
    }
  });

  // PLA-0021 / 00449 — DnD AC: tree mounts without throwing when the rank
  // hook wires up, and every fixture row exposes a draggable handle cell
  // (so a drag can start). The DOM contract for `useResourceRank` is the
  // `data-rank-row-id` attribute on each row + a `.drag-handle-cell` <td>.
  it("renders a drag-handle cell on each row when DnD is enabled", () => {
    const { container } = render(
      <WorkItemsTree
        selectedId={null}
        onSelect={() => undefined}
        onPatched={() => undefined}
      />,
    );
    const handles = container.querySelectorAll(".drag-handle-cell");
    expect(handles.length).toBe(5);
    const rankRows = container.querySelectorAll("[data-rank-row-id]");
    expect(rankRows.length).toBe(5);
  });
});
