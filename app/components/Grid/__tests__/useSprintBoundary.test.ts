// app/components/Grid/__tests__/useSprintBoundary.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSprintBoundary } from "../useSprintBoundary";

// Minimal row identities: 3 in sprint, 3 in backlog.
const sprintIds = ["s1", "s2", "s3"];
const backlogIds = ["b1", "b2", "b3"];

describe("useSprintBoundary", () => {
  it("initial boundaryIndex equals sprint row count", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    expect(result.current.boundaryIndex).toBe(3);
    expect(result.current.inSprintCount).toBe(3);
  });

  it("dragging down by 2 moves first 2 backlog rows into the sprint delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(5)); // 3 sprint + 2 backlog
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual(["b1", "b2"]);
    expect(delta.toBacklog).toEqual([]);
    expect(result.current.inSprintCount).toBe(5);
  });

  it("dragging up by 1 moves last sprint row into the backlog delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(2)); // only first 2 sprint rows stay
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual([]);
    expect(delta.toBacklog).toEqual(["s3"]);
  });

  it("no-op drag yields empty delta", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(3));
    const delta = result.current.computeDelta();
    expect(delta.toSprint).toEqual([]);
    expect(delta.toBacklog).toEqual([]);
  });

  it("clamps boundaryIndex to [0, total]", () => {
    const { result } = renderHook(() =>
      useSprintBoundary(sprintIds, backlogIds),
    );
    act(() => result.current.setBoundaryIndex(99));
    expect(result.current.boundaryIndex).toBe(6);
    act(() => result.current.setBoundaryIndex(-5));
    expect(result.current.boundaryIndex).toBe(0);
  });

  it("resyncs boundaryIndex to the new split when the arrays change (refetch)", () => {
    const { result, rerender } = renderHook(
      ({ s, b }: { s: string[]; b: string[] }) => useSprintBoundary(s, b),
      { initialProps: { s: ["s1", "s2", "s3"], b: ["b1", "b2", "b3"] } },
    );
    expect(result.current.boundaryIndex).toBe(3);
    // Simulate a commit→refetch: 2 backlog rows moved into the sprint.
    rerender({ s: ["s1", "s2", "s3", "b1", "b2"], b: ["b3"] });
    expect(result.current.boundaryIndex).toBe(5);
    expect(result.current.inSprintCount).toBe(5);
    // A fresh delta against the NEW split is a no-op (no phantom crossings).
    expect(result.current.computeDelta()).toEqual({ toSprint: [], toBacklog: [] });
  });

  it("a drag does not get reset by the resync effect", () => {
    const { result, rerender } = renderHook(
      ({ s, b }: { s: string[]; b: string[] }) => useSprintBoundary(s, b),
      { initialProps: { s: ["s1", "s2", "s3"], b: ["b1", "b2", "b3"] } },
    );
    act(() => result.current.setBoundaryIndex(5)); // user drags down 2
    // Parent re-renders with SAME-content arrays (new literals) — common in React.
    rerender({ s: ["s1", "s2", "s3"], b: ["b1", "b2", "b3"] });
    // The drag position must survive: same counts ⇒ effect does NOT refire.
    expect(result.current.boundaryIndex).toBe(5);
  });
});
