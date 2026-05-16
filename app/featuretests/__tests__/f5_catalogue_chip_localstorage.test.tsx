// F5 — Catalogue + chip + localStorage + sidecar runtime resolution.
//
// PLA-0054 feature test. Covers:
//   - 00588 — ArtefactTypeCatalogueProvider fetches the per-workspace
//     catalogue once at mount and exposes it via context.
//   - 00589 — useArtefactTypeBySlot('wrk_risk') resolves to the
//     per-tenant UUID for that slot in the active workspace.
//   - 00590 — NavigationPie chip values are UUIDs, never slugs.
//   - 00591 — Chip filter state is persisted to localStorage keyed by
//     workspace_id, so switching workspaces drops the previous
//     workspace's filter selection rather than carrying it.
//   - 00592 — Page sidecar JSON references slots ("artefact_type_slot":
//     "wrk_risk") which the page resolves to UUIDs at mount via the
//     catalogue context.
//
// Tracker group: `frontend-chip-foundation`, feature `F5`.
//
// Written RED 2026-05-16. Modules below do not exist yet — imports are
// dynamic + wrapped in try/catch so the F5 file always loads (and
// always fails) without blocking other vitest files in the project.
// Story 00588 creates the catalogue module; later stories add the
// hooks, chip wiring, and sidecar resolver.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    email: "f5@example.com",
    is_active: true,
  };
  try {
    if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.clear === "function") {
      window.localStorage.clear();
    }
  } catch {
    // jsdom harness may not expose localStorage; the round-trip test
    // will skip naturally if so.
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: dynamically import a module path; report a failing test if
// the module doesn't exist yet. This is the RED signal for stories
// that haven't been implemented — the test fails clearly with
// "module not found: …" instead of crashing the whole vitest run.
async function importOrFail(path: string): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ path);
  } catch (err) {
    throw new Error(`module ${path} not found — story for it has not landed: ${(err as Error).message}`);
  }
}

describe("F5 — catalogue + chip + localStorage + sidecar", () => {
  it("story 00588 — ArtefactTypeCatalogueProvider module exists and exports the provider", async () => {
    const mod = (await importOrFail("@/app/contexts/ArtefactTypeCatalogueContext")) as {
      ArtefactTypeCatalogueProvider?: unknown;
    };
    expect(mod.ArtefactTypeCatalogueProvider).toBeDefined();
  });

  it("story 00589 — useArtefactTypeBySlot('wrk_risk') resolves to a UUID, not a slug", async () => {
    const mod = (await importOrFail("@/app/hooks/useArtefactTypeBySlot")) as {
      useArtefactTypeBySlot?: (slot: string) => string | null;
    };
    expect(mod.useArtefactTypeBySlot).toBeDefined();

    // Asserted via the contract: when wired into the provider with a
    // catalogue carrying { slot: 'wrk_risk', id: '<uuid>' }, the hook
    // returns the UUID. The integration wiring lives behind story
    // 00589; until then the import alone fails the test.
  });

  it("story 00590 — useChipTypeOptions exists and produces UUID-valued chip options", async () => {
    // Story 00590 deletes the hardcoded TYPE_CHIP_OPTIONS / STATUS_CHIP_OPTIONS
    // / PRIORITY_CHIP_OPTIONS arrays in work-items-tree-config.tsx and
    // replaces them with a hook that reads from the catalogue. The
    // export below is the RED signal — the hook does not exist yet.
    const mod = (await importOrFail("@/app/hooks/useChipTypeOptions")) as {
      useChipTypeOptions?: () => { value: string; label: string }[];
    };
    expect(mod.useChipTypeOptions).toBeDefined();
    // Once 00590 lands, an integration test renders a chip with a
    // mocked catalogue and asserts the option values are UUIDs.
  });

  it("story 00591 — filter selection is persisted in localStorage keyed by workspace_id", async () => {
    const mod = (await importOrFail("@/app/lib/workspaceFilterStore")) as {
      readFilterFor?: (workspaceId: string) => Record<string, string[]> | null;
      writeFilterFor?: (workspaceId: string, filter: Record<string, string[]>) => void;
    };
    expect(mod.readFilterFor).toBeDefined();
    expect(mod.writeFilterFor).toBeDefined();

    // Round-trip contract — keys are workspace-scoped so switching
    // workspace drops the previous selection naturally.
    mod.writeFilterFor!("ws-A-uuid", { item_type_id: ["uuid-1", "uuid-2"] });
    expect(mod.readFilterFor!("ws-A-uuid")).toEqual({ item_type_id: ["uuid-1", "uuid-2"] });
    expect(mod.readFilterFor!("ws-B-uuid")).toBeNull();
  });

  it("story 00592 — page sidecar resolves \"artefact_type_slot\": \"wrk_risk\" to a UUID via the catalogue", async () => {
    const mod = (await importOrFail("@/app/lib/sidecarSlotResolver")) as {
      resolveSlotRefs?: (
        sidecar: unknown,
        catalogue: { id: string; slot: string | null }[],
      ) => unknown;
    };
    expect(mod.resolveSlotRefs).toBeDefined();

    const sidecar = {
      filter_seed: { artefact_type_slot: "wrk_risk" },
    };
    const catalogue = [
      { id: "uuid-risk", slot: "wrk_risk" },
      { id: "uuid-epic", slot: "wrk_epic" },
    ];
    const resolved = mod.resolveSlotRefs!(sidecar, catalogue) as {
      filter_seed: { artefact_type_id?: string; artefact_type_slot?: string };
    };
    // After resolution the slot key is gone and the UUID key is present.
    expect(resolved.filter_seed.artefact_type_id).toBe("uuid-risk");
    expect(resolved.filter_seed.artefact_type_slot).toBeUndefined();
  });
});
