"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export interface FullscreenCanvasOverlayStatus {
  label: string;
  tone: "unsaved" | "draft" | "live" | "new";
  ariaLabel?: string;
}

export interface FullscreenCanvasOverlayProps {
  title: ReactNode;
  subtitle?: ReactNode;
  ariaLabel: string;
  status?: FullscreenCanvasOverlayStatus;
  sidebar?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
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

export function FullscreenCanvasOverlay({
  title,
  subtitle,
  ariaLabel,
  status,
  sidebar,
  children,
  actions,
  toolbar,
  onClose,
  closeLabel = "Close",
  rootData,
  canvasData,
}: FullscreenCanvasOverlayProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const hasSidebar = Boolean(sidebar);

  return (
    <div
      className="fullscreen-canvas-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      {...dataAttributes(rootData)}
    >
      <header className="fullscreen-canvas-overlay__Bar">
        <button
          type="button"
          className="fullscreen-canvas-overlay__Bar_Brand"
          onClick={() => {
            if (hasSidebar) setSidebarOpen((open) => !open);
          }}
          disabled={!hasSidebar}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={sidebarOpen}
        >
          <img
            src="/logo-vector.png"
            alt="Vector"
            className="fullscreen-canvas-overlay__Bar_Brand_Logo"
          />
        </button>
        <div className="fullscreen-canvas-overlay__Bar_Title">
          <span className="fullscreen-canvas-overlay__Bar_Title_Main">
            {title}
            {status && (
              <span
                className={`fullscreen-canvas-overlay__Bar_Status fullscreen-canvas-overlay__Bar_Status--${status.tone}`}
                aria-label={status.ariaLabel ?? `Status: ${status.label}`}
              >
                {status.label}
              </span>
            )}
          </span>
          {subtitle && (
            <span className="fullscreen-canvas-overlay__Bar_Title_Sub">{subtitle}</span>
          )}
        </div>
        <div className="fullscreen-canvas-overlay__Bar_Actions">
          {actions}
          <button
            type="button"
            className="fullscreen-canvas-overlay__Button fullscreen-canvas-overlay__Button--ghost"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </header>

      {toolbar ? (
        <div className="fullscreen-canvas-overlay__Toolbar">{toolbar}</div>
      ) : null}

      <div
        className={
          sidebarOpen && hasSidebar
            ? "fullscreen-canvas-overlay__Body has-sidebar-open"
            : "fullscreen-canvas-overlay__Body"
        }
      >
        {sidebar ? (
          <aside
            className="fullscreen-canvas-overlay__Sidebar"
            aria-hidden={!sidebarOpen}
            aria-label={`${ariaLabel} sidebar`}
          >
            {sidebar}
          </aside>
        ) : (
          <aside
            className="fullscreen-canvas-overlay__Sidebar"
            aria-hidden="true"
          />
        )}
        <main
          className="fullscreen-canvas-overlay__Canvas"
          aria-label={`${ariaLabel} canvas`}
          {...dataAttributes(canvasData)}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
