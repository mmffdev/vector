"use client";

// PLA-0012 — <PageSummaryHeader> primitive (story 00397).
//
// Full-span stat strip rendered above a page's main content. Composes
// <Panel name="page_summary"> so it auto-registers as
// samantha._<viewport>._panel.page_summary, gets the TbHelpHexagon trigger
// + popover + Page Help fetch path for free.
//
// Shape:
//   <PageSummaryHeader
//     cells={[
//       { label: "TOTAL ITEMS", value: 28 },
//       { label: "DEFECTS", value: 6, tone: "warning", glyph: "issue" },
//     ]}
//     search={{ value, onChange, placeholder: "Search…" }}
//   />
//
// Tone "warning" paints amber via .page-summary__cell--issue, but ONLY
// when value > 0 — resting cells (zero defects, zero blocked) stay
// neutral so the strip doesn't shout when there's nothing to act on.

import { ReactNode } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import Panel from "@/app/components/Panel";

export type SummaryCellTone = "neutral" | "warning";
export type SummaryCellGlyph = "issue";

export interface SummaryCell {
  label: string;
  value: number | string;
  tone?: SummaryCellTone;
  glyph?: SummaryCellGlyph;
}

export interface SearchSlotProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

interface PageSummaryHeaderProps {
  cells: SummaryCell[];
  search?: SearchSlotProps;
  name?: string;
}

function cellIsIssue(cell: SummaryCell): boolean {
  if (cell.tone !== "warning") return false;
  const n = typeof cell.value === "number" ? cell.value : Number(cell.value);
  return Number.isFinite(n) && n > 0;
}

function renderGlyph(glyph: SummaryCellGlyph | undefined): ReactNode {
  if (glyph === "issue") {
    return <TbAlertTriangle className="page-summary__glyph" aria-hidden="true" />;
  }
  return null;
}

export default function PageSummaryHeader({
  cells,
  search,
  name = "page_summary",
}: PageSummaryHeaderProps) {
  return (
    <Panel name={name} className="page-summary-panel">
      <div
        className="page-summary"
        role="group"
        aria-label="Page summary"
        data-cells={cells.length}
      >
        {cells.map((cell) => {
          const issue = cellIsIssue(cell);
          const cellClass = issue
            ? "page-summary__cell page-summary__cell--issue"
            : "page-summary__cell";
          return (
            <div key={cell.label} className={cellClass}>
              <span className="tile__label page-summary__label">
                {renderGlyph(cell.glyph)}
                {cell.label}
              </span>
              <span className="t-metric page-summary__value">{cell.value}</span>
            </div>
          );
        })}

        {search && (
          <div className="page-summary__search-slot">
            <input
              type="search"
              className="form__input page-summary__search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? "Search…"}
              aria-label={search.ariaLabel ?? "Search"}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
