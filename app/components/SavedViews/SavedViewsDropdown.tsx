"use client";

// SavedViewsDropdown — Rally screenshot 5.
// Header dropdown with search + visible-views list + footer actions
// (Clear View, Save As New View, Manage Saved Views).

import React, { useMemo, useState, useEffect, useRef } from "react";
import type { View } from "./types";

export interface SavedViewsDropdownProps {
  views: View[];
  activeView: View | null;
  onSelectView: (viewID: string) => void;
  onClearView: () => void;
  onSaveAsNew: () => void;
  onOpenManage: () => void;
}

export function SavedViewsDropdown(props: SavedViewsDropdownProps) {
  const { views, activeView, onSelectView, onClearView, onSaveAsNew, onOpenManage } = props;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (!wrapRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === "" ? views : views.filter((v) => v.saved_views_name.toLowerCase().includes(q));
  }, [views, search]);

  const triggerLabel = activeView?.saved_views_name ?? "Select or Add Saved and Shared Views";

  return (
    <div ref={wrapRef} className="saved-views__DropdownWrap">
      <button
        type="button"
        className={`saved-views__DropdownTrigger${open ? " saved-views__DropdownTrigger--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="saved-views__DropdownTriggerLabel">{triggerLabel}</span>
        <span className="saved-views__DropdownTriggerCaret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="saved-views__DropdownPanel" role="listbox">
          <input
            type="search"
            className="saved-views__TextInput saved-views__DropdownSearch"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="saved-views__DropdownList">
            {filtered.length === 0 ? (
              <div className="saved-views__DropdownEmpty">No items found</div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.saved_views_id}
                  type="button"
                  role="option"
                  aria-selected={activeView?.saved_views_id === v.saved_views_id}
                  className={`saved-views__DropdownItem${activeView?.saved_views_id === v.saved_views_id ? " saved-views__DropdownItem--active" : ""}`}
                  onClick={() => {
                    onSelectView(v.saved_views_id);
                    setOpen(false);
                  }}
                >
                  {v.saved_views_name}
                </button>
              ))
            )}
          </div>
          <footer className="saved-views__DropdownFooter">
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onClearView(); setOpen(false); }}>
              Clear View
            </button>
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onSaveAsNew(); setOpen(false); }}>
              Save As New View
            </button>
            <button type="button" className="saved-views__DropdownAction" onClick={() => { onOpenManage(); setOpen(false); }}>
              Manage Saved Views
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
