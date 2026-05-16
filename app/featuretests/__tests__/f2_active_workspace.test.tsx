// F2 — Frontend workspace awareness.
//
// PLA-0053 feature test. Covers story 00580 (useActiveWorkspace hook).
// Tracker group: `backend-workspace-foundation`, feature `F2`.
//
// Lives at app/featuretests/ to mirror the backend's
// backend/internal/featuretests/ pattern — one file per feature suite,
// permanent regression entry in the Tracker library.
//
// Per the feature-driven testing SOP: this is the only F2 test. Per-
// hook plumbing tests would belong elsewhere; this suite asserts the
// behaviour an integrator can rely on.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";

// Mock the AuthContext module entirely so the hook reads from our
// controllable shim. The real provider hits /me — out of scope here;
// the F1 backend suite covers the JWT→/me path end-to-end.
const mockAuthState: {
  user: {
    id: string;
    subscription_id: string;
    workspace_id: string;
    email: string;
    is_active: boolean;
    [key: string]: unknown;
  } | null;
} = { user: null };

vi.mock("@/app/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}));

beforeEach(() => {
  mockAuthState.user = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("F2 — useActiveWorkspace", () => {
  it("returns null before /me resolves (user is still null)", () => {
    mockAuthState.user = null;
    const { result } = renderHook(() => useActiveWorkspace());
    expect(result.current).toBeNull();
  });

  it("returns null when the user has no workspace_id (legacy JWT pre-PLA-0053)", () => {
    mockAuthState.user = {
      id: "u1",
      subscription_id: "sub-a",
      workspace_id: "",
      email: "f2@example.com",
      is_active: true,
    };
    const { result } = renderHook(() => useActiveWorkspace());
    expect(result.current).toBeNull();
  });

  it("returns the workspace_id when AuthContext carries one", () => {
    mockAuthState.user = {
      id: "u1",
      subscription_id: "sub-a",
      workspace_id: "ws-A-uuid",
      email: "f2@example.com",
      is_active: true,
    };
    const { result } = renderHook(() => useActiveWorkspace());
    expect(result.current).toBe("ws-A-uuid");
  });

  it("re-renders with the new workspace_id when AuthContext refreshes", () => {
    mockAuthState.user = {
      id: "u1",
      subscription_id: "sub-a",
      workspace_id: "ws-A-uuid",
      email: "f2@example.com",
      is_active: true,
    };
    const { result, rerender } = renderHook(() => useActiveWorkspace());
    expect(result.current).toBe("ws-A-uuid");

    // Simulate /me refresh with a different workspace_id (e.g. user
    // switched workspaces and re-issued JWT).
    act(() => {
      mockAuthState.user = {
        id: "u1",
        subscription_id: "sub-a",
        workspace_id: "ws-B-uuid",
        email: "f2@example.com",
        is_active: true,
      };
    });
    rerender();
    expect(result.current).toBe("ws-B-uuid");
  });
});
