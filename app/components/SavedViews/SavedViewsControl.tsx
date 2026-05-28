"use client";

// SavedViewsControl — the umbrella mount. Composes Dropdown +
// SaveAsNewViewModal + ManageSavedViewsModal + SaveChangesIndicator
// into a single drop-in widget. Per the spec contract: kind + target +
// isDirty + onLoad + onSerialise as the only identity-related props.
//
// The component reads NO globals related to identity. Pinned by
// dev/scripts/lint_savedviews_context_free.py.

import React, { useState, useCallback } from "react";
import { useSavedViews } from "./useSavedViews";
import { SavedViewsDropdown } from "./SavedViewsDropdown";
import { SaveAsNewViewModal } from "./SaveAsNewViewModal";
import { ManageSavedViewsModal } from "./ManageSavedViewsModal";
import { SaveChangesIndicator } from "./SaveChangesIndicator";
import type { Kind, Scope, View } from "./types";

export interface SavedViewsControlProps {
  /** What kind of view this consumer saves — see saved_views_kind. */
  kind: Kind;
  /** Opaque target ID — see saved_views_target convention in §6 of the spec. */
  target: string;
  /** Whether the consumer's current state diverges from active view body. */
  isDirty: boolean;
  /** Called when the user activates a view — consumer applies the body. */
  onLoad: (view: View) => void;
  /** Called by the consumer when SaveChanges fires — return current state. */
  onSerialise: () => unknown;
  /** Called on Clear View — consumer returns to transient state. */
  onClearView: () => void;

  // Identity props for scope IDs. Passed in; never resolved internally.
  currentUserID: string;
  currentNodeID?: string | null;
  currentWorkspaceID: string;
  canShareToNode: boolean;
  canShareToWorkspace: boolean;
}

export function SavedViewsControl(props: SavedViewsControlProps) {
  const {
    kind, target, isDirty, onLoad, onSerialise, onClearView,
    currentUserID, currentNodeID, currentWorkspaceID,
    canShareToNode, canShareToWorkspace,
  } = props;

  const {
    views, activeView, loading, error,
    loadView, clearView, saveChanges, saveAsNew, deleteView, renameView,
  } = useSavedViews({ kind, target });

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelectView = useCallback(
    (viewID: string) => {
      const v = views.find((view) => view.saved_views_id === viewID);
      if (!v) return;
      loadView(viewID);
      onLoad(v);
    },
    [views, loadView, onLoad],
  );

  const handleClearView = useCallback(() => {
    clearView();
    onClearView();
  }, [clearView, onClearView]);

  const handleSaveChanges = useCallback(async () => {
    setSaving(true);
    try {
      await saveChanges({ body: onSerialise() });
    } finally {
      setSaving(false);
    }
  }, [saveChanges, onSerialise]);

  const handleSaveAsNew = useCallback(
    async (req: { name: string; scope: Scope; id_user?: string; id_node?: string; id_workspace?: string }) => {
      const created = await saveAsNew({
        name: req.name,
        scope: req.scope,
        id_user: req.id_user,
        id_node: req.id_node,
        id_workspace: req.id_workspace,
        body: onSerialise(),
      });
      onLoad(created);
    },
    [saveAsNew, onSerialise, onLoad],
  );

  return (
    <div className="saved-views__Control">
      <SavedViewsDropdown
        views={views}
        activeView={activeView}
        onSelectView={handleSelectView}
        onClearView={handleClearView}
        onSaveAsNew={() => setSaveModalOpen(true)}
        onOpenManage={() => setManageModalOpen(true)}
      />
      <SaveChangesIndicator
        isDirty={isDirty}
        hasActiveView={!!activeView}
        onSave={handleSaveChanges}
        saving={saving}
      />
      {loading && <span className="saved-views__StatusText">Loading…</span>}
      {error && <span className="saved-views__ErrorText">{error}</span>}

      <SaveAsNewViewModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        currentUserID={currentUserID}
        currentNodeID={currentNodeID}
        currentWorkspaceID={currentWorkspaceID}
        canShareToNode={canShareToNode}
        canShareToWorkspace={canShareToWorkspace}
        onSave={handleSaveAsNew}
      />

      <ManageSavedViewsModal
        isOpen={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        views={views}
        onRename={async (id, name) => { await renameView(id, name); }}
        onDelete={async (ids) => { for (const id of ids) await deleteView(id); }}
        onChangeScope={async (_id, _scope) => {
          /* Scope-change UI deferred to manage-modal v2 — TD entry. */
        }}
      />
    </div>
  );
}
