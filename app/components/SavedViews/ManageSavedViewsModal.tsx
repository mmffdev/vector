"use client";

// ManageSavedViewsModal — Rally screenshot 1/2.
// Table list with checkbox column, name, sharing label. Multi-select
// bulk delete via toolbar. Inline rename on name click. Sharing-state
// change via per-row dropdown. Search input filters by name.

import React, { useMemo, useState } from "react";
import type { View, Scope } from "./types";

export interface ManageSavedViewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  views: View[];
  onRename: (viewID: string, name: string) => Promise<void>;
  onDelete: (viewIDs: string[]) => Promise<void>;
  onChangeScope: (viewID: string, scope: Scope) => Promise<void>;
}

function scopeLabel(v: View): string {
  switch (v.saved_views_scope) {
    case "user":      return "Not Shared";
    case "node":      return "Shared with team";
    case "workspace": return "Shared with workspace";
    default:          return v.saved_views_scope;
  }
}

export function ManageSavedViewsModal(props: ManageSavedViewsModalProps) {
  const { isOpen, onClose, views, onRename, onDelete } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [editingID, setEditingID] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  if (!isOpen) return null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q === ""
      ? views
      : views.filter((v) => v.saved_views_name.toLowerCase().includes(q));
  }, [views, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} view${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    await onDelete(ids);
    setSelected(new Set());
  };

  const startRename = (v: View) => {
    setEditingID(v.saved_views_id);
    setEditName(v.saved_views_name);
  };

  const commitRename = async (id: string) => {
    if (editName.trim() && editName.trim() !== views.find((v) => v.saved_views_id === id)?.saved_views_name) {
      await onRename(id, editName.trim());
    }
    setEditingID(null);
    setEditName("");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Saved Views"
      className="saved-views__ModalBackdrop"
    >
      <div className="saved-views__Modal saved-views__Modal--wide">
        <header className="saved-views__ModalHeader">
          <h2 className="saved-views__ModalTitle">Manage Saved Views</h2>
          <button type="button" className="saved-views__ModalClose" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="saved-views__ManageToolbar">
          {selected.size > 0 ? (
            <>
              <span className="saved-views__SelectionCount">
                {selected.size} Item Selected
              </span>
              <button
                type="button"
                className="saved-views__ToolbarLink"
                onClick={() => setSelected(new Set())}
              >
                Deselect All
              </button>
              <button
                type="button"
                className="saved-views__BtnDanger"
                onClick={handleBulkDelete}
              >
                🗑 Delete
              </button>
            </>
          ) : (
            <>
              <input
                type="search"
                className="saved-views__TextInput"
                placeholder="Search views"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="saved-views__TotalCount">Total Views: {filtered.length}</span>
            </>
          )}
        </div>

        <div className="saved-views__ManageList">
          <table className="saved-views__ManageTable">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((v) => selected.has(v.saved_views_id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(filtered.map((v) => v.saved_views_id)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th>Name</th>
                <th>Sharing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.saved_views_id} className={selected.has(v.saved_views_id) ? "saved-views__Row--selected" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(v.saved_views_id)}
                      onChange={() => toggleSelect(v.saved_views_id)}
                    />
                  </td>
                  <td>
                    {editingID === v.saved_views_id ? (
                      <input
                        type="text"
                        className="saved-views__TextInput"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => commitRename(v.saved_views_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(v.saved_views_id);
                          if (e.key === "Escape") { setEditingID(null); setEditName(""); }
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="saved-views__InlineEdit"
                        onClick={() => startRename(v)}
                      >
                        {v.saved_views_name}
                      </button>
                    )}
                  </td>
                  <td>{scopeLabel(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
