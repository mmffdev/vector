// WipSettingsModal.test.tsx — FB1.3.6
//
// Optional insurance tests for the modal component.
//
// Coverage:
//   1. lists every column with its current limit as the input value
//   2. save calls flowBoard.putWip for each changed row (unchanged rows skipped)
//   3. save closes the modal on success (onSaved + onClose called)
//   4. blank input → null (unlimited semantics preserved in PUT payload)
//   5. 403 from putWip → modal closes + toast (membership-lost path)
//   6. non-403 error from putWip → modal stays open (retry path)
//
// Strategy:
//   - flowBoard.putWip is vi.fn()-mocked at the module level.
//   - notify.apiError + notify.error are mocked to assert toast calls.
//   - RTL userEvent drives input changes + button clicks.
//   - No SentinelProvider needed — WipSettingsModal has no direct sentinel dep.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// ── Mock flowBoard ────────────────────────────────────────────────────────────

const mockPutWip = vi.fn();

vi.mock("@/app/lib/apiSite", () => ({
  flowBoard: {
    putWip: (...args: unknown[]) => mockPutWip(...args),
  },
}));

// ── Mock notify ───────────────────────────────────────────────────────────────

const mockNotifyApiError = vi.fn();
const mockNotifyError = vi.fn();

vi.mock("@/app/lib/toast", () => ({
  notify: {
    apiError: (...args: unknown[]) => mockNotifyApiError(...args),
    error: (...args: unknown[]) => mockNotifyError(...args),
  },
}));

// ── Mock ApiError ─────────────────────────────────────────────────────────────

vi.mock("@/app/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message: string) {
      super(message);
      this.status = status;
      this.body = body;
      this.name = "ApiError";
    }
  },
}));

import { WipSettingsModal } from "@/app/components/FlowBoard/settings/WipSettingsModal";
import { ApiError } from "@/app/lib/api";

// ── Test data ─────────────────────────────────────────────────────────────────

const COLUMNS = [
  { flowStateId: "fs-1", flowStateName: "Backlog", currentLimit: 5 },
  { flowStateId: "fs-2", flowStateName: "In Progress", currentLimit: null },
  { flowStateId: "fs-3", flowStateName: "Done", currentLimit: 10 },
];

const BASE_PROPS = {
  isOpen: true,
  onClose: vi.fn(),
  onSaved: vi.fn(),
  topologyNodeId: "node-xyz",
  artefactTypeId: "at-123",
  columns: COLUMNS,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WipSettingsModal", () => {
  beforeEach(() => {
    mockPutWip.mockReset();
    mockNotifyApiError.mockReset();
    mockNotifyError.mockReset();
    BASE_PROPS.onClose = vi.fn();
    BASE_PROPS.onSaved = vi.fn();
  });

  it("lists every column with its current limit as the input value", () => {
    render(<WipSettingsModal {...BASE_PROPS} />);

    // Three inputs — one per column.
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(3);

    // Backlog → "5"
    const backlogInput = screen.getByRole("spinbutton", {
      name: /wip limit for backlog/i,
    }) as HTMLInputElement;
    expect(backlogInput.value).toBe("5");

    // In Progress → "" (unlimited)
    const inProgressInput = screen.getByRole("spinbutton", {
      name: /wip limit for in progress/i,
    }) as HTMLInputElement;
    expect(inProgressInput.value).toBe("");

    // Done → "10"
    const doneInput = screen.getByRole("spinbutton", {
      name: /wip limit for done/i,
    }) as HTMLInputElement;
    expect(doneInput.value).toBe("10");
  });

  it("save calls flowBoard.putWip for each changed row only", async () => {
    mockPutWip.mockResolvedValue({});

    render(<WipSettingsModal {...BASE_PROPS} />);

    // Change Backlog from 5 → 8 (row 1 changes).
    const backlogInput = screen.getByRole("spinbutton", {
      name: /wip limit for backlog/i,
    });
    fireEvent.change(backlogInput, { target: { value: "8" } });

    // Change Done from 10 → "" (null, row 3 changes).
    const doneInput = screen.getByRole("spinbutton", {
      name: /wip limit for done/i,
    });
    fireEvent.change(doneInput, { target: { value: "" } });

    // In Progress stays the same (null → blank, no change).

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockPutWip).toHaveBeenCalledTimes(2);
    });

    expect(mockPutWip).toHaveBeenCalledWith({
      nodeId: "node-xyz",
      flowStateId: "fs-1",
      limit: 8,
    });
    expect(mockPutWip).toHaveBeenCalledWith({
      nodeId: "node-xyz",
      flowStateId: "fs-3",
      limit: null,
    });
  });

  it("save closes the modal on success — calls onSaved + onClose", async () => {
    mockPutWip.mockResolvedValue({});

    render(<WipSettingsModal {...BASE_PROPS} />);

    // Change one value so a PUT is fired.
    const backlogInput = screen.getByRole("spinbutton", {
      name: /wip limit for backlog/i,
    });
    fireEvent.change(backlogInput, { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(BASE_PROPS.onSaved).toHaveBeenCalledTimes(1);
    });
    expect(BASE_PROPS.onClose).toHaveBeenCalledTimes(1);
  });

  it("blank input → null (unlimited) in the PUT payload", async () => {
    mockPutWip.mockResolvedValue({});

    const props = {
      ...BASE_PROPS,
      columns: [
        { flowStateId: "fs-1", flowStateName: "Doing", currentLimit: 3 },
      ],
    };

    render(<WipSettingsModal {...props} />);

    // Clear the input → should send limit: null.
    const doingInput = screen.getByRole("spinbutton", {
      name: /wip limit for doing/i,
    });
    fireEvent.change(doingInput, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockPutWip).toHaveBeenCalledWith({
        nodeId: "node-xyz",
        flowStateId: "fs-1",
        limit: null,
      });
    });
  });

  it("403 from putWip → closes modal + shows membership-lost toast", async () => {
    const err = new ApiError(403, null, "Forbidden");
    mockPutWip.mockRejectedValue(err);

    render(<WipSettingsModal {...BASE_PROPS} />);

    // Change a value so a PUT fires.
    const backlogInput = screen.getByRole("spinbutton", {
      name: /wip limit for backlog/i,
    });
    fireEvent.change(backlogInput, { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(BASE_PROPS.onClose).toHaveBeenCalledTimes(1);
    });
    expect(mockNotifyError).toHaveBeenCalledWith(
      expect.stringMatching(/permission/i),
    );
    expect(BASE_PROPS.onSaved).not.toHaveBeenCalled();
  });

  it("non-403 error → modal stays open + apiError toast shown", async () => {
    const err = new Error("Network failure");
    mockPutWip.mockRejectedValue(err);

    render(<WipSettingsModal {...BASE_PROPS} />);

    const backlogInput = screen.getByRole("spinbutton", {
      name: /wip limit for backlog/i,
    });
    fireEvent.change(backlogInput, { target: { value: "7" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mockNotifyApiError).toHaveBeenCalledTimes(1);
    });
    // Modal stays open — onClose NOT called on failure.
    expect(BASE_PROPS.onClose).not.toHaveBeenCalled();
    expect(BASE_PROPS.onSaved).not.toHaveBeenCalled();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <WipSettingsModal {...BASE_PROPS} isOpen={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
