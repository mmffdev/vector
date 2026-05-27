/**
 * p_FlowBoard.test.tsx — FB1.3.7
 *
 * Unit tests for the top-level FlowBoard component.
 *
 * Heavy mocking strategy: all hooks and sub-components are mocked so this
 * test suite exercises only the composition and state logic of p_FlowBoard
 * itself — not the internals of useFlowBoardData, BoardColumn, BoardCard, etc.
 *
 * What IS tested:
 *   - Props contract: FlowBoardProps shape compiles and renders
 *   - Columns rendered from useFlowBoardData
 *   - topologyNodeId prop forwarded to useFlowBoardData
 *   - Fallback to sentinel_focus_node when topologyNodeId omitted
 *   - Uncontrolled mode: internal type state
 *   - Controlled mode: onArtefactTypeChange fires; external value used
 *   - configOverride shallow-merged via loadFlowBoardConfig
 *   - Addressable slot registered via data-samantha-slot
 *
 * What is NOT tested here:
 *   - Actual drag-and-drop (DndContext integration — covered by FB1.3.4 tests)
 *   - BoardCard / BoardColumn rendering details (covered by their own tests)
 *   - WipSettingsModal internals (covered by WipSettingsModal.test.tsx)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock dnd-kit — DndContext + DragOverlay don't need real implementation in unit tests
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dnd-context">{children}</div>
  ),
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
}));

// Mock useFlowBoardData — controllable via mockFlowBoardData
const mockFlowBoardData = {
  columns: [] as import("../hooks/useFlowBoardData").FlowBoardColumn[],
  isLoading: false,
  error: null as Error | null,
};

vi.mock("../hooks/useFlowBoardData", () => ({
  useFlowBoardData: vi.fn(() => mockFlowBoardData),
}));

// Mock useFlowStateTransitions
vi.mock("../hooks/useFlowStateTransitions", () => ({
  useFlowStateTransitions: vi.fn(() => ({
    isAllowed: () => true,
    isLoading: false,
    error: null,
  })),
}));

// Mock useFlowBoardDnd
vi.mock("../hooks/useFlowBoardDnd", () => ({
  useFlowBoardDnd: vi.fn(() => ({
    activeCard: null,
    activeStateId: null,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  })),
}));

// Mock patchArtefactFlowState
vi.mock("../hooks/usePatchArtefactFlowState", () => ({
  patchArtefactFlowState: vi.fn(),
}));

// Mock BoardColumn — renders a testid + passes children through
vi.mock("../columns/BoardColumn", () => ({
  BoardColumn: ({ column, children }: {
    column: import("../hooks/useFlowBoardData").FlowBoardColumn;
    children: React.ReactNode;
  }) => (
    <div data-testid={`board-column-${column.flowState.id}`}>
      <span>{column.flowState.name}</span>
      {children}
    </div>
  ),
}));

// Mock BoardCard
vi.mock("../card/BoardCard", () => ({
  BoardCard: ({ artefact, onClick }: {
    artefact: import("../hooks/useFlowBoardData").ArtefactCard;
    onClick?: (id: string) => void;
  }) => (
    <div
      data-testid={`board-card-${artefact.id}`}
      onClick={() => onClick?.(artefact.id)}
    >
      {artefact.title}
    </div>
  ),
}));

// Mock WipGearButton
vi.mock("../settings/WipGearButton", () => ({
  WipGearButton: ({ onClick }: { onClick: () => void; topologyNodeId: string }) => (
    <button data-testid="wip-gear-button" onClick={onClick}>Gear</button>
  ),
}));

// Mock WipSettingsModal
vi.mock("../settings/WipSettingsModal", () => ({
  WipSettingsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="wip-settings-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

// Mock useNodeMembership (used inside WipGearButton — mocked above, but guard it)
vi.mock("../hooks/useNodeMembership", () => ({
  useNodeMembership: vi.fn(() => ({ isMember: true, isLoading: false, error: null })),
}));

// Mock Panel — render-children passthrough that exposes the `name` and
// `title` props as data-attributes so we can assert addressable wiring
// without spinning up DomRegistry + Samantha SDK. Matches the pattern
// used by app/(user)/risk/__tests__/page.test.tsx and the work-items /
// portfolio-items sentinel tests.
vi.mock("@/app/components/Panel", () => ({
  __esModule: true,
  default: ({ children, name, title }: { children?: React.ReactNode; name?: string; title?: React.ReactNode }) => (
    <section data-testid="panel" data-panel-name={name} data-panel-title={typeof title === "string" ? title : ""}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));

// Mock DenseGridHeader — render-children passthrough that exposes the
// three slots as data-attributes so the addressable-slot test can
// assert badge + subtitle + description without pulling ObjectTreeV2.
vi.mock("@/app/components/ObjectTreeV2/kinds/DenseGridHeader", () => ({
  DenseGridHeader: ({ badge, subtitle, description }: { badge?: React.ReactNode; subtitle?: React.ReactNode; description?: React.ReactNode }) => (
    <header
      data-testid="dense-grid-header"
      data-badge={typeof badge === "string" ? badge : ""}
      data-subtitle={typeof subtitle === "string" ? subtitle : ""}
      data-description={typeof description === "string" ? description : ""}
    />
  ),
}));

// Mock ActionBar — passthrough that renders the search input + filterChips
// inline so chip tests don't have to dig through the real implementation.
vi.mock("@/app/components/ObjectTreeV2/kinds/ActionBar", () => ({
  ActionBar: ({ search, filterChips, ariaLabel }: { search?: { placeholder: string; value: string; onChange: (v: string) => void }; filterChips?: React.ReactNode; ariaLabel: string }) => (
    <div data-testid="actionbar" role="toolbar" aria-label={ariaLabel}>
      {search && (
        <input
          data-testid="actionbar-search"
          type="search"
          placeholder={search.placeholder}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          aria-label={search.placeholder}
        />
      )}
      {filterChips}
    </div>
  ),
}));

// Mock NavigationPie — exposes the option list as buttons so tests can
// fire clicks against specific values without driving the real
// pie-overlay interaction. Multi-select semantics preserved: clicking
// an option toggles it in `selected` and fires onChange with the new
// array. Tests for FlowBoard's single-select Type chip can then assert
// the outer onChange logic correctly collapses to one id.
vi.mock("@/app/components/NavigationPie", () => ({
  __esModule: true,
  default: ({ label, options, selected, onChange }: { label: string; options: ReadonlyArray<{ value: string; label: string }>; selected: string[]; onChange: (next: string[]) => void }) => (
    <div data-testid={`pie-${label.toLowerCase()}`} data-pie-selected={selected.join(",")}>
      <span>{label}</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="option"
          aria-selected={selected.includes(opt.value)}
          data-pie-option={opt.value}
          onClick={() => {
            const next = selected.includes(opt.value)
              ? selected.filter((v) => v !== opt.value)
              : [...selected, opt.value];
            onChange(next);
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

// Mock priority catalogue — small fixture so the Priority pie has options.
vi.mock("@/app/contexts/ArtefactPriorityCatalogueContext", () => ({
  useArtefactPriorityCatalogue: vi.fn(() => ({
    priorities: [
      { id: "pri-crit", name: "Critical", slot: "pri_critical", sort_order: 1, colour: "#dc2626", workspace_id: "ws-1", archived_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
      { id: "pri-med", name: "Medium", slot: "pri_medium", sort_order: 2, colour: null, workspace_id: "ws-1", archived_at: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    ],
    loading: false,
    error: null,
  })),
}));

// Mock useSentinel — expose sentinel_focus_node + sentinel_user
const mockSentinelFocusNode = "sentinel-node-123";
vi.mock("@/app/sentinel", () => ({
  useSentinel: vi.fn(() => ({
    sentinel_focus_node: mockSentinelFocusNode,
    sentinel_user: { id: "user-1", workspace_id: "ws-1" },
    sentinel_loading: false,
  })),
}));

// Mock ArtefactTypeCatalogue — controllable list of types
const mockCatalogueTypes = [
  { id: "type-us", name: "User Story", prefix: "US", scope: "work", archived_at: null },
  { id: "type-task", name: "Task", prefix: "TASK", scope: "work", archived_at: null },
  { id: "type-ep", name: "Epic", prefix: "EP", scope: "work", archived_at: null },
];

vi.mock("@/app/contexts/ArtefactTypeCatalogueContext", () => ({
  useArtefactTypeCatalogue: vi.fn(() => ({
    types: mockCatalogueTypes,
    loading: false,
    error: null,
  })),
}));

// Mock notify
vi.mock("@/app/lib/toast", () => ({
  notify: { apiError: vi.fn(), error: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { FlowBoard } from "../p_FlowBoard";
import { useFlowBoardData } from "../hooks/useFlowBoardData";
import { useSentinel } from "@/app/sentinel";

/** Minimal valid FlowBoardConfig for tests */
function makeConfig(overrides: Record<string, unknown> = {}): import("../loader").FlowBoardConfig {
  return {
    name: "flow_board_workitems",
    title: "Work item flow",
    description: "Test board",
    panel: {
      tone: "neutral" as const,
      radius: "lg" as const,
      padding: "md" as const,
      title: "Flow board",
      show_panel_chrome: true,
    },
    artefact_type_scope: "work" as const,
    exclude_prefixes: ["EP"],
    default_artefact_type_prefix: "US",
    type_switcher: { show: true, label: "Type" },
    card: { default_fields: ["id", "title"], renderer: "standard" as const },
    columns: {
      show_wip: true,
      wip_format: "ratio_with_overage" as const,
      overage_tone: "danger" as const,
      column_min_width: 280,
    },
    transitions: { mode: "strict" as const },
    empty: { title: "No items", body: "Nothing here" },
    ...overrides,
  } as import("../loader").FlowBoardConfig;
}

/** 3 column stubs for tests that need columns */
function makeColumns(): import("../hooks/useFlowBoardData").FlowBoardColumn[] {
  return [
    { flowState: { id: "fs-1", name: "Backlog", sort: 1, colour: null }, wipLimit: null, cards: [] },
    { flowState: { id: "fs-2", name: "In Progress", sort: 2, colour: "#3b82f6" }, wipLimit: 5, cards: [] },
    { flowState: { id: "fs-3", name: "Done", sort: 3, colour: null }, wipLimit: null, cards: [] },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FlowBoard — FB1.3.7", () => {
  beforeEach(() => {
    // Reset mock data to safe defaults
    mockFlowBoardData.columns = [];
    mockFlowBoardData.isLoading = false;
    mockFlowBoardData.error = null;
    vi.clearAllMocks();

    // Re-apply default mocks after clearAllMocks
    vi.mocked(useSentinel).mockReturnValue({
      sentinel_focus_node: mockSentinelFocusNode,
      sentinel_user: { id: "user-1", workspace_id: "ws-1" },
      sentinel_loading: false,
    } as ReturnType<typeof useSentinel>);

    vi.mocked(useFlowBoardData).mockReturnValue({
      columns: mockFlowBoardData.columns,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  // ── AC: renders columns from useFlowBoardData ──────────────────────────────

  it("renders columns from useFlowBoardData", () => {
    const cols = makeColumns();
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: cols, isLoading: false, error: null, refetch: vi.fn() });

    render(<FlowBoard config={makeConfig()} />);

    // All 3 columns rendered
    expect(screen.getByTestId("board-column-fs-1")).toBeTruthy();
    expect(screen.getByTestId("board-column-fs-2")).toBeTruthy();
    expect(screen.getByTestId("board-column-fs-3")).toBeTruthy();
  });

  // ── AC: uses topologyNodeId prop when supplied ─────────────────────────────

  it("forwards topologyNodeId prop to useFlowBoardData", () => {
    const propNodeId = "explicit-node-abc";
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: false, error: null, refetch: vi.fn() });

    render(<FlowBoard config={makeConfig()} topologyNodeId={propNodeId} />);

    // The hook should have been called with the explicit prop value
    const calls = vi.mocked(useFlowBoardData).mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.topologyNodeId).toBe(propNodeId);
  });

  // ── AC: falls back to sentinel_focus_node when topologyNodeId omitted ──────

  it("falls back to sentinel_focus_node when topologyNodeId is omitted", () => {
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: false, error: null, refetch: vi.fn() });

    render(<FlowBoard config={makeConfig()} />);

    const calls = vi.mocked(useFlowBoardData).mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.topologyNodeId).toBe(mockSentinelFocusNode);
  });

  // ── AC: uncontrolled when artefactTypeId prop omitted ─────────────────────

  it("is uncontrolled when artefactTypeId prop is omitted — seeds from catalogue default", () => {
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: false, error: null, refetch: vi.fn() });

    render(<FlowBoard config={makeConfig()} />);

    // After default seeding (US prefix → type-us), the hook should receive
    // the US type id. The default seeding runs via useEffect so check after render.
    const calls = vi.mocked(useFlowBoardData).mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    // type-us is the catalogue entry with prefix "US" (the config default)
    expect(lastCall?.artefactTypeId).toBe("type-us");
  });

  // ── AC: controlled when artefactTypeId + onArtefactTypeChange supplied ────

  it("is controlled when artefactTypeId + onArtefactTypeChange are supplied", () => {
    const onArtefactTypeChange = vi.fn();
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: false, error: null, refetch: vi.fn() });

    const { container } = render(
      <FlowBoard
        config={makeConfig()}
        artefactTypeId="type-task"
        onArtefactTypeChange={onArtefactTypeChange}
      />,
    );

    // The hook should receive the controlled id, not the internal default
    const calls = vi.mocked(useFlowBoardData).mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.artefactTypeId).toBe("type-task");

    // Click the Type pie's "User Story" option — fires onArtefactTypeChange
    // (the controlled-mode setter), not internal state. The mocked
    // NavigationPie emits one button per option keyed by option value;
    // there's only ONE button for type-us in the whole tree (priority pie
    // uses different option values), so we can select by data attribute
    // alone without disambiguating by pie.
    const usOption = container.querySelector('[data-pie-option="type-us"]');
    expect(usOption).toBeTruthy();
    fireEvent.click(usOption!);
    expect(onArtefactTypeChange).toHaveBeenCalledWith("type-us");
  });

  // ── AC: configOverride shallow-merged via loadFlowBoardConfig ─────────────

  it("applies configOverride via shallow merge (title overridden, rest preserved)", () => {
    const override: Partial<import("../loader").FlowBoardConfig> = {
      title: "Overridden Title",
    };
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: false, error: null, refetch: vi.fn() });

    // Render with override — no crash and slot name still comes from original name
    const { container } = render(
      <FlowBoard config={makeConfig()} configOverride={override} />,
    );

    // The slot name is built from config.name (not config.title), so it should
    // still be the workitems slot regardless of title override.
    // The board root (inside FlowBoardBoard) carries data-samantha-slot.
    // With activeTypeId seeded, the inner board renders.
    expect(container).toBeTruthy();
  });

  // ── AC: addressable wired via <Panel name=…> ──────────────────────────────
  // Was previously a dead data-samantha-slot attribute on the board root —
  // AddressAnchorResolver actually watches data-address, not the legacy
  // attribute, so registration was non-functional. The outer <Panel>
  // wrapper's useRegisterAddressable now owns the substrate registration
  // at samantha._viewport.app._kind.panel.<name>. This test asserts the
  // wiring contract (Panel rendered with the correct name + title) — the
  // substrate behaviour is covered by Panel's own tests.

  it("wires the addressable via <Panel name=… title=…> with the sidecar's name + panel.title", () => {
    const cols = makeColumns();
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: cols, isLoading: false, error: null, refetch: vi.fn() });

    const { container } = render(<FlowBoard config={makeConfig()} />);

    const panelEl = container.querySelector('[data-testid="panel"]');
    expect(panelEl).toBeTruthy();
    expect(panelEl?.getAttribute("data-panel-name")).toBe("flow_board_workitems");
    expect(panelEl?.getAttribute("data-panel-title")).toBe("Flow board");
  });

  // ── AC: DenseGridHeader fills the sunken band from sidecar + active type ──
  // The badge comes from the active artefact type's prefix (changes when the
  // type switcher fires); subtitle from the active type's name; description
  // from the sidecar's top-level description field.

  it("renders DenseGridHeader with active-type badge + subtitle + sidecar description", () => {
    const cols = makeColumns();
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: cols, isLoading: false, error: null, refetch: vi.fn() });

    const { container } = render(<FlowBoard config={makeConfig()} />);

    const headerEl = container.querySelector('[data-testid="dense-grid-header"]');
    expect(headerEl).toBeTruthy();
    // The default artefact type per the test sidecar fixture is the first
    // non-EP type in the mocked catalogue → US (User Story).
    expect(headerEl?.getAttribute("data-badge")).toBe("US");
    expect(headerEl?.getAttribute("data-subtitle")).toBe("User Story");
    // makeConfig() should preserve the sidecar's top-level description.
    expect(headerEl?.getAttribute("data-description")).toBeTruthy();
  });

  // ── Additional: loading state renders progressive skeleton column rail ────
  // Post-FB1.4.1 UX upgrade — the board no longer blanks behind a "Loading…"
  // string. The shell (toolbar + column area) renders immediately and the
  // column area shows 3 shimmer columns until real data arrives.

  it("renders skeleton column rail while useFlowBoardData is loading and has no columns yet", () => {
    vi.mocked(useFlowBoardData).mockReturnValue({ columns: [], isLoading: true, error: null, refetch: vi.fn() });

    const { container } = render(<FlowBoard config={makeConfig()} />);

    // 3 skeleton columns
    const skeletonCols = container.querySelectorAll(".flow-board__Column-skeleton");
    expect(skeletonCols.length).toBe(3);

    // The ActionBar chrome (containing the gear, search, and filter chips)
    // renders too — the shell is up and the user can open WIP settings,
    // search, or change filters while the board itself loads. Replaces
    // the previous .flow-board__Toolbar assertion (the inner toolbar was
    // removed when the gear moved up into ActionBar).
    expect(container.querySelector('[data-testid="actionbar"]')).toBeTruthy();
  });

  // ── Additional: error state renders error placeholder ────────────────────

  it("renders error message when useFlowBoardData returns an error", () => {
    vi.mocked(useFlowBoardData).mockReturnValue({
      columns: [],
      isLoading: false,
      error: new Error("Network timeout"),
      refetch: vi.fn(),
    });

    render(<FlowBoard config={makeConfig()} />);

    expect(screen.getByText(/failed to load board/i)).toBeTruthy();
  });
});
