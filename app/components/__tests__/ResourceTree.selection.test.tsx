import { describe, it, expect, beforeAll, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import {
  ResourceTree,
  type ColumnDef,
  type SelectionConfig,
} from "@/app/components/ResourceTree";

// PLA-0021 / 00455 — selection prop set on ResourceTree. Mounts the bare
// component (no `name`, so no addressables wrapper) over a 5-row flat fixture
// and exercises the four AC: (1) row toggle adds/removes the row id; (2)
// shift-click range adds the contiguous span over the visible window; (3)
// header toggle-all toggles every visible id at once; (4) header checkbox
// reflects DOM `indeterminate` when the selection is partial.

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
});

// `useResourceRank` is imported even when `dnd` is undefined, but its `api`
// dependency would try to hit the network on the first move. Stub it inertly
// so the bare-mount path stays self-contained.
vi.mock("@/app/lib/api", () => ({
  __esModule: true,
  api: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {},
}));

interface Row {
  id: string;
  title: string;
}

const FIXTURE: Row[] = Array.from({ length: 5 }, (_, i) => ({
  id: `r${i + 1}`,
  title: `Row ${i + 1}`,
}));

const columns: ColumnDef<Row>[] = [
  {
    key: "title",
    label: "Title",
    width: null,
    minWidth: 80,
    render: (row) => row.title,
  },
];

function Harness({ initial = new Set<string>() }: { initial?: Set<string> }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initial);
  const selection: SelectionConfig = {
    mode: "multi",
    selectedIds,
    onSelectionChange: setSelectedIds,
  };
  return (
    <ResourceTree<Row>
      roots={FIXTURE}
      total={FIXTURE.length}
      getId={(r) => r.id}
      getParentId={() => null}
      getChildrenCount={() => 0}
      fetchChildren={async () => []}
      patch={async (_id, _p) => {
        void _id;
        void _p;
        return FIXTURE[0];
      }}
      columns={columns}
      selection={selection}
      ariaLabel="selection harness"
    />
  );
}

const rowCheckbox = (id: string) =>
  document.querySelector<HTMLInputElement>(
    `input[data-selection-row-id="${id}"]`,
  )!;
const headerCheckbox = () =>
  document.querySelector<HTMLInputElement>(
    'input[data-selection-header="true"]',
  )!;

describe("ResourceTree selection (PLA-0021 / 00455)", () => {
  it("toggles a single row id on row-checkbox click", () => {
    render(<Harness />);
    const cb = rowCheckbox("r1");
    expect(cb).toBeTruthy();
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(rowCheckbox("r1").checked).toBe(true);
    fireEvent.click(rowCheckbox("r1"));
    expect(rowCheckbox("r1").checked).toBe(false);
  });

  it("shift-click extends the selection across the visible range", () => {
    render(<Harness />);
    fireEvent.click(rowCheckbox("r1"));
    fireEvent.click(rowCheckbox("r4"), { shiftKey: true });
    expect(rowCheckbox("r1").checked).toBe(true);
    expect(rowCheckbox("r2").checked).toBe(true);
    expect(rowCheckbox("r3").checked).toBe(true);
    expect(rowCheckbox("r4").checked).toBe(true);
    expect(rowCheckbox("r5").checked).toBe(false);
  });

  it("header checkbox toggles every visible row, then clears them", () => {
    render(<Harness />);
    fireEvent.click(headerCheckbox());
    for (const r of FIXTURE) {
      expect(rowCheckbox(r.id).checked).toBe(true);
    }
    fireEvent.click(headerCheckbox());
    for (const r of FIXTURE) {
      expect(rowCheckbox(r.id).checked).toBe(false);
    }
  });

  it("renders the header checkbox as indeterminate when only some rows are selected", () => {
    render(<Harness initial={new Set(["r1", "r3"])} />);
    const head = headerCheckbox();
    expect(head.indeterminate).toBe(true);
    expect(head.checked).toBe(false);
  });
});
