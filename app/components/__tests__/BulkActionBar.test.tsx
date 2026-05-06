import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// PLA-0021 / 00456 — BulkActionBar render gating.
// AC3: bar renders only when at least one id is selected; meta reads "N selected".
// AC4: when useHasPermission returns false ONLY for `work_items.delete`, the
// Delete button is absent while Status / Priority / Owner remain.

vi.mock("@/app/contexts/AuthContext", () => ({
  __esModule: true,
  useHasPermission: vi.fn(() => true),
}));

import BulkActionBar from "@/app/components/BulkActionBar";
import { useHasPermission } from "@/app/contexts/AuthContext";

const mockedHasPermission = useHasPermission as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedHasPermission.mockReset();
  // Default: every code grants permission so non-AC4 tests see all buttons.
  mockedHasPermission.mockImplementation(() => true);
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
      mockedHasPermission.mockImplementation((code: string) => {
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
