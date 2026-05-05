import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Stub <Panel> to a passthrough — the contract tests target the strip's
// inner DOM (cells, glyph, search slot), not Panel's addressable substrate.
// Panel is exercised separately by its own suite.
vi.mock("@/app/components/Panel", () => ({
  __esModule: true,
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <section className={`panel ${className ?? ""}`} data-testid="panel-stub">
      {children}
    </section>
  ),
}));

import PageSummaryHeader from "@/app/components/PageSummaryHeader";

describe("PageSummaryHeader", () => {
  it("renders an empty cell strip when cells=[] and no search prop", () => {
    const { container } = render(<PageSummaryHeader cells={[]} />);
    const strip = container.querySelector(".page-summary");
    expect(strip).not.toBeNull();
    expect(strip!.getAttribute("data-cells")).toBe("0");
    expect(strip!.querySelectorAll(".page-summary__cell").length).toBe(0);
    expect(container.querySelector(".page-summary__search-slot")).toBeNull();
  });

  it("paints --issue only on warning cells with value > 0", () => {
    const { container } = render(
      <PageSummaryHeader
        cells={[
          { label: "TOTAL ITEMS", value: 28 },
          { label: "DEFECTS", value: 0, tone: "warning" },
          { label: "BLOCKED", value: 6, tone: "warning", glyph: "issue" },
        ]}
      />,
    );
    const cells = container.querySelectorAll<HTMLElement>(".page-summary__cell");
    expect(cells.length).toBe(3);

    const [total, defects, blocked] = cells;
    expect(total.classList.contains("page-summary__cell--issue")).toBe(false);
    expect(defects.classList.contains("page-summary__cell--issue")).toBe(false);
    expect(blocked.classList.contains("page-summary__cell--issue")).toBe(true);

    expect(blocked.querySelector(".page-summary__glyph")).not.toBeNull();
    expect(defects.querySelector(".page-summary__glyph")).toBeNull();

    expect(total.querySelector(".page-summary__value")?.textContent).toBe("28");
    expect(blocked.querySelector(".page-summary__value")?.textContent).toBe("6");
  });

  it("renders the search slot and calls onChange with the new value", () => {
    const onChange = vi.fn();
    render(
      <PageSummaryHeader
        cells={[{ label: "TOTAL", value: 1 }]}
        search={{
          value: "abc",
          onChange,
          placeholder: "Find…",
          ariaLabel: "Find rows",
        }}
      />,
    );
    const input = screen.getByLabelText("Find rows") as HTMLInputElement;
    expect(input.type).toBe("search");
    expect(input.classList.contains("page-summary__search")).toBe(true);
    expect(input.value).toBe("abc");
    expect(input.placeholder).toBe("Find…");

    fireEvent.change(input, { target: { value: "xyz" } });
    expect(onChange).toHaveBeenCalledWith("xyz");
  });
});
