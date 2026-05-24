import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// PLA-0021 / 00456 — BulkActionBar render gating.
// AC3: bar renders only when at least one id is selected; meta reads "N selected".
// AC4: when sentinel_can returns false ONLY for `work_items.delete`, the
// Delete button is absent while Status / Priority / Owner remain.
//
// PLA062 S17 — useHasPermission migrated to Sentinel's sentinel_can.
// The mock surface mirrors useSentinel's return shape (only the field
// the component reads needs to be realistic; the rest stay undefined).

const sentinelCan = vi.fn((_code: string) => true);

vi.mock("@/app/sentinel", () => ({
  __esModule: true,
  useSentinel: () => ({ sentinel_can: sentinelCan }),
}));

import BulkActionBar from "@/app/components/BulkActionBar";

beforeEach(() => {
  sentinelCan.mockReset();
  // Default: every code grants permission so non-AC4 tests see all buttons.
  sentinelCan.mockImplementation(() => true);
});

describe("BulkActionBar (PLA-0021 / 00456)", () => {
  describe("AC3 — visibility gated on selection size", () => {
    it("renders when at least one id is selected and reads the count", () => {
      render(
        <BulkActionBar
          selectedIds={new Set(["a", "b"])}
          onClear={() => {}}
        />,
      );
      const bar = screen.getByTestId("bulk-action-bar");
      expect(bar).toBeTruthy();
      expect(bar.textContent).toMatch(/2 selected/);
    });

    it("renders nothing when the selection is empty", () => {
      render(
        <BulkActionBar selectedIds={new Set<string>()} onClear={() => {}} />,
      );
      expect(screen.queryByTestId("bulk-action-bar")).toBeNull();
    });
  });

  describe("AC4 — Delete button hidden when work_items.delete denied", () => {
    it("omits Delete but keeps Status / Priority / Owner when only delete is denied", () => {
      sentinelCan.mockImplementation((code: string) => {
        if (code === "work_items.delete") return false;
        return true;
      });

      render(
        <BulkActionBar
          selectedIds={new Set(["a"])}
          onClear={() => {}}
        />,
      );

      expect(screen.queryByRole("button", { name: /^Delete$/ })).toBeNull();
      expect(screen.getByRole("button", { name: /^Status$/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Priority$/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Owner$/ })).toBeTruthy();
    });
  });
});
