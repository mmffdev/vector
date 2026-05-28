"use client";

/**
 * <RadialPillMenu> — pick-one popup that lays N pill-shaped buttons
 * equispaced on a circle around an anchor element. Used by the value-
 * sprint surface to pick a sprint to send a work-item to (the "Target
 * Sprint" affordance, per-row and bulk).
 *
 * Visual contract — every pill is rendered with `.btn .btn--primary`
 * styling so the radial menu inherits the project's button system; no
 * bespoke per-component button look. Pill width auto-fits its label.
 *
 * Geometry — `items.length` pills are placed on a circle of radius
 * `radius` (default 92px) centred on the anchor's centre. The pills
 * are evenly distributed around a full 360° (start angle is at the
 * top, i.e. −90°), which reads naturally regardless of count.
 *
 * Dismissal — backdrop click or Escape key fires `onClose`. The pill
 * click fires `onPick(id)` then `onClose` (the consumer can choose to
 * keep the menu open by passing a no-op onClose, but the default is
 * close-after-pick — matches every other pick-one menu in the app).
 *
 * Accessibility — the backdrop element has `role="dialog"` +
 * `aria-modal="true"` and traps focus on the first pill. Escape
 * dismisses. Each pill carries its label as accessible text.
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import "./r_RadialPillMenu.css";

export interface RadialPillMenuItem {
  id: string;
  label: string;
  /**
   * Optional. When true, the pill renders unclickable (HTML disabled +
   * aria-disabled) so onPick fires only for valid choices. Used by
   * value-sprint's Sprint Status picker to grey-out illegal state-machine
   * transitions (e.g. you cannot go backward from completed → active).
   */
  disabled?: boolean;
  /**
   * Optional. When true, the pill renders with the
   * radial-pill-menu__Pill--current modifier so the user can see at a
   * glance which option is the current value. Click still fires onPick;
   * the caller decides what (if anything) a re-pick means.
   */
  current?: boolean;
}

export interface RadialPillMenuProps {
  /** Visibility — render-gated so the portal is absent when closed. */
  open: boolean;
  /** The DOM element to anchor the circle around (typically a button). */
  anchor: HTMLElement | null;
  /** Items to render as pills. Capped client-side by `maxItems` (8). */
  items: RadialPillMenuItem[];
  /** Optional cap on items rendered. Default 8 — beyond that the geometry stops reading as a wheel. */
  maxItems?: number;
  /** Radius of the circle, in pixels. Default 92px. */
  radius?: number;
  /** Fired when the user picks a pill. */
  onPick: (id: string) => void;
  /** Fired when the user dismisses (backdrop click or Escape). */
  onClose: () => void;
  /** Optional aria-label for the dialog. Defaults to "Pick one". */
  ariaLabel?: string;
}

export default function RadialPillMenu({
  open,
  anchor,
  items,
  maxItems = 8,
  radius = 92,
  onPick,
  onClose,
  ariaLabel = "Pick one",
}: RadialPillMenuProps) {
  // Anchor rect, re-measured on open + on scroll/resize while open. The
  // pills are positioned absolutely against the viewport via the portal,
  // so we read the anchor's getBoundingClientRect each time.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const firstPillRef = useRef<HTMLButtonElement>(null);

  const cappedItems = useMemo(() => items.slice(0, Math.max(0, maxItems)), [items, maxItems]);

  // Measure the anchor on open + on viewport changes. useLayoutEffect so
  // the first paint already has the right coords (no one-frame flicker).
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setAnchorRect(null);
      return;
    }
    const measure = () => setAnchorRect(anchor.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchor]);

  // Escape-to-close + focus the first pill on open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    // Defer focus to next frame so the portal has mounted.
    const t = window.requestAnimationFrame(() => firstPillRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handler);
      window.cancelAnimationFrame(t);
    };
  }, [open, onClose]);

  if (!open || !anchorRect || cappedItems.length === 0) return null;

  const centerX = anchorRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top + anchorRect.height / 2;
  const n = cappedItems.length;

  const content = (
    <div
      className="radial-pill-menu__Backdrop"
      onMouseDown={(e) => {
        // Only close when the backdrop itself is the target — clicking
        // a pill is a child target and handles its own onClick.
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {cappedItems.map((item, i) => {
        // Start at the top (−90°) and walk clockwise so the natural
        // reading order matches the visual order.
        const angle = (-Math.PI / 2) + (i * (2 * Math.PI)) / n;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        return (
          <button
            key={item.id}
            ref={i === 0 ? firstPillRef : undefined}
            type="button"
            className={
              "btn btn--primary radial-pill-menu__Pill" +
              (item.current ? " radial-pill-menu__Pill--current" : "")
            }
            style={{
              // Absolute positioning against the viewport; translate(-50%, -50%)
              // centres the pill on the computed coordinate.
              left: `${x}px`,
              top: `${y}px`,
            }}
            disabled={item.disabled}
            aria-disabled={item.disabled || undefined}
            onClick={() => {
              if (item.disabled) return;
              onPick(item.id);
              onClose();
            }}
            aria-label={item.label}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  // Portal to document.body so the menu floats above page chrome (panels,
  // tables, scroll containers) without z-index whack-a-mole.
  return ReactDOM.createPortal(content, document.body);
}
