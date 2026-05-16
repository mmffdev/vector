"use client";

// PLA-0054 / story 00590 — chip type options sourced from the
// per-workspace catalogue.
//
// Replaces the hardcoded TYPE_CHIP_OPTIONS array in
// work-items-tree-config.tsx. Each option's `value` is the
// artefact_type UUID (so chip selection survives gadmin display-name
// renames) and the `label` is the catalogue's name. Sort order
// follows the catalogue's `sort_order` to match the rest of the UI.

import { useMemo } from "react";

import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";

export interface ChipOption {
  value: string; // UUID
  label: string;
  slot: string | null;
}

export function useChipTypeOptions(scope: "work" | "strategy" = "work"): ChipOption[] {
  const { types } = useArtefactTypeCatalogue();
  return useMemo(() => {
    return types
      .filter((t) => t.scope === scope && t.archived_at == null)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((t) => ({ value: t.id, label: t.name, slot: t.slot }));
  }, [types, scope]);
}
