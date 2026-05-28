"use client";

// SaveAsNewViewModal — Rally screenshot 3/4.
// Name input + sharing scope picker. The actual permission gate lives
// on the backend; this modal trusts the caller to provide scope IDs.

import React, { useState } from "react";
import type { Scope } from "./types";

export interface SaveAsNewViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Caller resolves the IDs for each scope option from the sentinel
  // surface and passes them in.
  currentUserID: string;
  currentNodeID?: string | null;
  currentWorkspaceID: string;
  // canShareToNode / canShareToWorkspace gate the dropdown options at
  // the UI layer. Backend enforces — these are UX hints only.
  canShareToNode: boolean;
  canShareToWorkspace: boolean;
  onSave: (req: {
    name: string;
    scope: Scope;
    id_user?: string;
    id_node?: string;
    id_workspace?: string;
  }) => Promise<void>;
}

export function SaveAsNewViewModal(props: SaveAsNewViewModalProps) {
  const {
    isOpen, onClose, currentUserID, currentNodeID, currentWorkspaceID,
    canShareToNode, canShareToWorkspace, onSave,
  } = props;
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("user");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const req: Parameters<typeof onSave>[0] = { name: name.trim(), scope };
      if (scope === "user") req.id_user = currentUserID;
      if (scope === "node" && currentNodeID) req.id_node = currentNodeID;
      if (scope === "workspace") req.id_workspace = currentWorkspaceID;
      await onSave(req);
      setName("");
      setScope("user");
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new saved view"
      className="saved-views__ModalBackdrop"
    >
      <div className="saved-views__Modal">
        <header className="saved-views__ModalHeader">
          <h2 className="saved-views__ModalTitle">Create new saved view</h2>
          <button type="button" className="saved-views__ModalClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="saved-views__ModalBody">
          <label className="saved-views__FieldLabel" htmlFor="saved-views-name">
            Name
          </label>
          <input
            id="saved-views-name"
            type="text"
            className="saved-views__TextInput"
            placeholder="Enter a name for this view"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <p className="saved-views__HelpText">
            Filters, column settings, selected fields, sort order, page size,
            and group-by options will be saved in this view.
          </p>
          <label className="saved-views__FieldLabel" htmlFor="saved-views-scope">
            Sharing
          </label>
          <select
            id="saved-views-scope"
            className="saved-views__Select"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
          >
            <option value="user">Not Shared</option>
            {canShareToNode && currentNodeID && (
              <option value="node">Shared With Team</option>
            )}
            {canShareToWorkspace && (
              <option value="workspace">Shared With Workspace</option>
            )}
          </select>
          {err && <p className="saved-views__ErrorText">{err}</p>}
        </div>
        <footer className="saved-views__ModalFooter">
          <button type="button" className="saved-views__BtnTertiary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="saved-views__BtnPrimary"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
