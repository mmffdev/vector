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
    points?: number;
  }[],
) {
  const container = document.createElement("div");
  for (const r of rows) {
    const el = document.createElement("div");
    el.setAttribute("data-sweep-row", "");
    el.setAttribute("data-sweep-uuid", r.uuid);
    el.setAttribute("data-sweep-section", r.section);
    if (r.points != null) el.setAttribute("data-sweep-points", String(r.points));
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

  it("writes the live Artefacts count + Points sum above the line to the ref'd pills", () => {
    // 2 sprint rows (5 + 3 pts), 2 backlog rows (8 + 2 pts).
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40, points: 5 },
      { uuid: "s2", section: "sprint", top: 40, height: 40, points: 3 },
      { uuid: "b1", section: "backlog", top: 80, height: 40, points: 8 },
      { uuid: "b2", section: "backlog", top: 120, height: 40, points: 2 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const artefactsRef = { current: document.createElement("span") };
    const pointsRef = { current: document.createElement("span") };
    const { result: hook } = renderHook(() =>
      useSweepSelect({
        containerRef,
        counterRef,
        artefactsRef,
        pointsRef,
        onCommit: () => {},
      }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70))); // split = 2 → at-rest: 2 artefacts, 8 points
    expect(artefactsRef.current.textContent).toBe("2");
    expect(pointsRef.current.textContent).toBe("8"); // 5 + 3
    act(() => p.onPointerMove(pointer(110))); // line over b1 (mid 100) → boundary 3
    expect(artefactsRef.current.textContent).toBe("3");
    expect(pointsRef.current.textContent).toBe("16"); // 5 + 3 + 8
    act(() => p.onPointerUp(pointer(110)));
    container.remove();
  });

  it("treats rows with no data-sweep-points as 0 points", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 }, // no points attr
      { uuid: "b1", section: "backlog", top: 40, height: 40, points: 7 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const pointsRef = { current: document.createElement("span") };
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, pointsRef, onCommit: () => {} }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(10))); // split = 1 (s1, 0 pts)
    expect(pointsRef.current.textContent).toBe("0");
    act(() => p.onPointerMove(pointer(70))); // past b1's mid (60) → include b1 (7 pts)
    expect(pointsRef.current.textContent).toBe("7");
    act(() => p.onPointerUp(pointer(70)));
    container.remove();
  });

  it("sets the velocity colour custom prop on the line ref from points vs cap", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40, points: 10 },
      { uuid: "b1", section: "backlog", top: 40, height: 40, points: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const lineRef = { current: document.createElement("div") };
    const { result: hook } = renderHook(() =>
      useSweepSelect({
        containerRef,
        counterRef,
        lineRef,
        plannedVelocity: 40,
        onCommit: () => {},
      }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(10))); // split = 1, 10 pts vs cap 40 → ratio 0.25 → greenish
    const atRest = lineRef.current.style.getPropertyValue("--divider-colour");
    expect(atRest).toContain("color-mix"); // a blend, not solid
    act(() => p.onPointerMove(pointer(70))); // past b1's mid (60) → 50 pts vs cap 40 → ratio > 1 → red
    expect(lineRef.current.style.getPropertyValue("--divider-colour")).toBe(
      "var(--grid-tree-artefact-divider-red)",
    );
    act(() => p.onPointerUp(pointer(70)));
    container.remove();
  });

  it("rides the floating overlay to the boundary row's bottom edge each move", () => {
    // 2 sprint + 2 backlog, 40px rows → bottoms (container-relative) at
    // 40, 80, 120, 160. The hook reads getBoundingClientRect; with the container
    // at viewport top 0 and scrollTop 0, bottom == row bottom.
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
      { uuid: "b2", section: "backlog", top: 120, height: 40 },
    ]);
    // container rect at viewport origin so container-relative == viewport.
    container.getBoundingClientRect = () =>
      ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const overlayRef = { current: document.createElement("div") };
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, overlayRef, onCommit: () => {} }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70))); // split = 2 → overlay at s2's bottom (80)
    expect(overlayRef.current.style.top).toBe("80px");
    act(() => p.onPointerMove(pointer(110))); // boundary 3 (incl b1) → b1 bottom (120)
    expect(overlayRef.current.style.top).toBe("120px");
    act(() => p.onPointerMove(pointer(10))); // boundary 0 → top of container
    expect(overlayRef.current.style.top).toBe("0px");
    act(() => p.onPointerUp(pointer(10)));
    container.remove();
  });
});
