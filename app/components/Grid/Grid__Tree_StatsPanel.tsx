"use client";

// Grid__Tree_StatsPanel — optional node-summary band for the canonical tree.
// The primitive stays resource-agnostic: callers supply already-clamped stat
// cells; this component only renders the band consistently above ActionBar.

import { TbAlertTriangle } from "react-icons/tb";

export type GridTreeStatTone = "neutral" | "warning" | "danger";

export interface GridTreeStat {
  key: string;
  label: string;
  value: number | string;
  tone?: GridTreeStatTone;
  glyph?: "issue";
}

export interface GridTreeStatsPanelConfig {
  ariaLabel?: string;
  stats: GridTreeStat[];
}

function statHasValue(value: number | string): boolean {
  if (typeof value === "number") return value > 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function statClassName(stat: GridTreeStat): string {
  if (!statHasValue(stat.value)) return "grid__Tree_StatsPanel_Cell";
  if (stat.tone === "danger") {
    return "grid__Tree_StatsPanel_Cell grid__Tree_StatsPanel_Cell--danger";
  }
  if (stat.tone === "warning") {
    return "grid__Tree_StatsPanel_Cell grid__Tree_StatsPanel_Cell--warning";
  }
  return "grid__Tree_StatsPanel_Cell";
}

function formatValue(value: number | string): string {
  if (typeof value !== "number") return value;
  return new Intl.NumberFormat().format(value);
}

export function GridTreeStatsPanel({
  ariaLabel = "Tree statistics",
  stats,
}: GridTreeStatsPanelConfig) {
  if (stats.length === 0) return null;

  return (
    <section className="grid__Tree_StatsPanel" aria-label={ariaLabel}>
      <div className="grid__Tree_StatsPanel_Grid" role="list">
        {stats.map((stat) => (
          <div key={stat.key} className={statClassName(stat)} role="listitem">
            <span className="grid__Tree_StatsPanel_Label">
              {stat.glyph === "issue" && (
                <TbAlertTriangle
                  className="grid__Tree_StatsPanel_Glyph"
                  aria-hidden="true"
                />
              )}
              {stat.label}
            </span>
            <span className="grid__Tree_StatsPanel_Value">
              {formatValue(stat.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
