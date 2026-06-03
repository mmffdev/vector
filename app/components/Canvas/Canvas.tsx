"use client";

import { useState } from "react";
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
   */
  alternateView?: ReactNode;
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
  alternateViewLabel = "View Alternate",
  primaryViewLabel = "Primary",
  onClose,
  closeLabel = "Close",
  rootData,
  canvasData,
}: CanvasProps) {
  const [viewMode, setViewMode] = useState<"primary" | "alternate">("primary");
  const hasSidebar = Boolean(sidebar);
  const hasAlternate = Boolean(alternateView);
  // Sidebar swipes out whenever the alternate canvas is active so the
  // body fills full width.
  const sidebarExpanded = hasSidebar && viewMode === "primary";
  const currentView =
    viewMode === "alternate" && hasAlternate ? alternateView : primaryView;

  return (
    <div
      className="canvas"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-view-mode={viewMode}
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
          {hasAlternate && (
            <button
              type="button"
              className="canvas__Button canvas__Button--ghost"
              onClick={() =>
                setViewMode((m) => (m === "primary" ? "alternate" : "primary"))
              }
              aria-pressed={viewMode === "alternate"}
            >
              {viewMode === "primary" ? alternateViewLabel : primaryViewLabel}
            </button>
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
          {...dataAttributes(canvasData)}
        >
          {currentView}
        </main>
      </div>
    </div>
  );
}
