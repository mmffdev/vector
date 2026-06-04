import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GridTreeLines } from "../Grid__Tree_Lines";

function pathData(container: HTMLElement) {
  return Array.from(container.querySelectorAll("path")).map((path) =>
    path.getAttribute("d"),
  );
}

describe("GridTreeLines", () => {
  it("pins a non-last leaf to a through-vertical plus hook", () => {
    const { container } = render(
      <GridTreeLines
        depth={2}
        isLast={false}
        hasChildren={false}
        hasVisibleChildren={false}
        continuations={[true, true]}
      />,
    );

    expect(pathData(container)).toMatchInlineSnapshot(`
      [
        "M5 0 L5 48",
        "M33 0 L33 48",
        "M33 16 Q33 24 41 24 L77 24",
      ]
    `);
  });

  it("pins a true last-of-line leaf to a terminating hook only", () => {
    const { container } = render(
      <GridTreeLines
        depth={1}
        isLast={true}
        hasChildren={false}
        hasVisibleChildren={false}
        continuations={[false]}
      />,
    );

    expect(pathData(container)).toMatchInlineSnapshot(`
      [
        "M5 0 L5 16 Q5 24 13 24 L49 24",
      ]
    `);
  });

  it("keeps continuing ancestors while terminating a last child", () => {
    const { container } = render(
      <GridTreeLines
        depth={2}
        isLast={true}
        hasChildren={false}
        hasVisibleChildren={false}
        continuations={[true, true]}
      />,
    );

    expect(pathData(container)).toMatchInlineSnapshot(`
      [
        "M5 0 L5 48",
        "M33 0 L33 16 Q33 24 41 24 L77 24",
      ]
    `);
  });

  it("pins an expanded branch to a hook plus child drop-stub", () => {
    const { container } = render(
      <GridTreeLines
        depth={1}
        isLast={false}
        hasChildren={true}
        hasVisibleChildren={true}
        continuations={[true]}
      />,
    );

    expect(pathData(container)).toMatchInlineSnapshot(`
      [
        "M5 0 L5 48",
        "M5 16 Q5 24 13 24 L25 24",
        "M33 24 L33 48",
      ]
    `);
  });
});
