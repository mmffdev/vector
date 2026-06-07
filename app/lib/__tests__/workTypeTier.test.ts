import { describe, it, expect } from "vitest";
import { isStoryTier } from "../workTypeTier";
import type { ArtefactType } from "@/app/lib/artefactTypesApi";

const mk = (o: Partial<ArtefactType>): ArtefactType => ({
  id: o.id!, scope: "work", source: "system", name: o.name ?? "X",
  prefix: o.prefix ?? "XX", description: null, colour: null, slot: o.slot ?? null,
  parent_type_id: null, allows_children: true, layer_depth: null, sort_order: 0,
  archived_at: null, created_at: "", updated_at: "",
  execution_parent_slots: o.execution_parent_slots ?? null,
});

describe("isStoryTier", () => {
  it("Story-tier when parents include a strategy floor / Epic slot", () => {
    expect(isStoryTier(mk({ slot: "wrk_story", execution_parent_slots: ["FE", "wrk_epic"] }))).toBe(true);
    expect(isStoryTier(mk({ slot: "wrk_defect", execution_parent_slots: ["wrk_epic", "wrk_story"] }))).toBe(true);
  });
  it("a custom Spike behaving like Story is story-tier", () => {
    expect(isStoryTier(mk({ slot: null, execution_parent_slots: ["FE", "wrk_epic"] }))).toBe(true);
  });
  it("Risk is story-tier by its canonical slot despite empty parent slots", () => {
    expect(isStoryTier(mk({ slot: "wrk_risk", execution_parent_slots: [] }))).toBe(true);
  });
  it("Task is NOT story-tier (parents are Story/Defect, no Feature/Epic floor)", () => {
    expect(isStoryTier(mk({ slot: "wrk_task", execution_parent_slots: ["wrk_defect", "wrk_story"] }))).toBe(false);
  });
  it("Epic is NOT story-tier (parents Feature only — it IS the top, treat as above-tier)", () => {
    // Epic parents under Feature only; it sits ABOVE the story tier.
    expect(isStoryTier(mk({ slot: "wrk_epic", execution_parent_slots: ["FE"] }))).toBe(false);
  });
});
