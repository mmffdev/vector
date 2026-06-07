import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSweepSelect, type SweepResult } from "../useSweepSelect";

// Build a container whose [data-sweep-row] children have known geometry. The
// hook reads section + uuid off each and snapshots midpoints on pointerdown.
function makeContainer(
  rows: {
    uuid: string;
    section: "sprint" | "backlog";
    top: number;
    height: number;
  }[],
) {
  const container = document.createElement("div");
  for (const r of rows) {
    const el = document.createElement("div");
    el.setAttribute("data-sweep-row", "");
    el.setAttribute("data-sweep-uuid", r.uuid);
    el.setAttribute("data-sweep-section", r.section);
    el.getBoundingClientRect = () =>
      ({
        top: r.top,
        height: r.height,
        bottom: r.top + r.height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: r.top,
        toJSON: () => {},
      }) as DOMRect;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}
function pointer(clientY: number) {
  return {
    clientY,
    pointerId: 1,
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
    preventDefault() {},
  } as unknown as React.PointerEvent<HTMLElement>;
}
const IN_SPRINT = ".grid__SprintBoundary_Row-inSprint";

describe("useSweepSelect", () => {
  it("dragging the line DOWN tints rows above it and commits the crossed backlog rows", () => {
    // 2 sprint rows (mids 20, 60), 3 backlog rows (mids 100, 140, 180).
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
      { uuid: "b2", section: "backlog", top: 120, height: 40 },
      { uuid: "b3", section: "backlog", top: 160, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let result: SweepResult | null = null;
    const { result: hook } = renderHook(() =>
      useSweepSelect({
        containerRef,
        counterRef,
        onCommit: (r) => {
          result = r;
        },
      }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70))); // initial split = 2 (the two sprint rows)
    act(() => p.onPointerMove(pointer(150))); // line below b2's mid (140), above b3 (180)
    // Rows above the line (s1, s2, b1, b2) are tinted in-sprint.
    expect(container.querySelectorAll(IN_SPRINT).length).toBe(4);
    expect(counterRef.current.textContent).toBe("2 to add");
    act(() => p.onPointerUp(pointer(150)));
    // Crossed backlog rows committed.
    expect(result).toEqual({ direction: "add", uuids: ["b1", "b2"] });
    // Tint cleared on release.
    expect(container.querySelectorAll(IN_SPRINT).length).toBe(0);
    container.remove();
  });

  it("dragging the line UP un-tints sprint rows and commits them to the backlog", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "s3", section: "sprint", top: 80, height: 40 },
      { uuid: "b1", section: "backlog", top: 120, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let result: SweepResult | null = null;
    const { result: hook } = renderHook(() =>
      useSweepSelect({
        containerRef,
        counterRef,
        onCommit: (r) => {
          result = r;
        },
      }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(110))); // initial split = 3 (three sprint rows)
    act(() => p.onPointerMove(pointer(30))); // line above s2's mid (60), below s1 (20)
    // Only s1 stays above the line → 1 tinted.
    expect(container.querySelectorAll(IN_SPRINT).length).toBe(1);
    expect(counterRef.current.textContent).toBe("2 to remove");
    act(() => p.onPointerUp(pointer(30)));
    // s2, s3 crossed below → removed.
    expect(result).toEqual({ direction: "remove", uuids: ["s2", "s3"] });
    container.remove();
  });

  it("a click with no movement commits nothing", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "b1", section: "backlog", top: 40, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const onCommit = vi.fn();
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(30)));
    act(() => p.onPointerUp(pointer(30))); // no move → boundary stays at split
    expect(onCommit).not.toHaveBeenCalled();
    container.remove();
  });

  it("does NOT re-render React between pointerdown and pointerup (perf contract)", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "b1", section: "backlog", top: 40, height: 40 },
      { uuid: "b2", section: "backlog", top: 80, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let renders = 0;
    const { result: hook } = renderHook(() => {
      renders++;
      return useSweepSelect({ containerRef, counterRef, onCommit: () => {} });
    });
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(30)));
    const afterDown = renders;
    act(() => {
      p.onPointerMove(pointer(60));
      p.onPointerMove(pointer(100));
      p.onPointerMove(pointer(120));
    });
    expect(renders).toBe(afterDown); // ZERO renders during moves
    act(() => p.onPointerUp(pointer(120)));
  });

  it("marks the boundary row with the moving line class (no DOM relocation)", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "b1", section: "backlog", top: 40, height: 40 },
      { uuid: "b2", section: "backlog", top: 80, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit: () => {} }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(30))); // split = 1 (s1)
    act(() => p.onPointerMove(pointer(60))); // boundary 2 → b1 is the last in-sprint row
    const LINE = "grid__SprintBoundary_Row-line";
    const lined = container.querySelectorAll(`.${LINE}`);
    expect(lined.length).toBe(1); // exactly one row carries the line
    expect(lined[0].getAttribute("data-sweep-uuid")).toBe("b1"); // the boundary row
    // No DOM relocation: row order is unchanged (s1, b1, b2).
    const order = Array.from(
      container.querySelectorAll("[data-sweep-row]"),
    ).map((el) => el.getAttribute("data-sweep-uuid"));
    expect(order).toEqual(["s1", "b1", "b2"]);
    act(() => p.onPointerUp(pointer(60)));
    // Line cleared on release.
    expect(container.querySelectorAll(`.${LINE}`).length).toBe(0);
    container.remove();
  });
});
