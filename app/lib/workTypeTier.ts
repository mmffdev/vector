import type { ArtefactType } from "@/app/lib/artefactTypesApi";

// A work type is "story-tier" if it nests under Epic (parents include wrk_epic).
// Story [FE,wrk_epic] + Defect [wrk_epic,wrk_story] qualify; Task [wrk_defect,
// wrk_story] and Epic [FE] do not. Derived from execution_parent_slots so custom
// types inherit their behaves-like tier. Pays down TD-SPRINTREVIEW-STORY-TIER-STATIC.
export function isStoryTier(type: ArtefactType): boolean {
  const slots = type.execution_parent_slots ?? [];
  if (slots.some((s) => s.toLowerCase() === "wrk_epic")) return true;
  // Risk has empty slots today but is canonically story-tier.
  if ((type.slot ?? "").toLowerCase() === "wrk_risk") return true;
  return false;
}
