import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import NavigationPie from "@/app/components/NavigationPie";

const STATUSES = [
  { value: "open",        label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review",   label: "In review" },
  { value: "done",        label: "Done" },
  { value: "cancelled",   label: "Cancelled" },
];

describe("<NavigationPie>", () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 400, y: 300, top: 300, left: 400, right: 480, bottom: 332,
      width: 80, height: 32, toJSON: () => ({}),
    })) as unknown as () => DOMRect;
  });

  it("renders the chip in resting state with the label and no pie", () => {
    render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={[]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Status/i })).not.toBeNull();
    expect(document.querySelector(".navigation-pie__Pop")).toBeNull();
  });

  it("opens the pie with one segment per option when the chip is clicked", () => {
    render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={[]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    const segments = document.querySelectorAll(".navigation-pie__Pop_segment");
    expect(segments.length).toBe(STATUSES.length);
    STATUSES.forEach((o) => {
      expect(screen.getByRole("option", { name: o.label })).not.toBeNull();
    });
  });

  it("writes immediately on segment click (no batched commit)", () => {
    const onChange = vi.fn();
    render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(["done"]);
  });

  it("toggles a selected segment off when re-clicked", () => {
    let value: string[] = ["done"];
    const onChange = vi.fn((next: string[]) => { value = next; });
    const { rerender } = render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={value}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={value}
        onChange={onChange}
      />,
    );
    // Re-open after rerender (pie auto-closes-on-commit could be a future
    // option, but for now we keep it open across toggles to let users
    // multi-select fluidly).
    const stillOpen = document.querySelector(".navigation-pie__Pop");
    expect(stillOpen).not.toBeNull();
  });

  it("paints selected segments with the `-selected` modifier", () => {
    render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={["done", "in_progress"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Status/i }));
    const done = screen.getByRole("option", { name: "Done" });
    const inProg = screen.getByRole("option", { name: "In progress" });
    const open = screen.getByRole("option", { name: "Open" });

    expect(done.classList.contains("navigation-pie__Pop_segment-selected")).toBe(true);
    expect(inProg.classList.contains("navigation-pie__Pop_segment-selected")).toBe(true);
    expect(open.classList.contains("navigation-pie__Pop_segment-selected")).toBe(false);
  });

  it("shows the count badge on the chip when 2+ selected", () => {
    render(
      <NavigationPie
        label="Status"
        options={STATUSES}
        selected={["done", "in_progress"]}
        onChange={() => {}}
      />,
    );
    expect(document.querySelector(".navigation-pie__Chip_count")?.textContent).toBe("2");
  });
});
