"use client";

// PLA-0055 / story 00598 — usePriorityList.
//
// Returns the active workspace's priorities sorted by (sort_order, name)
// with archived rows filtered out. Pure read; one fetch lives on the
// provider so multiple callers share a single network round-trip.

import { useMemo } from "react";

import {
  useArtefactPriorityCatalogue,
} from "@/app/contexts/ArtefactPriorityCatalogueContext";
import type { ArtefactPriority } from "@/app/lib/artefactPrioritiesApi";

export function usePriorityList(): ArtefactPriority[] {
  const { priorities } = useArtefactPriorityCatalogue();
  return useMemo(() => {
    return priorities
      .filter((p) => p.archived_at == null)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [priorities]);
}
