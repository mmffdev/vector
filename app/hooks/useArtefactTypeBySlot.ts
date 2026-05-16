"use client";

// PLA-0054 / story 00589 — slot → UUID resolver.
//
// useArtefactTypeBySlot('wrk_risk') looks up the per-tenant UUID for
// the slot in the active workspace's catalogue. Returns null while
// the catalogue is loading or the slot isn't present (e.g. workspace
// has not adopted the risk type).
//
// resolveSlotInCatalogue is the pure form used by tests and by the
// sidecar resolver (which runs before any React tree exists).

import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

export function resolveSlotInCatalogue(
  slot: string,
  catalogue: Pick<ArtefactType, "id" | "slot">[],
): string | null {
  for (const t of catalogue) {
    if (t.slot === slot) return t.id;
  }
  return null;
}

export function useArtefactTypeBySlot(slot: string): string | null {
  const { types } = useArtefactTypeCatalogue();
  return resolveSlotInCatalogue(slot, types);
}
