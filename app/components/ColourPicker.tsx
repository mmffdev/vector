"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { safeInk } from "@/app/lib/colourUtils";

// Shared palette — promoted from the duplicated inline copies in
// app/(user)/workspace-admin/artefacts/artefact-types/page.tsx and
// app/(user)/workspace-admin/flow-states/page.tsx.
const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899", "#f43f5e", "#64748b",
  "#6b7280", "#78716c",
];

export interface ColourPickerProps {
  value: string | null | undefined;
  onChange: (hex: string | null) => void;
  // Controlled-open mode: when `open`/`onOpen`/`onClose` are all provided,
  // the parent owns the open state and the popover renders via a portal
  // positioned next to the swatch. Used by the artefact-types catalogue
  // page where row-level open coordination matters.
  // When `open` is undefined the component manages its own open state
  // and renders the popover inline (the simpler default — used by the
  // ArtefactInlineForm and the flow-states page).
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export function ColourPicker(props: ColourPickerProps) {
  const isControlled = typeof props.open === "boolean";
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? !!props.open : internalOpen;
  const openIt = () => (isControlled ? props.onOpen?.() : setInternalOpen(true));
  const closeIt = () => (isControlled ? props.onClose?.() : setInternalOpen(false));

  const { value, onChange } = props;
  const [custom, setCustom] = useState(value ?? "");

  // Keep `custom` in sync if value changes externally (e.g. parent updates).
  useEffect(() => {
    setCustom(value ?? "");
  }, [value]);

  const swatchRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Portal position (only computed in controlled mode).
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (!isControlled || !open || !swatchRef.current) return;
    const r = swatchRef.current.getBoundingClientRect();
    setPopoverStyle({
      position: "fixed",
      top: r.bottom + 6,
      right: window.innerWidth - r.right,
      zIndex: 9999,
    });
  }, [isControlled, open]);

  // Click-outside dismissal — covers both modes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (swatchRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      closeIt();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (hex: string) => { onChange(hex); setCustom(hex); closeIt(); };
  const clear = () => { onChange(null); setCustom(""); closeIt(); };

  const bg = value ?? "var(--surface-sunken)";
  const ink = value ? safeInk(value) : "var(--ink-muted)";

  const popoverContent = (
    <div className="at-colour-popover" ref={popoverRef} style={isControlled ? popoverStyle : undefined} role="dialog" aria-label="Choose a colour">
      <div className="at-colour-palette">
        {PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`at-colour-cell${value === hex ? " at-colour-cell--active" : ""}`}
            style={{ background: hex }}
            title={hex}
            onClick={() => pick(hex)}
            aria-label={hex}
            aria-pressed={value === hex}
          />
        ))}
      </div>
      <div className="at-colour-custom">
        <label className="at-colour-custom__label">
          Custom hex
          <input
            type="text"
            className="form__input at-colour-custom__input"
            value={custom}
            maxLength={7}
            placeholder="#3B82F6"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = custom.trim().toUpperCase();
                if (/^#[0-9A-F]{6}$/.test(v)) pick(v);
              }
            }}
          />
        </label>
        {/^#[0-9A-Fa-f]{6}$/.test(custom) && custom !== value && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => pick(custom.trim().toUpperCase())}>
            Apply
          </button>
        )}
      </div>
      {value && (
        <button type="button" className="btn btn--sm btn--ghost at-colour-clear" onClick={clear}>
          Remove colour
        </button>
      )}
    </div>
  );

  const popover = !open
    ? null
    : isControlled
      ? ReactDOM.createPortal(popoverContent, document.body)
      : popoverContent;

  return (
    <div className="at-colour-picker">
      <button
        ref={swatchRef}
        type="button"
        className="at-colour-swatch"
        style={{ background: bg, color: ink }}
        title={value ?? "No colour set"}
        onClick={() => (open ? closeIt() : openIt())}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {value ? value.toUpperCase() : "—"}
      </button>
      {popover}
    </div>
  );
}

export default ColourPicker;
