"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { ColourPickerPanel } from "./ColourPicker";

// ColourBlockPicker — Grid__Tree colour-cell variant of ColourPicker.
//
// Trigger is the BTICA-sized .grid__Tree_ColourBadgeBtn (22×18, no radius,
// matches the FlowState block). On click, opens the shared ColourPickerPanel
// (palette + custom hex + clear) in a portal anchored under the button.
// Click-outside dismissal. Renders even when value is null so a colour can
// be assigned from an empty cell.

export interface ColourBlockPickerProps {
  value: string | null | undefined;
  onChange: (hex: string | null) => void;
  ariaLabel?: string;
}

export function ColourBlockPicker({
  value,
  onChange,
  ariaLabel = "Change colour",
}: ColourBlockPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPanelStyle({
      position: "fixed",
      top: r.bottom + 6,
      right: window.innerWidth - r.right,
      zIndex: 9999,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (hex: string) => { onChange(hex); setOpen(false); };
  const clear = () => { onChange(null); setOpen(false); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="grid__Tree_ColourBadgeBtn"
        style={value ? { background: value } : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        title={value ?? ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      />
      {open &&
        ReactDOM.createPortal(
          <ColourPickerPanel
            ref={panelRef}
            value={value}
            onPick={pick}
            onClear={clear}
            style={panelStyle}
          />,
          document.body,
        )}
    </>
  );
}
