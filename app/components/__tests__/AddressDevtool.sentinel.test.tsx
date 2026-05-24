import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// PLA062 S17 — AddressDevtool migrated useHasPermission → sentinel_can.
// The component reads `sentinel_can('menu.dev.view')` and gates the
// devtool on the result (combined with NODE_ENV). This test pins the
// sentinel_can wiring contract: the migrated component MUST query the
// canonical menu.dev.view permission on every mount.

const sentinelCan = vi.fn((_code: string) => true);

vi.mock("@/app/sentinel", () => ({
  __esModule: true,
  useSentinel: () => ({ sentinel_can: sentinelCan }),
}));

import AddressDevtool from "@/app/components/AddressDevtool";

describe("AddressDevtool — sentinel_can gating (PLA062 S17)", () => {
  it("calls sentinel_can('menu.dev.view') on mount", () => {
    sentinelCan.mockClear();
    sentinelCan.mockImplementation(() => true);
    render(<AddressDevtool />);
    expect(sentinelCan).toHaveBeenCalledWith("menu.dev.view");
  });
});
