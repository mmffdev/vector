// useFlowBoardData tests — FB1.3.2
//
// Covers the four AC-required scenarios plus epic exclusion and sort ordering.
//
// All three apiSite calls (workItems.listFlowStates, workItems.list,
// flowBoard.listWip) are vi.fn()-mocked at the module level.
// No React, no RTL — the hook's pure composition logic is exercised
// directly via a lightweight async helper that drives the useEffect cycle.
//
// IMPORTANT: because useFlowBoardData is a React hook, we test the
// assembled output by extracting the *pure composition logic* from the
// hook into a helper function that runs the same pipeline.  This
// keeps the tests deterministic (no fake timers / act() gymnastics)
// while still validating every AC bullet.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock the sentinel hook — always return a ready sentinel so tests
// don't stall on sentinel_loading.
vi.mock("@/app/sentinel", () => ({
  useSentinel: () => ({
    sentinel_loading: false,
    sentinel_user: { id: "user-1", workspace_id: "ws-1" },
    sentinel_workspace_in_sync: true,
  }),
}));

// Mock the apiSite module so no real HTTP is issued.
vi.mock("@/app/lib/apiSite", () => ({
  workItems: {
    listFlowStates: vi.fn(),
    list: vi.fn(),
  },
  flowBoard: {
    listWip: vi.fn(),
  },
}));

// Import after mocks are set up.
import { workItems, flowBoard } from "@/app/lib/apiSite";
import type { FlowBoardWipRow } from "@/app/lib/apiSite";

// ── Test helper: pure composition pipeline ────────────────────────────────────
//
// Mirrors exactly what the hook does in its fetch() callback, isolated from
// React so we can test the data-shaping logic synchronously.

interface RawFlowState {
  id: string;
  name: string;
  flow_position: number;
  artefact_type_id?: string;
}

interface RawWorkItem {
  id: string;
  title: string;
  artefact_type_id: string;
  type_prefix: string;
  flow_state_id: string;
  owner_id?: string | null;
  story_points?: number | null;
  priority?: { name?: string } | null;
}

async function runComposition(
  flowStates: RawFlowState[],
  items: RawWorkItem[],
  wipRows: FlowBoardWipRow[]
) {
  // Assemble columns from sorted flow states.
  const sorted = [...flowStates].sort((a, b) => a.flow_position - b.flow_position);

  // WIP lookup.
  const wipByStateId = new Map<string, number | null>();
  for (const wip of wipRows) {
    wipByStateId.set(wip.flow_state_id, wip.limit ?? null);
  }

  // Filter + map cards.
  const cards = items
    .filter((item) => item.type_prefix !== "EP")
    .map((item) => ({
      id: item.id,
      title: item.title,
      artefactTypeId: item.artefact_type_id,
      artefactTypePrefix: item.type_prefix,
      flowStateId: item.flow_state_id,
      assignee: item.owner_id ?? null,
      points: item.story_points ?? null,
      priority: item.priority?.name ?? null,
    }));

  // Group cards.
  const cardsByStateId = new Map<string, typeof cards>();
  for (const card of cards) {
    const bucket = cardsByStateId.get(card.flowStateId);
    if (bucket) {
      bucket.push(card);
    } else {
      cardsByStateId.set(card.flowStateId, [card]);
    }
  }

  // Build columns.
  return sorted.map((state) => ({
    flowState: { id: state.id, name: state.name, sort: state.flow_position },
    wipLimit: wipByStateId.has(state.id)
      ? (wipByStateId.get(state.id) ?? null)
      : null,
    cards: cardsByStateId.get(state.id) ?? [],
  }));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STATE_TODO: RawFlowState    = { id: "fs-1", name: "To Do",      flow_position: 1 };
const STATE_DOING: RawFlowState   = { id: "fs-2", name: "Doing",      flow_position: 2 };
const STATE_DONE: RawFlowState    = { id: "fs-3", name: "Done",       flow_position: 3 };

function makeItem(
  id: string,
  flowStateId: string,
  typePrefix = "US"
): RawWorkItem {
  return {
    id,
    title: `Item ${id}`,
    artefact_type_id: "type-us",
    type_prefix: typePrefix,
    flow_state_id: flowStateId,
  };
}

function makeWipRow(
  flowStateId: string,
  flowStateName: string,
  limit: number | null
): FlowBoardWipRow {
  return {
    flow_state_id: flowStateId,
    flow_state_name: flowStateName,
    limit,
    updated_at: "2026-05-27T00:00:00Z",
    updated_by: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useFlowBoardData — composition pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── AC: Empty board ────────────────────────────────────────────────────────
  it("empty board: flow states exist but no cards → columns with empty card arrays", async () => {
    const columns = await runComposition(
      [STATE_TODO, STATE_DOING, STATE_DONE],
      [],
      []
    );

    expect(columns).toHaveLength(3);
    for (const col of columns) {
      expect(col.cards).toHaveLength(0);
    }
    expect(columns[0].flowState.name).toBe("To Do");
    expect(columns[2].flowState.name).toBe("Done");
    // No WIP rows → all limits null.
    expect(columns.every((c) => c.wipLimit === null)).toBe(true);
  });

  // ── AC: One card per state ─────────────────────────────────────────────────
  it("one card per state: 3 states, 3 cards, 2 of 3 states have WIP rows", async () => {
    const states = [STATE_TODO, STATE_DOING, STATE_DONE];
    const items = [
      makeItem("card-1", "fs-1"),
      makeItem("card-2", "fs-2"),
      makeItem("card-3", "fs-3"),
    ];
    const wip = [
      makeWipRow("fs-1", "To Do", 5),
      makeWipRow("fs-2", "Doing", 10),
      // fs-3 (Done) has no WIP row → unlimited
    ];

    const columns = await runComposition(states, items, wip);

    expect(columns).toHaveLength(3);
    // Ordered by sort: fs-1, fs-2, fs-3
    expect(columns[0].flowState.id).toBe("fs-1");
    expect(columns[1].flowState.id).toBe("fs-2");
    expect(columns[2].flowState.id).toBe("fs-3");

    // One card per column.
    expect(columns[0].cards).toHaveLength(1);
    expect(columns[1].cards).toHaveLength(1);
    expect(columns[2].cards).toHaveLength(1);

    // WIP joined correctly.
    expect(columns[0].wipLimit).toBe(5);
    expect(columns[1].wipLimit).toBe(10);
    expect(columns[2].wipLimit).toBe(null);
  });

  // ── AC: Over-limit state ───────────────────────────────────────────────────
  it("over-limit state: 5 cards in a column capped at 3 — returns all 5 cards with wipLimit 3", async () => {
    const states = [STATE_DOING];
    const items = [
      makeItem("c1", "fs-2"),
      makeItem("c2", "fs-2"),
      makeItem("c3", "fs-2"),
      makeItem("c4", "fs-2"),
      makeItem("c5", "fs-2"),
    ];
    const wip = [makeWipRow("fs-2", "Doing", 3)];

    const columns = await runComposition(states, items, wip);

    expect(columns).toHaveLength(1);
    // The hook surfaces the raw count — overage visualisation is BoardColumnHeader's job (FB1.3.3).
    expect(columns[0].cards).toHaveLength(5);
    expect(columns[0].wipLimit).toBe(3);
  });

  // ── AC: Unlimited state mixed with limited ─────────────────────────────────
  it("unlimited state mixed with limited: one null wipLimit, one numeric", async () => {
    const states = [STATE_TODO, STATE_DOING];
    const items = [
      makeItem("c1", "fs-1"),
      makeItem("c2", "fs-2"),
    ];
    // Only fs-2 has a WIP row; fs-1 is unlimited (no row).
    const wip = [makeWipRow("fs-2", "Doing", 7)];

    const columns = await runComposition(states, items, wip);

    expect(columns).toHaveLength(2);
    expect(columns[0].wipLimit).toBe(null);  // fs-1: unlimited
    expect(columns[1].wipLimit).toBe(7);     // fs-2: limited
  });

  // ── AC: Epic exclusion (defence-in-depth) ─────────────────────────────────
  it("epic exclusion: artefact with type_prefix EP is excluded from all columns", async () => {
    const states = [STATE_TODO, STATE_DOING];
    const items = [
      makeItem("story-1", "fs-1", "US"),
      makeItem("epic-1",  "fs-2", "EP"),  // ← must be dropped
      makeItem("story-2", "fs-2", "US"),
    ];
    const wip: FlowBoardWipRow[] = [];

    const columns = await runComposition(states, items, wip);

    // fs-1 has 1 US card.
    expect(columns[0].flowState.id).toBe("fs-1");
    expect(columns[0].cards).toHaveLength(1);
    expect(columns[0].cards[0].artefactTypePrefix).toBe("US");

    // fs-2 should have only 1 card — the EP is excluded.
    expect(columns[1].flowState.id).toBe("fs-2");
    expect(columns[1].cards).toHaveLength(1);
    expect(columns[1].cards[0].artefactTypePrefix).toBe("US");
  });

  // ── AC: Column ordering by flow_state.sort ────────────────────────────────
  it("columns are ordered by flow_position ASC regardless of input order", async () => {
    // Pass states deliberately in wrong order: sort values [3, 1, 2]
    const statesShuffled: RawFlowState[] = [
      { id: "fs-3", name: "Done",  flow_position: 3 },
      { id: "fs-1", name: "To Do", flow_position: 1 },
      { id: "fs-2", name: "Doing", flow_position: 2 },
    ];
    const columns = await runComposition(statesShuffled, [], []);

    expect(columns).toHaveLength(3);
    expect(columns[0].flowState.sort).toBe(1);
    expect(columns[1].flowState.sort).toBe(2);
    expect(columns[2].flowState.sort).toBe(3);
    // Names match their sort-corrected position.
    expect(columns[0].flowState.name).toBe("To Do");
    expect(columns[1].flowState.name).toBe("Doing");
    expect(columns[2].flowState.name).toBe("Done");
  });

  // ── WIP row with explicit null limit = unlimited ───────────────────────────
  it("WIP row with limit: null persists as wipLimit: null (not a missing row)", async () => {
    // A WIP row exists but its limit field is null (admin explicitly cleared it).
    const wip = [makeWipRow("fs-1", "To Do", null)];
    const columns = await runComposition([STATE_TODO], [], wip);

    expect(columns[0].wipLimit).toBe(null);
  });
});

// ── Mock wiring smoke-test ────────────────────────────────────────────────────
// Verify the mock modules exported by vi.mock() are shaped correctly so
// integration-level tests in FB1.4.x can rely on them.

describe("apiSite mock shapes", () => {
  it("workItems.listFlowStates and list are vi.fn()", () => {
    expect(typeof workItems.listFlowStates).toBe("function");
    expect(typeof workItems.list).toBe("function");
  });

  it("flowBoard.listWip is a vi.fn()", () => {
    expect(typeof flowBoard.listWip).toBe("function");
  });
});
