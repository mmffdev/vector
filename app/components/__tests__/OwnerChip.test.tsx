import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import OwnerChip from "@/app/components/OwnerChip";

// PLA-0021 / 00459 (WS4-B) — AC45 coverage for the slim OwnerChip
// presentational component. The chip is pure-prop (no fetching), so the
// three branches under test are:
//   1. user with avatar_url → renders display_name + an <img> using src.
//   2. user with avatar_url=null → renders display_name and no <img>.
//   3. user=null → renders the "Unassigned" placeholder and no <img>.
// All three render the same `[data-testid="owner-chip"]` so a parent
// (WorkItemsTree) can locate the chip regardless of the owner state.

describe("OwnerChip (PLA-0021 / 00459)", () => {
  it("renders display_name + <img> when user has an avatar_url", () => {
    const { container } = render(
      <OwnerChip
        user={{
          id: "user-1",
          display_name: "Alice Doe",
          avatar_url: "http://x/y.png",
        }}
      />,
    );

    const chip = screen.getByTestId("owner-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toMatch(/Alice Doe/);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("http://x/y.png");
  });

  it("renders display_name with NO <img> when avatar_url is null", () => {
    const { container } = render(
      <OwnerChip
        user={{
          id: "user-1",
          display_name: "Alice Doe",
          avatar_url: null,
        }}
      />,
    );

    const chip = screen.getByTestId("owner-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toMatch(/Alice Doe/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders 'Unassigned' with NO <img> when user is null", () => {
    const { container } = render(<OwnerChip user={null} />);

    const chip = screen.getByTestId("owner-chip");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toMatch(/Unassigned/);
    expect(container.querySelector("img")).toBeNull();
  });
});
