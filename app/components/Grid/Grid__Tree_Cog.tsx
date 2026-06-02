"use client";

// Grid__Tree_Cog — the per-row cog (row-actions) control. Self-contained:
// owns its Escape + outside-click dismiss, calls onOpenChange to notify the
// parent which row's menu is open. Copied from OTV2's ResourceTree CogMenuCell
// (the proven implementation), re-homed under grid__Tree_Cog*.

import { useEffect, useRef } from "react";
import { MdSettings } from "react-icons/md";
import type { GridMenuItem } from "./types";

export interface GridTreeCogProps {
  rowId: string;
  items: GridMenuItem[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function GridTreeCog({
  rowId,
  items,
  open,
  onOpenChange,
}: GridTreeCogProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
        btnRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onOpenChange]);

  return (
    <div
      className="grid__Tree_Lead grid__Tree_Cog"
      role="cell"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        className="grid__Tree_CogBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        data-row-id={rowId}
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <MdSettings size={14} aria-hidden="true" />
      </button>
      {open && items.length > 0 && (
        <div ref={menuRef} role="menu" className="grid__Tree_CogMenu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="grid__Tree_CogMenu_Item"
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                item.onSelect();
                onOpenChange(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
