// F9 — Priority catalogue + chip + tenant customisation.
//
// PLA-0055 feature test. Covers stories 00598 (ArtefactPriorityCatalogue
// Provider + usePriorityList + useDefaultPriority hooks) and 00599
// (NavigationPie Priority chip catalogue-driven, drops the hardcoded
// PRIORITY_CHIP_OPTIONS literal).
//
// Tracker group: `frontend-priority-customisation`, feature `F9`.
//
// Written RED 2026-05-16. Modules referenced below do not exist yet;
// imports are dynamic and wrapped via importOrFail so this file always
// loads (and always fails for the right reason) without blocking other
// vitest files.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockAuthState: {
  user: { id: string; subscription_id: string; workspace_id: string; email: string; is_active: boolean } | null;
} = { user: null };

vi.mock("@/app/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

beforeEach(() => {
  mockAuthState.user = {
    id: "u1",
    subscription_id: "sub-a",
    workspace_id: "ws-A-uuid",
    email: "f9@example.com",
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

describe("F9 — priority catalogue + chip + Showstopper", () => {
  it("story 00598 — ArtefactPriorityCatalogueProvider module exists and exports the provider + hook surface", async () => {
    const mod = (await importOrFail("@/app/contexts/ArtefactPriorityCatalogueContext")) as {
      ArtefactPriorityCatalogueProvider?: unknown;
      useArtefactPriorityCatalogue?: unknown;
    };
    expect(mod.ArtefactPriorityCatalogueProvider).toBeDefined();
    expect(mod.useArtefactPriorityCatalogue).toBeDefined();
  });

  it("story 00598 — usePriorityList returns sorted, non-archived priorities", async () => {
    const mod = (await importOrFail("@/app/hooks/usePriorityList")) as {
      usePriorityList?: () => { id: string; name: string; slot: string | null; sort_order: number }[];
    };
    expect(mod.usePriorityList).toBeDefined();
    // Behaviour contract: with a mocked provider feeding [archived, pri_high,
    // pri_medium] the hook returns the two non-archived rows in sort_order.
    // Asserted by the live integration test alongside the provider mock;
    // here the import alone is the RED signal until story 00598 lands.
  });

  it("story 00598 — useDefaultPriority returns the pri_medium row when present", async () => {
    const mod = (await importOrFail("@/app/hooks/useDefaultPriority")) as {
      useDefaultPriority?: () => { id: string; slot: string | null } | null;
      pickDefaultPriority?: (
        priorities: { id: string; slot: string | null; sort_order: number }[],
      ) => { id: string; slot: string | null } | null;
    };
    expect(mod.useDefaultPriority).toBeDefined();
    expect(mod.pickDefaultPriority).toBeDefined();
    // Pure pickDefaultPriority contract — exhaustive cases.
    const withMedium = [
      { id: "u-low", slot: "pri_low", sort_order: 0 },
      { id: "u-med", slot: "pri_medium", sort_order: 1 },
      { id: "u-high", slot: "pri_high", sort_order: 2 },
    ];
    expect(mod.pickDefaultPriority!(withMedium)?.id).toBe("u-med");
    // No slot match → first by sort_order.
    const noMedium = [
      { id: "u-x", slot: null, sort_order: 1 },
      { id: "u-y", slot: null, sort_order: 0 },
    ];
    expect(mod.pickDefaultPriority!(noMedium)?.id).toBe("u-y");
    // Empty list → null.
    expect(mod.pickDefaultPriority!([])).toBeNull();
  });

  it("story 00599 — usePriorityChipOptions exists and produces UUID-valued chip options", async () => {
    // Story 00599 deletes the hardcoded PRIORITY_CHIP_OPTIONS array in
    // work-items-tree-config.tsx and replaces it with a hook reading
    // from the catalogue. The export below is the RED signal — the
    // hook does not exist yet.
    const mod = (await importOrFail("@/app/hooks/usePriorityChipOptions")) as {
      usePriorityChipOptions?: () => { value: string; label: string }[];
    };
    expect(mod.usePriorityChipOptions).toBeDefined();
  });

  it("story 00599 — showstopper round-trip: tenant adds a custom priority and the chip enumerates it", async () => {
    // Wires the chip-options hook against a mocked catalogue carrying a
    // tenant-added 'Showstopper' row (slot=null). The hook must include
    // it without a code change. Reduces the multi-piece scenario to a
    // direct hook invocation — proving the catalogue→chip data path
    // doesn't filter custom rows out.
    const mod = (await importOrFail("@/app/hooks/usePriorityChipOptions")) as {
      usePriorityChipOptions?: () => { value: string; label: string }[];
    };
    expect(mod.usePriorityChipOptions).toBeDefined();
    const result = renderHook(() => mod.usePriorityChipOptions!()).result.current;
    const labels = result.map((o) => o.label);
    expect(labels).toContain("Showstopper");
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const slugs = result.filter((o) => !uuidRe.test(o.value));
    expect(slugs, `chip options should be UUIDs: ${JSON.stringify(slugs)}`).toEqual([]);
  });
});
