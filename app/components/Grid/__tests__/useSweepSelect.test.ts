import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSweepSelect, type SweepResult } from "../useSweepSelect";

function makeContainer(rows: { uuid: string; section: "sprint" | "backlog"; top: number; height: number }[]) {
  const container = document.createElement("div");
  for (const r of rows) {
    const el = document.createElement("div");
    el.setAttribute("data-sweep-row", "");
    el.setAttribute("data-sweep-uuid", r.uuid);
    el.setAttribute("data-sweep-section", r.section);
    el.getBoundingClientRect = () =>
      ({ top: r.top, height: r.height, bottom: r.top + r.height, left: 0, right: 0, width: 0, x: 0, y: r.top, toJSON: () => {} }) as DOMRect;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}
function pointer(clientY: number) {
  return { clientY, pointerId: 1, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} }, preventDefault() {} } as unknown as React.PointerEvent<HTMLElement>;
}

describe("useSweepSelect", () => {
  it("sweeps DOWN over backlog rows → add delta with their uuids", () => {
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
      useSweepSelect({ containerRef, counterRef, onCommit: (r) => { result = r; } }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));
    act(() => p.onPointerMove(pointer(150)));
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptAdd").length).toBe(2);
    act(() => p.onPointerUp(pointer(150)));
    expect(result).toEqual({ direction: "add", uuids: ["b1", "b2"] });
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptAdd").length).toBe(0);
    container.remove();
  });

  it("sweeps UP over sprint rows → remove delta", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let result: SweepResult | null = null;
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit: (r) => { result = r; } }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));
    act(() => p.onPointerMove(pointer(10)));
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptRemove").length).toBe(2);
    act(() => p.onPointerUp(pointer(10)));
    expect(result).toEqual({ direction: "remove", uuids: ["s1", "s2"] });
    container.remove();
  });

  it("a click with no movement commits nothing", () => {
    const container = makeContainer([{ uuid: "b1", section: "backlog", top: 80, height: 40 }]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const onCommit = vi.fn();
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));
    act(() => p.onPointerUp(pointer(70)));
    expect(onCommit).not.toHaveBeenCalled();
    container.remove();
  });

  it("does NOT re-render React between pointerdown and pointerup (perf contract)", () => {
    const container = makeContainer([
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
      { uuid: "b2", section: "backlog", top: 120, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let renders = 0;
    const { result: hook } = renderHook(() => {
      renders++;
      return useSweepSelect({ containerRef, counterRef, onCommit: () => {} });
    });
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));
    const afterDown = renders;
    act(() => { p.onPointerMove(pointer(100)); p.onPointerMove(pointer(140)); p.onPointerMove(pointer(160)); });
    expect(renders).toBe(afterDown); // ZERO renders during moves
    act(() => p.onPointerUp(pointer(160)));
  });
});
