"use client";

import { useState, useEffect, useCallback, ReactNode } from "react";

// ChartWidget — consistent card frame + expand-to-fullscreen overlay for every
// chart on the dashboard. Wrap any chart component without modifying it.
//
// Usage:
//   <ChartWidget title="Throughput" legend={<span>…</span>}>
//     <ThroughputChart randomize />
//   </ChartWidget>
//
//   <ChartWidget petal>          // square radial charts
//     <PetalChart randomize />
//   </ChartWidget>

export default function ChartWidget({
  title,
  legend,
  petal = false,
  children,
}: {
  title?: string;
  /** One or more <span className="chart-legend"> nodes */
  legend?: ReactNode;
  /** Adds chart-card--petal for square radial charts */
  petal?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  const close = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded, close]);

  const expandBtn = (
    <button
      type="button"
      className="chart-widget__expand"
      onClick={() => setExpanded(true)}
      aria-label="Expand chart to full screen"
      title="Expand to full screen"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none">
        <path
          d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  const card = (
    <div className={`card chart-card chart-widget${petal ? " chart-card--petal" : ""}`}>
      {/* Toolbar sits above the chart; expand button is here so it never
          overlaps the chart component's own reroll (↻) button */}
      <div className="chart-widget__toolbar">
        {title
          ? <h4 className="eyebrow chart-widget__toolbar-title">{title}</h4>
          : <span />
        }
        {expandBtn}
      </div>
      {children}
      {legend && <div className="chart-card__legend">{legend}</div>}
    </div>
  );

  return (
    <>
      {card}

      {expanded && (
        <div
          className="chart-widget__overlay"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={title ? `${title} — expanded` : "Chart — expanded"}
        >
          <div
            className="chart-widget__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chart-widget__panel-header">
              {title && <span className="eyebrow chart-widget__panel-title">{title}</span>}
              <button
                type="button"
                className="chart-widget__close"
                onClick={close}
                aria-label="Close full screen"
                title="Close (Esc)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none">
                  <path
                    d="M1 1l12 12M13 1L1 13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="chart-widget__panel-chart">
              {children}
            </div>
            {legend && (
              <div className="chart-card__legend chart-widget__panel-legend">{legend}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
