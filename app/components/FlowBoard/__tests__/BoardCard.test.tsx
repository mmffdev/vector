// BoardCard + CardFieldRenderer tests — FB1.3.5
//
// Coverage map:
//   BoardCard
//     - Renders the field set passed in props (AC: prefs field set)
//     - Renders nothing for unknown field keys (AC: unknown-field no-op)
//     - Renders all 5 default fields cleanly (AC: pure-function field output)
//     - Calls onClick with artefact.id when clicked (AC: click → flyout)
//     - Applies flow-board__Card-dragging class when useDraggable isDragging (AC: drag class)
//
//   CardFieldRenderer (per-field contract — pure function)
//     - id field: renders first-8 chars of artefact.id
//     - title field: renders artefact.title
//     - assignee field: renders value or '—' when null
//     - points field: renders value or '—' when null
//     - priority field: renders value or '—' when null
//
// Note on fallback wiring (AC3): the fallback from prefs 404 → sidecar
// config.card.default_fields is parent-orchestration logic (FB1.3.7).
// BoardCard's contract is: if you pass the default field list, it renders
// the correct output. This test verifies that contract directly.
//
// dnd-kit mock: useDraggable is mocked at the module level. Default mock
// returns isDragging=false, no transform; the "dragging class" test overrides
// the mock factory to return isDragging=true.
//
// Pattern mirrors BoardColumnHeader.test.tsx: RTL + Vitest, css:false
// means class names are raw strings — asserting them directly is reliable.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── dnd-kit mock ──────────────────────────────────────────────────────────────
//
// useDraggable is mocked so tests run in a plain jsdom environment without
// a real DndContext. The mock factory is reset to non-dragging state before
// each test; the dragging-class test overrides it inline.

const mockUseDraggable = vi.fn();

vi.mock("@dnd-kit/core", () => ({
  useDraggable: (...args: unknown[]) => mockUseDraggable(...args),
  CSS: {
    Translate: {
      toString: (transform: { x: number; y: number } | null) =>
        transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : "",
    },
  },
}));

// Reset to the default non-dragging response before each test.
const defaultDraggableReturn = {
  attributes: {},
  listeners: {},
  setNodeRef: vi.fn(),
  transform: null,
  isDragging: false,
};

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { BoardCard } from "@/app/components/FlowBoard/card/BoardCard";
import { CardFieldRenderer } from "@/app/components/FlowBoard/card/CardFieldRenderer";
import type { ArtefactCard } from "@/app/components/FlowBoard/hooks/useFlowBoardData";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseArtefact: ArtefactCard = {
  id: "aabbccdd-1234-5678-9abc-def012345678",
  title: "Allow users to reset password",
  artefactTypeId: "type-uuid-001",
  artefactTypePrefix: "US",
  flowStateId: "state-uuid-todo",
  assignee: "Alice",
  points: 3,
  priority: "High",
};

const nullableArtefact: ArtefactCard = {
  ...baseArtefact,
  assignee: null,
  points: null,
  priority: null,
};

// ── BoardCard tests ───────────────────────────────────────────────────────────

describe("BoardCard (FB1.3.5)", () => {
  // Reset mock before each test.
  // Note: vi.beforeEach is called as a describe-level hook.
  beforeEach(() => {
    mockUseDraggable.mockReturnValue(defaultDraggableReturn);
  });

  // ── AC: card renders the field set passed in props ────────────────────────

  it("renders the field set passed in props and omits unspecified fields", () => {
    render(
      <BoardCard
        artefact={baseArtefact}
        fields={["id", "title"]}
      />,
    );

    // id (first 8 chars) and title must be present
    expect(screen.getByText("aabbccdd")).toBeTruthy();
    expect(screen.getByText("Allow users to reset password")).toBeTruthy();

    // points and priority should NOT be in the DOM
    expect(screen.queryByText("3")).toBeNull();
    expect(screen.queryByText("High")).toBeNull();
  });

  // ── AC: 5 default fields render correctly (pure function output) ──────────

  it("renders all 5 default fields cleanly", () => {
    render(
      <BoardCard
        artefact={baseArtefact}
        fields={["id", "title", "assignee", "points", "priority"]}
      />,
    );

    expect(screen.getByText("aabbccdd")).toBeTruthy();
    expect(screen.getByText("Allow users to reset password")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
  });

  // ── AC: fallback to config.card.default_fields contract (parent wiring) ───
  //
  // The actual 404 → fallback logic lives in FB1.3.7. BoardCard's contract:
  // passing the sidecar default field list produces the expected render.

  it("renders correctly when passed the sidecar default field list (fallback contract)", () => {
    const defaultFields = ["id", "title", "assignee", "points", "priority"];

    render(
      <BoardCard artefact={baseArtefact} fields={defaultFields} />,
    );

    // All 5 fields must be present — this is what the parent passes on 404.
    expect(screen.getByText("aabbccdd")).toBeTruthy();
    expect(screen.getByText("Allow users to reset password")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
  });

  // ── AC: unknown field keys → silent no-op ────────────────────────────────

  it("renders nothing for unknown field keys (silent no-op)", () => {
    const { container } = render(
      <BoardCard
        artefact={baseArtefact}
        fields={["made_up_field", "another_unknown"]}
      />,
    );

    // Root card element must exist
    const card = container.querySelector(".flow-board__Card");
    expect(card).not.toBeNull();

    // No field rows should be rendered
    const fieldRows = container.querySelectorAll(".flow-board__Card_field");
    expect(fieldRows.length).toBe(0);
  });

  // ── AC: onClick → called with artefact.id ────────────────────────────────

  it("calls onClick with artefact.id when the card is clicked", () => {
    const onClickSpy = vi.fn();

    const { container } = render(
      <BoardCard
        artefact={baseArtefact}
        fields={["title"]}
        onClick={onClickSpy}
      />,
    );

    const card = container.querySelector(".flow-board__Card");
    expect(card).not.toBeNull();

    fireEvent.click(card!);

    expect(onClickSpy).toHaveBeenCalledOnce();
    expect(onClickSpy).toHaveBeenCalledWith(baseArtefact.id);
  });

  // ── AC: dragging class applied when isDragging ────────────────────────────

  it("applies flow-board__Card-dragging class when useDraggable returns isDragging=true", () => {
    // Override mock for this test only
    mockUseDraggable.mockReturnValue({
      ...defaultDraggableReturn,
      isDragging: true,
      transform: { x: 12, y: 8, scaleX: 1, scaleY: 1 },
    });

    const { container } = render(
      <BoardCard artefact={baseArtefact} fields={["title"]} />,
    );

    const card = container.querySelector(".flow-board__Card");
    expect(card).not.toBeNull();
    expect(card!.classList.contains("flow-board__Card-dragging")).toBe(true);
  });

  // ── AC: drag suppresses click ─────────────────────────────────────────────

  it("does not call onClick when isDragging is true", () => {
    mockUseDraggable.mockReturnValue({
      ...defaultDraggableReturn,
      isDragging: true,
    });

    const onClickSpy = vi.fn();

    const { container } = render(
      <BoardCard
        artefact={baseArtefact}
        fields={["title"]}
        onClick={onClickSpy}
      />,
    );

    const card = container.querySelector(".flow-board__Card");
    fireEvent.click(card!);

    expect(onClickSpy).not.toHaveBeenCalled();
  });
});

// ── CardFieldRenderer tests ───────────────────────────────────────────────────

describe("CardFieldRenderer (FB1.3.5) — pure-function per-field assertions", () => {
  // ── id ────────────────────────────────────────────────────────────────────

  it("id: renders first 8 chars of artefact.id", () => {
    const { container } = render(
      <CardFieldRenderer field="id" artefact={baseArtefact} />,
    );

    expect(screen.getByText("aabbccdd")).toBeTruthy();
    expect(container.querySelector(".flow-board__Card_field-id")).not.toBeNull();
  });

  // ── title ─────────────────────────────────────────────────────────────────

  it("title: renders artefact.title", () => {
    const { container } = render(
      <CardFieldRenderer field="title" artefact={baseArtefact} />,
    );

    expect(screen.getByText("Allow users to reset password")).toBeTruthy();
    expect(container.querySelector(".flow-board__Card_field-title")).not.toBeNull();
  });

  // ── assignee ──────────────────────────────────────────────────────────────

  it("assignee: renders value when set, '—' when null", () => {
    const { rerender } = render(
      <CardFieldRenderer field="assignee" artefact={baseArtefact} />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();

    rerender(<CardFieldRenderer field="assignee" artefact={nullableArtefact} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // ── points ────────────────────────────────────────────────────────────────

  it("points: renders value when set, '—' when null", () => {
    const { rerender } = render(
      <CardFieldRenderer field="points" artefact={baseArtefact} />,
    );
    expect(screen.getByText("3")).toBeTruthy();

    rerender(<CardFieldRenderer field="points" artefact={nullableArtefact} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // ── priority ──────────────────────────────────────────────────────────────

  it("priority: renders value when set, '—' when null", () => {
    const { rerender } = render(
      <CardFieldRenderer field="priority" artefact={baseArtefact} />,
    );
    expect(screen.getByText("High")).toBeTruthy();

    rerender(<CardFieldRenderer field="priority" artefact={nullableArtefact} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  // ── unknown field ─────────────────────────────────────────────────────────

  it("unknown field: renders null (no DOM output)", () => {
    const { container } = render(
      <CardFieldRenderer field="nonexistent_field" artefact={baseArtefact} />,
    );

    // The fragment renders nothing — container has no child elements
    expect(container.firstElementChild).toBeNull();
  });
});
