"use client";

// <FormLayoutRenderer> — the shared WYSIWYG grid. Both the builder and
// the runtime form render through this so the author sees exactly what
// the end user will (per the design spec, "same renderer → WYSIWYG").
//
// It is purely presentational about GEOMETRY: it lays out rows → cells
// using the template's span percentages via CSS grid. WHAT goes inside a
// cell is delegated to `renderCell`, so the builder can put a draggable
// chip / anchor-point there and the runtime can put a real field input —
// without either duplicating the grid maths.
//
// CSS lives in app/components/FormLayoutBuilder/formLayoutBuilder.css
// under the `flb-*` namespace (root-block__Container_Child_leaf).

import React from "react";
import type { FormRow, FormCell } from "@/app/lib/formLayoutsApi";

export interface RenderCellArgs {
  row: FormRow;
  cell: FormCell;
  rowIndex: number;
  cellIndex: number;
}

export interface FormLayoutRendererProps {
  rows: FormRow[];
  /** Renders the inner content of one cell (chip / anchor / field input). */
  renderCell: (args: RenderCellArgs) => React.ReactNode;
  /** Optional per-row trailing controls (builder: delete-row / template swap). */
  renderRowAside?: (row: FormRow, rowIndex: number) => React.ReactNode;
  /** Extra class on the root (e.g. flb-canvas vs flb-runtime). */
  className?: string;
}

export function FormLayoutRenderer({
  rows,
  renderCell,
  renderRowAside,
  className,
}: FormLayoutRendererProps) {
  return (
    <div className={"flb-grid" + (className ? " " + className : "")}>
      {rows.map((row, rowIndex) => (
        <div key={row.id} className="flb-grid__Row" data-template={row.template}>
          <div
            className="flb-grid__Row_Cells"
            style={gridTemplateFor(row)}
          >
            {row.cells.map((cell, cellIndex) => (
              <div
                key={cell.id}
                className="flb-grid__Cell"
                data-filled={cell.fieldKey ? "true" : "false"}
              >
                {renderCell({ row, cell, rowIndex, cellIndex })}
              </div>
            ))}
          </div>
          {renderRowAside && (
            <div className="flb-grid__Row_Aside">{renderRowAside(row, rowIndex)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// gridTemplateFor turns a row's cell spans into a CSS grid-template-columns
// using fractional units that mirror the span percentages. Using fr keeps
// the columns responsive to the canvas width while preserving the ratio.
function gridTemplateFor(row: FormRow): React.CSSProperties {
  const cols = row.cells.map((c) => `${c.span}fr`).join(" ");
  return { gridTemplateColumns: cols };
}
