// transitions.test.ts — FB1.3.4
//
// Tests for `useFlowStateTransitions`: isAllowed() matrix, loading state,
// and error state.
//
// Because useFlowStateTransitions is a React hook (uses useState/useEffect)
// we test it via renderHook from @testing-library/react. The `flows.list`
// call is vi.fn()-mocked so no real HTTP is issued.
//
// Fixture:
//   3 states: A ("state-a"), B ("state-b"), C ("state-c")
//   4 allowed transitions: A→B, B→C, C→A, A→C
//   NOT allowed: B→A, C→B (no row in flow_transitions for these)
//
// Expected isAllowed matrix (same-state always true):
//   (A, A) → true   (same-state)
//   (B, B) → true   (same-state)
//   (C, C) → true   (same-state)
//   (A, B) → true   (in set)
//   (B, C) → true   (in set)
//   (C, A) → true   (in set)
//   (A, C) → true   (in set)
//   (B, A) → false  (not in set)
//   (C, B) → false  (not in set)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ── State IDs ─────────────────────────────────────────────────────────────────

const A = "state-a";
const B = "state-b";
const C = "state-c";

const TYPE_ID = "type-us-001";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// 4 transitions: A→B, B→C, C→A, A→C. B→A and C→B are intentionally absent.
const FIXTURE_TRANSITIONS = [
  { from: A, to: B },
  { from: B, to: C },
  { from: C, to: A },
  { from: A, to: C },
];

// A minimal FlowsResponse with a single FlowGroup for TYPE_ID.
const FIXTURE_FLOWS_RESPONSE: FlowsResponse = {
  work: [
    {
      flow_id: "flow-001",
      flow_name: "Default",
      is_default: true,
      type_id: TYPE_ID,
      type_name: "User Story",
      type_scope: "work",
      states: [
        { id: A, name: "Backlog",     kind: "backlog",     sort_order: 10, is_initial: true,  is_pullable: false, exit_rule_count: 0 },
        { id: B, name: "In Progress", kind: "in_progress", sort_order: 20, is_initial: false, is_pullable: true,  exit_rule_count: 0 },
        { id: C, name: "Done",        kind: "done",        sort_order: 30, is_initial: false, is_pullable: false, exit_rule_count: 0 },
      ],
      transitions: FIXTURE_TRANSITIONS,
    },
  ],
  strategy: [],
};

// ── Mock `flows` from apiSite ──────────────────────────────────────────────────

vi.mock("@/app/lib/apiSite", () => ({
  flows: {
    list: vi.fn(),
  },
}));

// Import after mock is set up.
import { flows } from "@/app/lib/apiSite";
import type { FlowsResponse } from "@/app/lib/apiSite";
import { useFlowStateTransitions } from "@/app/components/FlowBoard/hooks/useFlowStateTransitions";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useFlowStateTransitions — isAllowed matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the full 9-cell matrix after loading", async () => {
    vi.mocked(flows.list).mockResolvedValueOnce(FIXTURE_FLOWS_RESPONSE);

    const { result } = renderHook(() => useFlowStateTransitions(TYPE_ID));

    // Initially loading — isAllowed is fail-open (returns true while loading).
    expect(result.current.isLoading).toBe(true);

    // Wait for the fetch to resolve.
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const { isAllowed } = result.current;

    // ── Same-state (always true) ─────────────────────────────────────────────
    expect(isAllowed(A, A)).toBe(true);
    expect(isAllowed(B, B)).toBe(true);
    expect(isAllowed(C, C)).toBe(true);

    // ── Allowed edges ────────────────────────────────────────────────────────
    expect(isAllowed(A, B)).toBe(true);  // A→B in fixture
    expect(isAllowed(B, C)).toBe(true);  // B→C in fixture
    expect(isAllowed(C, A)).toBe(true);  // C→A in fixture
    expect(isAllowed(A, C)).toBe(true);  // A→C in fixture

    // ── Denied edges ─────────────────────────────────────────────────────────
    expect(isAllowed(B, A)).toBe(false); // B→A NOT in fixture
    expect(isAllowed(C, B)).toBe(false); // C→B NOT in fixture

    // No error.
    expect(result.current.error).toBe(null);
  });

  it("is fail-open during loading (isAllowed returns true before data arrives)", async () => {
    // Use a never-resolving promise so we stay in loading state.
    vi.mocked(flows.list).mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useFlowStateTransitions(TYPE_ID));

    expect(result.current.isLoading).toBe(true);
    // While loading, no state pair should be blocked.
    expect(result.current.isAllowed(B, A)).toBe(true);
    expect(result.current.isAllowed(C, B)).toBe(true);
    expect(result.current.isAllowed(A, B)).toBe(true);
  });

  it("returns error when flows.list() throws, isAllowed remains fail-open on error", async () => {
    const fetchError = new Error("Network error");
    vi.mocked(flows.list).mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useFlowStateTransitions(TYPE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(fetchError);
    // On error: allowSet is empty Set, but same-state is still always true.
    expect(result.current.isAllowed(A, A)).toBe(true);
    // Cross-state is false when allowSet is empty (no data loaded).
    expect(result.current.isAllowed(A, B)).toBe(false);
    expect(result.current.isAllowed(B, C)).toBe(false);
  });

  it("returns error as generic Error when flows.list() rejects with a non-Error", async () => {
    vi.mocked(flows.list).mockRejectedValueOnce("string rejection");

    const { result } = renderHook(() => useFlowStateTransitions(TYPE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("string rejection");
  });

  it("unions transitions from multiple FlowGroups for the same type_id", async () => {
    // Two flow groups with the same type_id — transitions should be merged.
    const multiGroupResp: FlowsResponse = {
      work: [
        {
          flow_id: "flow-001",
          flow_name: "Flow A",
          is_default: true,
          type_id: TYPE_ID,
          type_name: "User Story",
          type_scope: "work",
          states: [],
          transitions: [{ from: A, to: B }],
        },
        {
          flow_id: "flow-002",
          flow_name: "Flow B",
          is_default: false,
          type_id: TYPE_ID,
          type_name: "User Story",
          type_scope: "work",
          states: [],
          transitions: [{ from: B, to: C }],
        },
      ],
      strategy: [],
    };
    vi.mocked(flows.list).mockResolvedValueOnce(multiGroupResp);

    const { result } = renderHook(() => useFlowStateTransitions(TYPE_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Both transitions from both groups should be allowed.
    expect(result.current.isAllowed(A, B)).toBe(true);
    expect(result.current.isAllowed(B, C)).toBe(true);
    // C→A is still not in either group.
    expect(result.current.isAllowed(C, A)).toBe(false);
  });

  it("returns empty allow-set when the type_id has no matching FlowGroup", async () => {
    vi.mocked(flows.list).mockResolvedValueOnce(FIXTURE_FLOWS_RESPONSE);

    const { result } = renderHook(() =>
      useFlowStateTransitions("type-does-not-exist")
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // No matches → no cross-state transitions allowed.
    expect(result.current.isAllowed(A, B)).toBe(false);
    expect(result.current.isAllowed(B, C)).toBe(false);
    // Same-state still always true.
    expect(result.current.isAllowed(A, A)).toBe(true);
  });

  it("refetches when artefactTypeId changes", async () => {
    // First call returns fixture for TYPE_ID.
    const riskResp: FlowsResponse = {
      work: [
        {
          flow_id: "flow-003",
          flow_name: "Risk Flow",
          is_default: true,
          type_id: "type-risk-002",
          type_name: "Risk",
          type_scope: "work",
          states: [],
          transitions: [{ from: B, to: A }],  // B→A is allowed for Risk type
        },
      ],
      strategy: [],
    };
    vi.mocked(flows.list)
      .mockResolvedValueOnce(FIXTURE_FLOWS_RESPONSE)
      .mockResolvedValueOnce(riskResp);

    const { result, rerender } = renderHook(
      ({ typeId }: { typeId: string }) => useFlowStateTransitions(typeId),
      { initialProps: { typeId: TYPE_ID } }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAllowed(B, A)).toBe(false); // Not in USER_STORY transitions

    // Switch type.
    rerender({ typeId: "type-risk-002" });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAllowed(B, A)).toBe(true);  // In RISK transitions
    expect(result.current.isAllowed(A, B)).toBe(false); // Not in RISK transitions
  });
});
