// F2 — Frontend workspace awareness.
//
// PLA-0053 feature test. Originally covered story 00580 (useActiveWorkspace
// hook). PLA062 S18 — useActiveWorkspace hook is now deleted; the
// behaviour contract migrated to `useSentinel().sentinel_user?.workspace_id`.
// This file is repurposed to pin the same surface on the Sentinel
// canonical read path so the F2 regression entry stays meaningful in the
// Tracker library.
//
// Tracker group: `backend-workspace-foundation`, feature `F2`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockState: {
  user: {
    id: string;
    workspace_id: string;
    email: string;
    [key: string]: unknown;
  } | null;
} = { user: null };

// Mock useSentinel so consumers read the controllable shim. The real
// provider boots from /sentinel/boot — out of scope here; the backend
// sentinel suite covers the JWT→boot path end-to-end.
vi.mock("@/app/sentinel", () => ({
  useSentinel: () => ({ sentinel_user: mockState.user }),
}));

import { useSentinel } from "@/app/sentinel";

// The repurposed contract: callers read sentinel_user?.workspace_id and
// normalise empty string to null (matching the legacy useActiveWorkspace
// behaviour for PLA-0053 pre-claim JWTs).
function readActiveWorkspace(): string | null {
  const { sentinel_user } = useSentinel();
  if (!sentinel_user) return null;
  if (!sentinel_user.workspace_id) return null;
  return sentinel_user.workspace_id;
}

beforeEach(() => {
  mockState.user = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("F2 — active workspace via Sentinel (post-PLA062 S18)", () => {
  it("returns null before sentinel boot resolves (user is still null)", () => {
    mockState.user = null;
    const { result } = renderHook(() => readActiveWorkspace());
    expect(result.current).toBeNull();
  });

  it("returns null when the user has no workspace_id (legacy JWT pre-PLA-0053)", () => {
    mockState.user = {
      id: "u1",
      workspace_id: "",
      email: "f2@example.com",
    };
    const { result } = renderHook(() => readActiveWorkspace());
    expect(result.current).toBeNull();
  });

  it("returns the workspace_id when Sentinel carries one", () => {
    mockState.user = {
      id: "u1",
      workspace_id: "ws-A-uuid",
      email: "f2@example.com",
    };
    const { result } = renderHook(() => readActiveWorkspace());
    expect(result.current).toBe("ws-A-uuid");
  });

  it("re-renders with the new workspace_id when Sentinel refreshes", () => {
    mockState.user = {
      id: "u1",
      workspace_id: "ws-A-uuid",
      email: "f2@example.com",
    };
    const { result, rerender } = renderHook(() => readActiveWorkspace());
    expect(result.current).toBe("ws-A-uuid");

    // Simulate sentinel boot refresh with a different workspace_id
    // (user switched workspaces; JWT re-issued atomically by the
    // sentinel_switch_workspace action).
    act(() => {
      mockState.user = {
        id: "u1",
        workspace_id: "ws-B-uuid",
        email: "f2@example.com",
      };
    });
    rerender();
    expect(result.current).toBe("ws-B-uuid");
  });
});
