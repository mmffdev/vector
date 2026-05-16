"use client";

// PLA-0055 / story 00599 — Priority chip options from the catalogue.
//
// Replaces the hardcoded PRIORITY_CHIP_OPTIONS array in
// work-items-tree-config.tsx. Chip values are priority UUIDs so they
// survive gadmin renames (e.g. "Critical" → "Showstopper-Critical")
// and tenant-added custom rows (e.g. "Showstopper") appear without
// any code change.

import { useMemo } from "react";

import { usePriorityList } from "@/app/hooks/usePriorityList";

export interface PriorityChipOption {
  value: string; // UUID
  label: string;
  slot: string | null;
}

export function usePriorityChipOptions(): PriorityChipOption[] {
  const priorities = usePriorityList();
  return useMemo(
    () => priorities.map((p) => ({ value: p.id, label: p.name, slot: p.slot })),
    [priorities],
  );
}
