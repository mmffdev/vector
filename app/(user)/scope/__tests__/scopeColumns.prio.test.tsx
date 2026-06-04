import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { makeScopeColumns } from "../scopeColumns";
import type { ScopeNode } from "../scopeTreeData";

const noopOpenForm = vi.fn();
const noopPatchColour = vi.fn();
const emptyFlowStates = new Map();

function makeNode(overrides: Partial<ScopeNode> = {}): ScopeNode {
  return {
    id: "EP-1",
    uuid: "00000000-0000-0000-0000-000000000001",
    type: "EP",
    artefactTypeId: "type-epic",
    summary: "Test Epic",
    flowStateId: "fs-1",
    flowStateName: "Backlog",
    flowStateCode: "backlog",
    points: null,
    owner: "",
    parent: null,
    parentId: null,
    parentUuid: null,
    sprint: null,
    due: null,
    childrenCount: 0,
    colour: null,
    prio: null,
    ...overrides,
  };
}

describe("scopeColumns — Prio column", () => {
  it("is the first column in the array", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates, noopPatchColour);
    expect(cols[0]?.id).toBe("prio");
    expect(cols[0]?.label).toBe("Prio");
  });

  it("renders the numeric value when prio is set", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates, noopPatchColour);
    const prioCol = cols[0]!;
    const node = makeNode({ prio: 7 });
    render(<div>{prioCol.renderCell!(node, undefined)}</div>);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders an empty cell when prio is null", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates, noopPatchColour);
    const prioCol = cols[0]!;
    const node = makeNode({ prio: null });
    const { container } = render(<div>{prioCol.renderCell!(node, undefined)}</div>);
    const cell = container.querySelector(".grid__Tree_Prio");
    expect(cell).toBeTruthy();
    expect(cell?.textContent).toBe("");
  });

  it("has fixed width and is sortable but not resizable", () => {
    const cols = makeScopeColumns(noopOpenForm, emptyFlowStates, noopPatchColour);
    const prioCol = cols[0]!;
    expect(prioCol.defaultWidth).toBe(56);
    expect(prioCol.sortable).toBe(true);
    expect(prioCol.resizable).toBe(false);
  });
});
