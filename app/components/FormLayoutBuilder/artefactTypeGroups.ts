// Shared artefact-type grouping for the Form Layout Builder. Lives in its own
// module so BOTH the launch panel and the in-builder type switcher can use it
// without a circular import (the panel imports the shell; the shell needs the
// grouping). Pure presentation — no React, no fetch.

import type { ArtefactType } from "@/app/lib/artefactTypesApi";

// groupByScope splits the live catalogue into Strategic (scope=strategy) and
// Execution (scope=work) buckets, each ordered to mirror the portfolio
// hierarchy: highest-altitude type at the TOP, lowest at the BOTTOM.
//
// The DB's artefacts_types_sort_order encodes altitude ASCENDING from the
// floor of each stack (Feature=0 … Portfolio Runway=40 for strategy;
// Story=10 … Epic=40 for work). The portfolio stack reads the other way —
// Portfolio Runway above Feature, Epic above Story — so we render each group
// in DESCENDING sort_order. Pure presentation; the catalogue data is
// unchanged. Archived types are excluded.
export function groupByScope(types: ArtefactType[]): {
  strategic: ArtefactType[];
  execution: ArtefactType[];
} {
  const live = types.filter((t) => !t.archived_at);
  // Descending sort_order = top-of-stack first. Tie-break by name so equal
  // sort_order tiers (e.g. placeholder "Test Type …" rows at 100) stay
  // deterministic rather than relying on insertion order.
  const byStackDesc = (a: ArtefactType, b: ArtefactType) =>
    b.sort_order - a.sort_order || a.name.localeCompare(b.name);
  return {
    strategic: live.filter((t) => t.scope === "strategy").sort(byStackDesc),
    execution: live.filter((t) => t.scope === "work").sort(byStackDesc),
  };
}
