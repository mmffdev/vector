import { describe, it, expect } from "vitest";
import { resolveAllowedTypes } from "../useParentCandidates";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

const mk = (over: Partial<ArtefactType>): ArtefactType => ({
  id: over.id!,
  scope: over.scope ?? "work",
  source: "system",
  name: over.name ?? "X",
  prefix: over.prefix ?? "XX",
  description: null,
  colour: null,
  slot: over.slot ?? null,
  parent_type_id: over.parent_type_id ?? null,
  allows_children: true,
  layer_depth: over.layer_depth ?? null,
  sort_order: 0,
  archived_at: null,
  created_at: "",
  updated_at: "",
  execution_parent_slots: over.execution_parent_slots ?? null,
});

describe("resolveAllowedTypes", () => {
  it("work type resolves execution_parent_slots → types", () => {
    const feature = mk({ id: "f", scope: "strategy", prefix: "FE", slot: "str_feature" });
    const epic = mk({ id: "e", scope: "work", prefix: "EP", slot: "wrk_epic" });
    const story = mk({
      id: "s",
      scope: "work",
      prefix: "US",
      slot: "wrk_story",
      execution_parent_slots: ["str_feature", "wrk_epic"],
    });
    const allowed = resolveAllowedTypes(story, [feature, epic, story]);
    expect(allowed.map((t) => t.id).sort()).toEqual(["e", "f"]);
  });

  // Prefix-fallback (orchestrator correction): the live migration backfill
  // stored the literal PREFIX "FE" for the Feature strategy type because that
  // type has slot=NULL. The resolver must therefore match slot-first, then fall
  // back to prefix — otherwise the Feature parent silently drops from a Story's
  // candidates.
  it("work type with a PREFIX-fallback slot still resolves the parent (Feature slot=null)", () => {
    const feature = mk({ id: "f", scope: "strategy", prefix: "FE", slot: null });
    const epic = mk({ id: "e", scope: "work", prefix: "EP", slot: "wrk_epic" });
    const story = mk({
      id: "s",
      scope: "work",
      prefix: "US",
      slot: "wrk_story",
      // "FE" is the Feature PREFIX, not a slot — no type has slot === "FE".
      execution_parent_slots: ["FE", "wrk_epic"],
    });
    const allowed = resolveAllowedTypes(story, [feature, epic, story]);
    expect(allowed.map((t) => t.id).sort()).toEqual(["e", "f"]);
  });

  it("slot match wins over prefix match for the same entry", () => {
    // A type whose SLOT is "EP" must beat a different type whose PREFIX is "EP".
    const slotEp = mk({ id: "slot", scope: "work", prefix: "EPIC", slot: "EP" });
    const prefixEp = mk({ id: "pre", scope: "work", prefix: "EP", slot: "wrk_epic" });
    const mover = mk({
      id: "m",
      scope: "work",
      prefix: "US",
      slot: "wrk_story",
      execution_parent_slots: ["EP"],
    });
    const allowed = resolveAllowedTypes(mover, [slotEp, prefixEp, mover]);
    expect(allowed.map((t) => t.id)).toEqual(["slot"]);
  });

  it("strategy type walks the parent_type_id chain upward", () => {
    const prw = mk({ id: "prw", scope: "strategy", prefix: "PRW" });
    const product = mk({ id: "pr", scope: "strategy", prefix: "PR", parent_type_id: "prw" });
    const theme = mk({ id: "th", scope: "strategy", prefix: "TH", parent_type_id: "pr" });
    const allowed = resolveAllowedTypes(theme, [prw, product, theme]);
    expect(allowed.map((t) => t.id)).toEqual(["pr", "prw"]);
  });

  it("returns empty for a root strategy type with no parent", () => {
    const prw = mk({ id: "prw", scope: "strategy", prefix: "PRW" });
    expect(resolveAllowedTypes(prw, [prw])).toEqual([]);
  });

  it("returns empty for a work type with no execution_parent_slots", () => {
    const orphan = mk({ id: "o", scope: "work", prefix: "RI", slot: "wrk_risk" });
    expect(resolveAllowedTypes(orphan, [orphan])).toEqual([]);
  });
});
