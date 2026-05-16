import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import React from "react";

import InheritanceIndicator from "@/app/components/InheritanceIndicator";

// PLA-0051 / Story 7 — render states + interaction for the
// per-field inherit/override indicator used on workspace-details.
//
// Four behaviour cases (matches PLA-0051 work_item_backlog Story 7):
//   1. source=workspace → "Override" chip + "Revert to inherited" button
//      fires onRevert
//   2. source=tenant    → "Inherited from Tenant" chip + "Override"
//      button fires onOverride
//   3. source=system_default → "Default" chip + "Override" button
//   4. source=undefined → renders nothing (backward-compat)

describe("InheritanceIndicator (PLA-0051 / Story 7)", () => {
  it("source=workspace renders Override chip + Revert button → fires onRevert", () => {
    const onRevert = vi.fn();
    const onOverride = vi.fn();
    render(
      <InheritanceIndicator
        source="workspace"
        onRevert={onRevert}
        onOverride={onOverride}
      />,
    );
    expect(screen.getByText("Override")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /revert to inherited/i });
    fireEvent.click(btn);
    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onOverride).not.toHaveBeenCalled();
  });

  it("source=tenant renders 'Inherited from Tenant' chip + Override button → fires onOverride", () => {
    const onRevert = vi.fn();
    const onOverride = vi.fn();
    render(
      <InheritanceIndicator
        source="tenant"
        onRevert={onRevert}
        onOverride={onOverride}
      />,
    );
    expect(screen.getByText("Inherited from Tenant")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /^override$/i });
    fireEvent.click(btn);
    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(onRevert).not.toHaveBeenCalled();
  });

  it("source=system_default renders 'Default' chip + Override button", () => {
    const onRevert = vi.fn();
    const onOverride = vi.fn();
    render(
      <InheritanceIndicator
        source="system_default"
        onRevert={onRevert}
        onOverride={onOverride}
      />,
    );
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^override$/i })).toBeTruthy();
  });

  it("source=undefined renders nothing (backward-compat for pre-PLA-0051 wire shape)", () => {
    const { container } = render(
      <InheritanceIndicator
        source={undefined}
        onRevert={() => {}}
        onOverride={() => {}}
      />,
    );
    expect(container.querySelector(".inheritance-indicator__Root")).toBeNull();
  });

  it("busy=true disables the action button", () => {
    render(
      <InheritanceIndicator
        source="workspace"
        onRevert={() => {}}
        onOverride={() => {}}
        busy
      />,
    );
    const btn = screen.getByRole("button", { name: /revert to inherited/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
