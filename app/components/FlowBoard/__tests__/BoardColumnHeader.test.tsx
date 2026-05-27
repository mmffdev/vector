// BoardColumnHeader tests — FB1.3.3
//
// Covers all 5 WIP states from spec §7.3:
//
//   under     count=3,  wipLimit=10  → "Doing (3/10)"
//   at        count=10, wipLimit=10  → "Doing (10/10)"  no badge, no red class
//   over      count=11, wipLimit=10  → "Doing (11/10)"  +1 badge + red class
//   unlimited count=11, wipLimit=null → "Doing (11)"    no slash, no badge
//   empty     count=0,  wipLimit=null + count=0, wipLimit=10
//
// Uses RTL render + DOM assertions.  Snapshots capture the full structure for
// structural regression.  css:false in vitest.config.ts means class names are
// raw strings — asserting them directly is reliable.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { BoardColumnHeader } from "@/app/components/FlowBoard/columns/BoardColumnHeader";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns the root element of a BoardColumnHeader render. */
function getRoot(container: HTMLElement): Element {
  const root = container.firstElementChild;
  if (!root) throw new Error("BoardColumnHeader rendered nothing");
  return root;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("BoardColumnHeader (FB1.3.3)", () => {
  // ── State 1: under limit ────────────────────────────────────────────────────

  it("renders 'Doing (3/10)' when under limit", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={3} wipLimit={10} />,
    );

    // Text content check
    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(3/10)")).toBeTruthy();

    // No overage badge
    expect(container.querySelector(".flow-board__ColumnHeader_badge-overage")).toBeNull();

    // No red class
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(false);

    expect(container).toMatchSnapshot();
  });

  // ── State 2: at limit ───────────────────────────────────────────────────────

  it("renders 'Doing (10/10)' at limit with no badge and no red class", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={10} wipLimit={10} />,
    );

    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(10/10)")).toBeTruthy();

    // No overage badge
    expect(container.querySelector(".flow-board__ColumnHeader_badge-overage")).toBeNull();

    // No red class
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(false);

    expect(container).toMatchSnapshot();
  });

  // ── State 3: over limit ─────────────────────────────────────────────────────

  it("renders 'Doing (11/10)' with +1 badge and red class when over limit", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={11} wipLimit={10} />,
    );

    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(11/10)")).toBeTruthy();

    // Overage badge present and shows "+1"
    const badge = container.querySelector(".flow-board__ColumnHeader_badge-overage");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("+1");

    // Red (over) class applied to root
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(true);

    expect(container).toMatchSnapshot();
  });

  // ── State 4: unlimited (non-empty) ─────────────────────────────────────────

  it("renders 'Doing (11)' with no slash and no badge when wipLimit is null", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={11} wipLimit={null} />,
    );

    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(11)")).toBeTruthy();

    // No slash — the count label should NOT contain "/"
    const countLabel = container.querySelector(".flow-board__ColumnHeader_countLabel");
    expect(countLabel).not.toBeNull();
    expect(countLabel!.textContent).not.toContain("/");

    // No overage badge
    expect(container.querySelector(".flow-board__ColumnHeader_badge-overage")).toBeNull();

    // No red class
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(false);

    expect(container).toMatchSnapshot();
  });

  // ── State 5: empty column ───────────────────────────────────────────────────

  it("renders 'Doing (0)' cleanly when empty and unlimited", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={0} wipLimit={null} />,
    );

    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(0)")).toBeTruthy();

    expect(container.querySelector(".flow-board__ColumnHeader_badge-overage")).toBeNull();
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(false);

    expect(container).toMatchSnapshot();
  });

  it("renders 'Doing (0/10)' cleanly when empty and limited", () => {
    const { container } = render(
      <BoardColumnHeader title="Doing" count={0} wipLimit={10} />,
    );

    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("(0/10)")).toBeTruthy();

    expect(container.querySelector(".flow-board__ColumnHeader_badge-overage")).toBeNull();
    const root = getRoot(container);
    expect(root.classList.contains("flow-board__ColumnHeader-over")).toBe(false);

    expect(container).toMatchSnapshot();
  });
});
