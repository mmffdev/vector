"use client";

// PLA-0006/00332 — context-menu action handlers lifted out of page.tsx.
//
// Each handler shows the appropriate inline modal (NameInputModal /
// ConfirmModal) then calls topologyApi + reload. Selection clearing
// during archive is delegated back via the setSelectedId / setEditingId
// setters so the page body owns the canonical selection state.

import { useCallback } from "react";
import { topologyApi, type OrgNode } from "@/app/lib/topologyApi";

type NameModalState = {
  title: string;
  placeholder: string;
  initial: string;
  onSubmit: (name: string) => void;
};

type ConfirmModalState = {
  title: string;
  body: string;
  onConfirm: () => void;
  danger?: boolean;
};

export function useTopologyHandlers({
  tree,
  selectedId,
  editingId,
  reload,
  setLoadError,
  setSelectedId,
  setEditingId,
  setCollapsed,
  setNameModal,
  setConfirmModal,
}: {
  tree: OrgNode[] | null;
  selectedId: string | null;
  editingId: string | null;
  reload: () => Promise<void>;
  setLoadError: (msg: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
  setNameModal: (s: NameModalState | null) => void;
  setConfirmModal: (s: ConfirmModalState | null) => void;
}) {
  const addChild = useCallback(
    (parentId: string) => {
      setNameModal({
        title: "Add child node",
        placeholder: "e.g. Engineering",
        initial: "",
        onSubmit: async (name) => {
          try {
            await topologyApi.create({ parent_id: parentId, name });
            // Expand parent so the new child is visible.
            setCollapsed((prev) => {
              const n = new Set(prev);
              n.delete(parentId);
              return n;
            });
            await reload();
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Failed to add node");
          }
        },
      });
    },
    [reload, setLoadError, setCollapsed, setNameModal],
  );

  const duplicateNode = useCallback(
    async (nodeId: string) => {
      try {
        const created = await topologyApi.duplicate(nodeId);
        await reload();
        // If the Edit flyout is open, retarget it to the freshly-created
        // node so the user can keep editing without having to click first.
        setEditingId((prev) => (prev ? created.id : prev));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to duplicate node");
      }
    },
    [reload, setLoadError, setEditingId],
  );

  const archiveNode = useCallback(
    (nodeId: string) => {
      const node = (tree ?? []).find((n) => n.id === nodeId);
      if (!node) return;
      setConfirmModal({
        title: `Delete "${node.name}"?`,
        body: "Archived nodes move to limbo and stop being editable. They can be restored from there.",
        danger: true,
        onConfirm: async () => {
          try {
            await topologyApi.archive(nodeId);
            if (selectedId === nodeId) setSelectedId(null);
            if (editingId === nodeId) setEditingId(null);
            await reload();
          } catch (err) {
            setLoadError(err instanceof Error ? err.message : "Archive failed");
          }
        },
      });
    },
    [tree, selectedId, editingId, reload, setLoadError, setSelectedId, setEditingId, setConfirmModal],
  );

  return { addChild, duplicateNode, archiveNode };
}
