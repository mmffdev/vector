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
// Tone "warning" paints amber via .page-summary__cell--issue; tone
// "danger" paints red via .page-summary__cell--critical. Both only
// activate when value > 0 — resting cells stay neutral.

import { ReactNode } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import Panel from "@/app/components/Panel";

export type SummaryCellTone = "neutral" | "warning" | "danger";
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

function cellModifier(cell: SummaryCell): string | null {
  if (cell.tone !== "warning" && cell.tone !== "danger") return null;
  const n = typeof cell.value === "number" ? cell.value : Number(cell.value);
  if (!Number.isFinite(n) || n === 0) return null;
  return cell.tone === "danger" ? "page-summary__cell--critical" : "page-summary__cell--issue";
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
    <Panel name={name} className="page-summary-panel" helpable={false}>
      <div
        className="page-summary"
        role="group"
        aria-label="Page summary"
        data-cells={cells.length}
      >
        {cells.map((cell) => {
          const modifier = cellModifier(cell);
          const cellClass = modifier
            ? `page-summary__cell ${modifier}`
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
