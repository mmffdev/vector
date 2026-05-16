// F6 — Status chip context-awareness + gadmin-rename invariance.
//
// PLA-0054 feature test. Covers story 00591 (Status chip enumerates
// flow_states of the singly-selected Type; falls back to 6 kind
// primitives otherwise; type-change invalidates incompatible state)
// plus the cross-cutting rename-invariance + workspace-switch
// invariance guarantees.
//
// Tracker group: `frontend-chip-foundation`, feature `F6`.
//
// Written RED 2026-05-16. Modules referenced below do not exist yet;
// imports are dynamic and wrapped so this file always loads.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockAuthState: {
  user: { id: string; subscription_id: string; workspace_id: string; email: string; is_active: boolean } | null;
} = { user: null };

vi.mock("@/app/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

// Mock the catalogue context so the hook sees a known set of types.
vi.mock("@/app/contexts/ArtefactTypeCatalogueContext", () => ({
  useArtefactTypeCatalogue: () => ({
    workspaceId: "ws-A-uuid",
    types: [
      { id: "uuid-risk-type", slot: "wrk_risk", name: "Risk", scope: "work", archived_at: null, sort_order: 50 },
      { id: "uuid-task-type", slot: "wrk_task", name: "Task", scope: "work", archived_at: null, sort_order: 40 },
    ],
    loading: false,
    error: null,
  }),
  catalogueCacheKey: (workspaceId: string | null) =>
    workspaceId == null ? "artefact-types::no-workspace" : `artefact-types::ws::${workspaceId}`,
}));

// Mock flowStatesApi.list() so the per-type Status fetch returns
// known UUIDs without hitting the backend.
vi.mock("@/app/lib/flowStatesApi", () => ({
  flowStatesApi: {
    list: async () => ({
      work: [
        {
          flow_id: "uuid-risk-flow",
          flow_name: "Risk flow",
          is_default: true,
          type_id: "uuid-risk-type",
          type_name: "Risk",
          type_scope: "work",
          states: [
            { id: "11111111-1111-1111-1111-111111111111", name: "Identified", kind: "todo", sort_order: 0, is_initial: true, is_pullable: true, exit_rule_count: 0 },
            { id: "22222222-2222-2222-2222-222222222222", name: "Mitigating",  kind: "in_progress", sort_order: 1, is_initial: false, is_pullable: true, exit_rule_count: 0 },
          ],
          transitions: [],
        },
      ],
      strategy: [],
    }),
  },
}));

beforeEach(() => {
  mockAuthState.user = {
    id: "u1",
    subscription_id: "sub-a",
    workspace_id: "ws-A-uuid",
    email: "f6@example.com",
    is_active: true,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

async function importOrFail(path: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ path);
  } catch (err) {
    throw new Error(`module ${path} not found — story for it has not landed: ${(err as Error).message}`);
  }
}

describe("F6 — Status chip context-awareness + rename invariance", () => {
  it("default — useStatusChipOptions returns the 6 kind primitives when no Type is selected", async () => {
    const mod = (await importOrFail("@/app/hooks/useStatusChipOptions")) as {
      useStatusChipOptions?: (singleTypeId: string | null) => { value: string; label: string }[];
    };
    expect(mod.useStatusChipOptions).toBeDefined();
    const { result } = renderHook(() => mod.useStatusChipOptions!(null));
    const kinds = result.current.map((o) => o.value).sort();
    expect(kinds).toEqual(
      ["accepted", "cancelled", "done", "in_progress", "in_review", "todo"].sort(),
    );
  });

  it("context-aware — useStatusChipOptions(typeId) enumerates that type's flow_states by UUID", async () => {
    const mod = (await importOrFail("@/app/hooks/useStatusChipOptions")) as {
      useStatusChipOptions?: (singleTypeId: string | null) => { value: string; label: string }[];
    };
    expect(mod.useStatusChipOptions).toBeDefined();
    const { result, rerender } = renderHook(() => mod.useStatusChipOptions!("uuid-risk-type"));
    // Initial render: per-type fetch is in flight, hook returns the
    // kind primitives as the loading fallback.
    expect(result.current.length).toBeGreaterThan(0);
    // Wait one microtask tick for the mocked fetch to settle, then
    // assert the UUID-shaped options replaced the primitives.
    await new Promise((r) => setTimeout(r, 0));
    rerender();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const slugs = result.current.filter((o) => !uuidRe.test(o.value));
    expect(slugs, `Status options should be UUIDs when Type is fixed: ${JSON.stringify(slugs)}`).toEqual([]);
  });

  it("invalidation — useStatusChipReducer clears Status when the new Type does not include the selected state", async () => {
    const mod = (await importOrFail("@/app/hooks/useStatusChipReducer")) as {
      useStatusChipReducer?: () => unknown;
      reduceStatusChange?: (
        currentStatus: string | null,
        newTypeStates: string[],
      ) => { status: string | null; cleared: boolean };
    };
    expect(mod.reduceStatusChange).toBeDefined();
    // Pure reducer contract: when Status is set to a state ID that
    // does not appear in the new type's state list, clear and report.
    const r = mod.reduceStatusChange!("uuid-state-old", ["uuid-state-new-a", "uuid-state-new-b"]);
    expect(r.status).toBeNull();
    expect(r.cleared).toBe(true);
    // When Status is still valid in the new type, keep it.
    const k = mod.reduceStatusChange!("uuid-state-shared", ["uuid-state-shared", "uuid-state-other"]);
    expect(k.status).toBe("uuid-state-shared");
    expect(k.cleared).toBe(false);
  });

  it("rename invariance — useArtefactTypeBySlot resolves the same UUID after the type's display name is mutated", async () => {
    // Mocked catalogue carries slot 'wrk_risk' → 'uuid-risk', label
    // initially 'Risk'. Mutate label to 'Issue' (simulating a gadmin
    // rename) and the slot lookup must still return 'uuid-risk'.
    const mod = (await importOrFail("@/app/hooks/useArtefactTypeBySlot")) as {
      resolveSlotInCatalogue?: (
        slot: string,
        catalogue: { id: string; slot: string | null; name: string }[],
      ) => string | null;
    };
    expect(mod.resolveSlotInCatalogue).toBeDefined();
    const before = mod.resolveSlotInCatalogue!("wrk_risk", [
      { id: "uuid-risk", slot: "wrk_risk", name: "Risk" },
    ]);
    const after = mod.resolveSlotInCatalogue!("wrk_risk", [
      { id: "uuid-risk", slot: "wrk_risk", name: "Issue" }, // gadmin rename
    ]);
    expect(before).toBe("uuid-risk");
    expect(after).toBe("uuid-risk");
  });

  it("workspace switch — catalogue cache key rotates so workspace B does not see workspace A's types", async () => {
    const mod = (await importOrFail("@/app/contexts/ArtefactTypeCatalogueContext")) as {
      catalogueCacheKey?: (workspaceId: string | null) => string;
    };
    expect(mod.catalogueCacheKey).toBeDefined();
    // Cache key contract: distinct workspaces produce distinct keys so
    // SWR / React Query invalidates on workspace switch.
    const keyA = mod.catalogueCacheKey!("ws-A-uuid");
    const keyB = mod.catalogueCacheKey!("ws-B-uuid");
    const keyNull = mod.catalogueCacheKey!(null);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyNull);
    expect(keyB).not.toBe(keyNull);
  });
});
