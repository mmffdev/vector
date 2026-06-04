"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Canvas — Vector's reusable fullscreen overlay primitive.
 *
 * The component is intentionally "dumb": it owns the chrome (Vector
 * logo, title bar, status badge, close button, and the optional swap
 * button) and the sidebar-collapse animation. Pages contribute only
 * the things that vary between contexts: title text, sidebar content,
 * and the canvas body content for one or two views.
 *
 * When `alternateView` is provided, the header gains a swap button.
 * Clicking it toggles the canvas body between `primaryView` and
 * `alternateView` and slides the sidebar out of view (the existing
 * 160ms grid-template-columns transition gives the swipe). The page
 * doesn't need to wire any of that — `viewMode` is internal.
 */
export interface CanvasStatus {
  label: string;
  tone: "unsaved" | "draft" | "live" | "new";
  ariaLabel?: string;
}

/**
 * One alternate-canvas entry. Each entry contributes a trigger button
 * to the header; clicking the trigger swaps the canvas body to this
 * view and collapses the sidebar (whichever non-primary view is active
 * shows the canvas full-width).
 */
export interface CanvasView {
  /** Stable identifier — survives re-renders, used as the React key. */
  key: string;
  /** Header trigger button label. */
  label: string;
  /** Canvas body content for this view. */
  content: ReactNode;
}

export interface CanvasProps {
  title: ReactNode;
  subtitle?: ReactNode;
  ariaLabel: string;
  status?: CanvasStatus;
  sidebar?: ReactNode;
  /** Optional toolbar row between the header and the body. */
  toolbar?: ReactNode;
  /** Canvas body shown by default. */
  primaryView: ReactNode;
  /**
   * Optional second canvas body. When supplied, the header renders a
   * swap button; activating it shows this view and collapses the
   * sidebar so the canvas fills the full width.
   *
   * Use `alternateViews` (the array form) when you need MORE than one
   * alternate. `alternateView` + `alternateViewLabel` is kept for
   * backwards compatibility and is treated as a single-entry array.
   */
  alternateView?: ReactNode;
  /**
   * Two or more alternate canvas bodies, one trigger button per entry.
   * Takes precedence over `alternateView` when both are provided. The
   * "primary" button is always rendered first when this is non-empty.
   */
  alternateViews?: CanvasView[];
  /** Swap-button label while the primary view is showing (the click
   *  destination, e.g. "View Map"). Defaults to "View Alternate". */
  alternateViewLabel?: string;
  /** Swap-button label while the alternate view is showing (the click
   *  destination, e.g. "Editor"). Defaults to "Primary". */
  primaryViewLabel?: string;
  onClose: () => void;
  closeLabel?: string;
  rootData?: Record<string, string | number | null | undefined>;
  canvasData?: Record<string, string | number | null | undefined>;
}

function dataAttributes(
  values?: Record<string, string | number | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!values) return out;
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    out[`data-${key}`] = String(value);
  }
  return out;
}

export function Canvas({
  title,
  subtitle,
  ariaLabel,
  status,
  sidebar,
  toolbar,
  primaryView,
  alternateView,
  alternateViews,
  alternateViewLabel = "View Alternate",
  primaryViewLabel = "Primary",
  onClose,
  closeLabel = "Close",
  rootData,
  canvasData,
}: CanvasProps) {
  // Normalise the alternate-view input — preferring the array form
  // when provided so legacy `alternateView` callers keep working.
  const views: CanvasView[] = useMemo(() => {
    if (alternateViews && alternateViews.length > 0) return alternateViews;
    if (alternateView) {
      return [
        { key: "alternate", label: alternateViewLabel, content: alternateView },
      ];
    }
    return [];
  }, [alternateViews, alternateView, alternateViewLabel]);

  const [activeKey, setActiveKey] = useState<string>("primary");
  // Defensive: if the active key disappears between renders (caller
  // shortened the array), fall back to primary.
  const safeActiveKey =
    activeKey === "primary" || views.some((v) => v.key === activeKey)
      ? activeKey
      : "primary";
  const hasSidebar = Boolean(sidebar);
  const hasAlternates = views.length > 0;
  const isPrimary = safeActiveKey === "primary";
  const sidebarExpanded = hasSidebar && isPrimary;
  const currentView = isPrimary
    ? primaryView
    : views.find((v) => v.key === safeActiveKey)?.content ?? primaryView;
  const viewMode = isPrimary ? "primary" : "alternate";

  return (
    <div
      className="canvas"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-view-mode={viewMode}
      data-view-key={safeActiveKey}
      {...dataAttributes(rootData)}
    >
      <header className="canvas__Bar">
        <div className="canvas__Bar_Brand" aria-hidden="true">
          <img
            src="/logo-vector.png"
            alt=""
            className="canvas__Bar_Brand_Logo"
          />
        </div>
        <div className="canvas__Bar_Title">
          <span className="canvas__Bar_Title_Main">
            {title}
            {status && (
              <span
                className={`canvas__Bar_Status canvas__Bar_Status--${status.tone}`}
                aria-label={status.ariaLabel ?? `Status: ${status.label}`}
              >
                {status.label}
              </span>
            )}
          </span>
          {subtitle && (
            <span className="canvas__Bar_Title_Sub">{subtitle}</span>
          )}
        </div>
        <div className="canvas__Bar_Actions">
          {hasAlternates && (
            <>
              <button
                type="button"
                className={
                  isPrimary
                    ? "canvas__Button canvas__Button--ghost is-active"
                    : "canvas__Button canvas__Button--ghost"
                }
                onClick={() => setActiveKey("primary")}
                aria-pressed={isPrimary}
              >
                {primaryViewLabel}
              </button>
              {views.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={
                    safeActiveKey === v.key
                      ? "canvas__Button canvas__Button--ghost is-active"
                      : "canvas__Button canvas__Button--ghost"
                  }
                  onClick={() => setActiveKey(v.key)}
                  aria-pressed={safeActiveKey === v.key}
                >
                  {v.label}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            className="canvas__Button canvas__Button--ghost"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </header>

      {toolbar ? <div className="canvas__Toolbar">{toolbar}</div> : null}

      <div
        className={
          sidebarExpanded ? "canvas__Body has-sidebar-open" : "canvas__Body"
        }
      >
        {sidebar ? (
          <aside
            className="canvas__Sidebar"
            aria-label={`${ariaLabel} sidebar`}
            aria-hidden={!sidebarExpanded}
          >
            {sidebar}
          </aside>
        ) : null}
        <main
          className="canvas__Surface"
          aria-label={`${ariaLabel} canvas`}
          data-view-mode={viewMode}
          data-view-key={safeActiveKey}
          {...dataAttributes(canvasData)}
        >
          {currentView}
        </main>
      </div>
    </div>
  );
}
