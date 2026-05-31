// Undo/redo history for the Form Layout Builder. The document is one immutable
// `rows` value, so history is a snapshot stack. These tests drive the real hook.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormBuilderState } from "../useFormBuilderState";

describe("useFormBuilderState — undo / redo", () => {
  it("starts with nothing to undo or redo", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo reverses the last action; redo replays it", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    act(() => result.current.addRow("50-50"));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].template).toBe("100");
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[1].template).toBe("50-50");
  });

  it("a fresh edit after undo clears the redo stack", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    act(() => result.current.addRow("50-50"));
    act(() => result.current.undo()); // back to 1 row, redo available
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.addRow("30-30-30")); // new edit
    expect(result.current.canRedo).toBe(false);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[1].template).toBe("30-30-30");
  });

  it("a no-op mutation records no history entry", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("30-30-30"));
    // mergeRight on an occupied/edge cell that can't merge → no change
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 })); // nothing below → no-op
    // only the addRow should be undoable
    act(() => result.current.undo());
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it("reset clears the undo/redo history", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("100"));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.reset([]));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo/redo round-trips a vertical merge", () => {
    const { result } = renderHook(() => useFormBuilderState([]));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.addRow("30-30-30"));
    act(() => result.current.mergeDown({ rowIndex: 0, cellIndex: 0 }));
    expect(result.current.rows[0].cells[0].rowSpan).toBe(2);
    act(() => result.current.undo());
    expect(result.current.rows[0].cells[0].rowSpan).toBeUndefined();
    act(() => result.current.redo());
    expect(result.current.rows[0].cells[0].rowSpan).toBe(2);
  });
});
