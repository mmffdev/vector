// FlowBoard loader tests — FB1.3.1
//
// Covers: valid load, freeze contract, configOverride merge,
// missing required keys, and bad key types.
//
// Pure-function tests; no React, no RTL — mirrors the
// ObjectTreeV2/__tests__/loader.test.ts pattern.

import { describe, it, expect } from "vitest";
import { loadFlowBoardConfig, type FlowBoardConfig } from "@/app/components/FlowBoard/loader";
import { getFlowBoardSlotName } from "@/app/components/FlowBoard/registry";
import canonicalJson from "@/app/components/FlowBoard/configs/p_wizard_flowboard_workitems.json";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clone the canonical JSON so mutation tests start clean. */
function cloneCanonical(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(canonicalJson)) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadFlowBoardConfig", () => {
  it("loads the canonical workitems sidecar JSON without error", () => {
    const config = loadFlowBoardConfig(canonicalJson);

    expect(config.name).toBe("flow_board_workitems");
    expect(config.title).toBe("Work item flow");
    expect(config.description).toContain("Drag work items");
    expect(config.panel.tone).toBe("neutral");
    expect(config.panel.radius).toBe("lg");
    expect(config.panel.padding).toBe("md");
    expect(config.panel.title).toBe("Flow board");
    expect(config.panel.show_panel_chrome).toBe(true);
    expect(config.artefact_type_scope).toBe("work");
    expect(config.exclude_prefixes).toEqual(["EP"]);
    expect(config.default_artefact_type_prefix).toBe("US");
    expect(config.type_switcher.show).toBe(true);
    expect(config.type_switcher.label).toBe("Artefact type");
    expect(config.card.default_fields).toEqual(["id", "title", "assignee", "points", "priority"]);
    expect(config.card.renderer).toBe("standard");
    expect(config.columns.show_wip).toBe(true);
    expect(config.columns.wip_format).toBe("ratio_with_overage");
    expect(config.columns.overage_tone).toBe("danger");
    expect(config.transitions.mode).toBe("strict");
    expect(config.empty.title).toBe("No work items here yet");
    expect(config.empty.body).toContain("Cards will appear");
  });

  it("deep-freezes the result — top-level properties are immutable", () => {
    const config = loadFlowBoardConfig(canonicalJson);

    expect(Object.isFrozen(config)).toBe(true);

    // Attempting mutation should be a no-op (sloppy) or throw (strict).
    // In Vitest's Node environment, strict mode is active so we expect throw.
    expect(() => {
      (config as Record<string, unknown>)["name"] = "mutated";
    }).toThrow();
  });

  it("deep-freezes nested sub-objects (panel, card, columns, transitions, empty)", () => {
    const config = loadFlowBoardConfig(canonicalJson);

    expect(Object.isFrozen(config.panel)).toBe(true);
    expect(Object.isFrozen(config.type_switcher)).toBe(true);
    expect(Object.isFrozen(config.card)).toBe(true);
    expect(Object.isFrozen(config.columns)).toBe(true);
    expect(Object.isFrozen(config.transitions)).toBe(true);
    expect(Object.isFrozen(config.empty)).toBe(true);

    expect(() => {
      (config.panel as Record<string, unknown>)["tone"] = "danger";
    }).toThrow();
  });

  it("applies configOverride via shallow merge — overridden key changes, others preserved", () => {
    const override: Partial<FlowBoardConfig> = { title: "Custom board title" };
    const config = loadFlowBoardConfig(canonicalJson, override);

    expect(config.title).toBe("Custom board title");
    // Non-overridden keys are preserved from the canonical JSON.
    expect(config.name).toBe("flow_board_workitems");
    expect(config.panel.tone).toBe("neutral");
    expect(config.artefact_type_scope).toBe("work");
  });

  it("throws on missing top-level required key: name", () => {
    const raw = cloneCanonical();
    delete raw["name"];
    expect(() => loadFlowBoardConfig(raw)).toThrow(/root\.name/);
  });

  it("throws on missing top-level required key: panel", () => {
    const raw = cloneCanonical();
    delete raw["panel"];
    expect(() => loadFlowBoardConfig(raw)).toThrow(/root\.panel/);
  });

  it("throws on missing top-level required key: artefact_type_scope", () => {
    const raw = cloneCanonical();
    delete raw["artefact_type_scope"];
    expect(() => loadFlowBoardConfig(raw)).toThrow(/artefact_type_scope/);
  });

  it("throws on missing top-level required key: card", () => {
    const raw = cloneCanonical();
    delete raw["card"];
    expect(() => loadFlowBoardConfig(raw)).toThrow(/root\.card/);
  });

  it("throws on missing top-level required key: columns", () => {
    const raw = cloneCanonical();
    delete raw["columns"];
    expect(() => loadFlowBoardConfig(raw)).toThrow(/root\.columns/);
  });

  it("throws on bad type — name: 123 (must be string)", () => {
    const raw = cloneCanonical();
    raw["name"] = 123;
    expect(() => loadFlowBoardConfig(raw)).toThrow(/root\.name.*string/i);
  });

  it("throws on bad type — exclude_prefixes: 'EP' (must be string[])", () => {
    const raw = cloneCanonical();
    raw["exclude_prefixes"] = "EP";
    expect(() => loadFlowBoardConfig(raw)).toThrow(/exclude_prefixes/);
  });

  it("throws on bad enum value — panel.tone: 'purple' (not in allowed set)", () => {
    const raw = cloneCanonical();
    (raw["panel"] as Record<string, unknown>)["tone"] = "purple";
    expect(() => loadFlowBoardConfig(raw)).toThrow(/panel\.tone/);
  });

  it("throws when raw input is not a plain object", () => {
    expect(() => loadFlowBoardConfig(null)).toThrow(/plain object/i);
    expect(() => loadFlowBoardConfig("string")).toThrow(/plain object/i);
    expect(() => loadFlowBoardConfig(42)).toThrow(/plain object/i);
    expect(() => loadFlowBoardConfig([])).toThrow(/plain object/i);
  });
});

// ── Registry: getFlowBoardSlotName contract ───────────────────────────────────
// FB1.3.7 — pins the slot-name helper so a future refactor cannot reintroduce
// the doubled-prefix bug (samantha…panel.flow_board_flow_board_workitems).

describe("getFlowBoardSlotName", () => {
  it("returns the address-prefixed slot for a sidecar name (single prefix, no doubling)", () => {
    expect(getFlowBoardSlotName("flow_board_workitems")).toBe(
      "samantha._viewport.app._kind.panel.flow_board_workitems",
    );
  });

  it("does not prepend flow_board_ to the name — caller supplies the full suffix", () => {
    // Confirm no doubling: if a future change erroneously re-adds flow_board_ inside
    // the helper, this assertion would catch it.
    const slot = getFlowBoardSlotName("flow_board_workitems");
    expect(slot).not.toContain("flow_board_flow_board_");
  });
});
