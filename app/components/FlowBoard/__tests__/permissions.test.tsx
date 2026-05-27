// permissions.test.tsx — FB1.3.6
//
// Covers the membership-gate AC for WipGearButton:
//
//   AC 1 — gear visible ONLY when caller is a member of the node.
//
// Tests:
//   1. renders the gear icon when caller is a member
//   2. hides the gear icon when caller is NOT a member
//   3. renders nothing while membership is loading
//
// Strategy:
//   Mock useNodeMembership at the module level so we can drive the three
//   states without a real HTTP call or a real Sentinel provider.
//   RTL + Vitest; no SentinelProvider needed because the hook is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── Mock useNodeMembership ────────────────────────────────────────────────────
//
// We mock the containing module so WipGearButton imports the mocked hook.
// The factory returns a controllable object; each test overrides via
// mockReturnValue before rendering.

const mockUseNodeMembership = vi.fn();

vi.mock(
  "@/app/components/FlowBoard/hooks/useNodeMembership",
  () => ({
    useNodeMembership: (nodeId: string) => mockUseNodeMembership(nodeId),
  }),
);

// Import AFTER the mock is wired so the module picks up the mock.
import { WipGearButton } from "@/app/components/FlowBoard/settings/WipGearButton";

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => {};
const TEST_NODE_ID = "node-abc-123";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WipGearButton — membership gate (AC 1)", () => {
  beforeEach(() => {
    mockUseNodeMembership.mockReset();
  });

  it("renders the gear icon when caller is a member", () => {
    mockUseNodeMembership.mockReturnValue({
      isMember: true,
      isLoading: false,
      error: null,
    });

    render(<WipGearButton topologyNodeId={TEST_NODE_ID} onClick={noop} />);

    const btn = screen.queryByRole("button", { name: /wip limit settings/i });
    expect(btn).not.toBeNull();
  });

  it("hides the gear icon when caller is NOT a member", () => {
    mockUseNodeMembership.mockReturnValue({
      isMember: false,
      isLoading: false,
      error: null,
    });

    render(<WipGearButton topologyNodeId={TEST_NODE_ID} onClick={noop} />);

    const btn = screen.queryByRole("button", { name: /wip limit settings/i });
    expect(btn).toBeNull();
  });

  it("renders nothing while membership is loading", () => {
    mockUseNodeMembership.mockReturnValue({
      isMember: false,
      isLoading: true,
      error: null,
    });

    const { container } = render(
      <WipGearButton topologyNodeId={TEST_NODE_ID} onClick={noop} />,
    );

    // Nothing should be in the DOM.
    expect(container.firstChild).toBeNull();
  });

  it("passes the nodeId through to useNodeMembership", () => {
    mockUseNodeMembership.mockReturnValue({
      isMember: false,
      isLoading: false,
      error: null,
    });

    render(<WipGearButton topologyNodeId={TEST_NODE_ID} onClick={noop} />);

    expect(mockUseNodeMembership).toHaveBeenCalledWith(TEST_NODE_ID);
  });
});
