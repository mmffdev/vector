"use client";

import { useState, useEffect, useCallback, ReactNode } from "react";
import InlineEditField from "@/app/components/InlineEditField";

// ChartWidget — consistent card frame + expand-to-fullscreen overlay for every
// chart on the dashboard. Wrap any chart component without modifying it.
//
// The title is inline-editable when chartRef is provided; the override is
// persisted in localStorage keyed by chartRef. Without chartRef the title
// renders as a plain heading and is not editable.

const TITLE_OVERRIDE_PREFIX = "vector.chart-title-override.";

function loadOverride(chartRef: string | undefined): string | null {
  if (!chartRef || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TITLE_OVERRIDE_PREFIX + chartRef);
  } catch {
    return null;
  }
}

function saveOverride(chartRef: string, next: string, defaultTitle: string) {
  try {
    if (next === defaultTitle || next.length === 0) {
      window.localStorage.removeItem(TITLE_OVERRIDE_PREFIX + chartRef);
    } else {
      window.localStorage.setItem(TITLE_OVERRIDE_PREFIX + chartRef, next);
    }
  } catch {
    // localStorage unavailable — title change is in-memory only this session.
  }
}

export default function ChartWidget({
  title,
  legend,
  petal = false,
  chartRef,
  children,
}: {
  title?: string;
  /** One or more <span className="chart-legend"> nodes */
  legend?: ReactNode;
  /** Adds chart-card--petal for square radial charts */
  petal?: boolean;
  /** Chart reference ID shown top-left, e.g. "C-01" — also keys the title override */
  chartRef?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const defaultTitle = title ?? "";
  const [override, setOverride] = useState<string | null>(null);

  // Hydrate from localStorage post-mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    setOverride(loadOverride(chartRef));
  }, [chartRef]);

  const effectiveTitle = override ?? defaultTitle;
  const isEditable = Boolean(chartRef);

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

  const onTitleCommit = (next: string) => {
    if (!chartRef) return;
    saveOverride(chartRef, next, defaultTitle);
    setOverride(next === defaultTitle || next.length === 0 ? null : next);
  };

  const expandBtn = (
    <button
      type="button"
      className="btn btn--icon btn--ghost btn--sm chart-widget__expand"
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

  const titleNode = isEditable ? (
    <InlineEditField
      value={effectiveTitle}
      ariaLabel={effectiveTitle ? `Rename chart "${effectiveTitle}"` : "Name chart"}
      onCommit={onTitleCommit}
      clickToEdit
      allowEmpty
      emptyDisplay="Untitled"
      maxLength={120}
      displayClassName="eyebrow chart-widget__toolbar-title"
      inputClassName="chart-widget__toolbar-title-input"
      containerClassName="chart-widget__toolbar-title-edit"
    />
  ) : title ? (
    <h4 className="eyebrow chart-widget__toolbar-title">{title}</h4>
  ) : null;

  const card = (
    <div className={`card chart-card chart-widget${petal ? " chart-card--petal" : ""}`}>
      {/* Toolbar sits above the chart; expand button is here so it never
          overlaps the chart component's own reroll (↻) button */}
      <div className="chart-widget__toolbar">
        <div className="chart-widget__toolbar-left">
          {chartRef && (
            <span className="chart-widget__ref">{chartRef}</span>
          )}
          {titleNode}
        </div>
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
          aria-label={effectiveTitle ? `${effectiveTitle} — expanded` : "Chart — expanded"}
        >
          <div
            className="chart-widget__panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chart-widget__panel-header">
              {effectiveTitle && <span className="eyebrow chart-widget__panel-title">{effectiveTitle}</span>}
              <button
                type="button"
                className="btn btn--icon btn--ghost btn--sm chart-widget__close"
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
