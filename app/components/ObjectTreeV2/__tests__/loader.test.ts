// Loader + registry contract tests — Slice 1.5 substrate exercise.
//
// These tests pin the loader's resolution behaviour so future slices
// can refactor the registries without breaking the contract. Pure-
// function tests; no RTL, no React.

import { describe, it, expect } from "vitest";
import {
  resolveWizardConfig,
  listRegisteredComponents,
  listRegisteredRules,
} from "@/app/components/ObjectTreeV2/loader";
import {
  componentRegistry,
  ruleRegistry,
} from "@/app/components/ObjectTreeV2/registry";

describe("ObjectTreeV2 loader.resolveWizardConfig", () => {
  it("passes non-ref fields through unchanged", () => {
    const raw = {
      dataType: "work_items",
      label: "Work items",
      pagination: { defaultPageSize: 25, options: [10, 25, 50] },
    };
    const out = resolveWizardConfig(raw);
    expect(out.dataType).toBe("work_items");
    expect(out.label).toBe("Work items");
    expect(out.pagination).toEqual({ defaultPageSize: 25, options: [10, 25, 50] });
  });

  it("resolves *ComponentRef fields to the registered component", () => {
    const raw = {
      flyoutComponentRef: "flyout.shell",
      headerComponentRef: "kind.DenseGridHeader",
    };
    const out = resolveWizardConfig(raw);
    // The suffix is stripped, leaving the bare field name with the
    // resolved component as the value.
    expect(out.flyout).toBe(componentRegistry["flyout.shell"]);
    expect(out.header).toBe(componentRegistry["kind.DenseGridHeader"]);
    // The *Ref keys themselves are gone from the output.
    expect("flyoutComponentRef" in out).toBe(false);
    expect("headerComponentRef" in out).toBe(false);
  });

  it("resolves *RuleRef fields to the registered rule function", () => {
    const raw = {
      canReparentRuleRef: "reparent.workItems.canReparent",
      getCandidatesRuleRef: "reparent.workItems.getCandidateIds",
    };
    const out = resolveWizardConfig(raw);
    expect(out.canReparent).toBe(ruleRegistry["reparent.workItems.canReparent"]);
    expect(out.getCandidates).toBe(ruleRegistry["reparent.workItems.getCandidateIds"]);
  });

  it("walks nested objects recursively", () => {
    const raw = {
      dnd: {
        enabled: true,
        canReparentRuleRef: "reparent.workItems.canReparent",
      },
      chrome: {
        items: [
          { kind: "search", placeholder: "Find…" },
          { actionBarComponentRef: "kind.ActionBar" },
        ],
      },
    };
    const out = resolveWizardConfig(raw) as Record<string, Record<string, unknown>>;
    expect((out.dnd as Record<string, unknown>).canReparent).toBe(
      ruleRegistry["reparent.workItems.canReparent"],
    );
    expect((out.dnd as Record<string, unknown>).enabled).toBe(true);
    const items = (out.chrome.items as Record<string, unknown>[]);
    expect(items[0].kind).toBe("search");
    expect(items[1].actionBar).toBe(componentRegistry["kind.ActionBar"]);
  });

  it("throws loudly when a *ComponentRef points at an unregistered key", () => {
    expect(() =>
      resolveWizardConfig({ flyoutComponentRef: "nonexistent.thing" }),
    ).toThrow(/no component registered/i);
  });

  it("throws loudly when a *RuleRef points at an unregistered key", () => {
    expect(() =>
      resolveWizardConfig({ canReparentRuleRef: "totally.invented" }),
    ).toThrow(/no rule registered/i);
  });

  it("rejects a bare suffix with no name body", () => {
    expect(() =>
      resolveWizardConfig({ ComponentRef: "flyout.shell" }),
    ).toThrow(/has no name body/i);
  });

  it("preserves null and undefined values", () => {
    const raw = {
      explicitNull: null,
      missing: undefined,
      keep: "value",
    };
    const out = resolveWizardConfig(raw);
    expect(out.explicitNull).toBeNull();
    expect(out.missing).toBeUndefined();
    expect(out.keep).toBe("value");
  });

  it("preserves arrays of primitives", () => {
    const raw = { ids: ["a", "b", "c"], counts: [1, 2, 3] };
    const out = resolveWizardConfig(raw);
    expect(out.ids).toEqual(["a", "b", "c"]);
    expect(out.counts).toEqual([1, 2, 3]);
  });
});

describe("ObjectTreeV2 loader.list helpers", () => {
  it("listRegisteredComponents returns the seeded keys", () => {
    const keys = listRegisteredComponents();
    expect(keys).toContain("flyout.shell");
    expect(keys).toContain("kind.DenseGridHeader");
    expect(keys).toContain("kind.ActionBar");
  });

  it("listRegisteredRules returns the seeded keys", () => {
    const keys = listRegisteredRules();
    expect(keys).toContain("reparent.workItems.canReparent");
    expect(keys).toContain("reparent.workItems.getCandidateIds");
  });
});
