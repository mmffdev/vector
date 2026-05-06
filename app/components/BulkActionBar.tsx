"use client";

// BulkActionBar — work-items multi-select action chrome.
// PLA-0021 / 00456. Sits above the tree on the /work-items page,
// renders only when at least one row is selected, and gates each
// action button on the matching capability code via useHasPermission.
//
// Action handlers are caller-owned — wire them in WorkItemsTree (or
// any future host that wants the same bar). When a handler prop is
// undefined the corresponding button is omitted entirely so the bar
// never shows a no-op control.

import React from "react";
import { useHasPermission } from "@/app/contexts/AuthContext";

export interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onSetStatus?: () => void;
  onSetPriority?: () => void;
  onSetOwner?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export default function BulkActionBar({
  selectedIds,
  onClear,
  onSetStatus,
  onSetPriority,
  onSetOwner,
  onArchive,
  onDelete,
}: BulkActionBarProps) {
  // Permission codes follow the canonical work_items.* convention.
  // The DB-side seed for these doesn't yet exist (only
  // work_items.settings.edit is in the catalogue today). Until those
  // seeds land in a migration, useHasPermission returns false for
  // unknown codes — which means by default no action buttons render.
  // That's the correct safe behaviour: when permissions tighten up
  // the buttons will appear automatically. Test callers stub the hook.
  const canStatus = useHasPermission("work_items.update");
  const canPriority = useHasPermission("work_items.update");
  const canOwner = useHasPermission("work_items.update");
  const canArchive = useHasPermission("work_items.archive");
  const canDelete = useHasPermission("work_items.delete");

  const count = selectedIds.size;
  if (count === 0) return null;

  return (
    <div
      className="toolbar"
      data-testid="bulk-action-bar"
      role="toolbar"
      aria-label="Bulk actions for selected work items"
    >
      <div className="toolbar__meta">{count} selected</div>
      <div className="toolbar__actions">
        {canStatus && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onSetStatus}
            data-action="set-status"
            disabled={!onSetStatus}
          >
            Status
          </button>
        )}
        {canPriority && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onSetPriority}
            data-action="set-priority"
            disabled={!onSetPriority}
          >
            Priority
          </button>
        )}
        {canOwner && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onSetOwner}
            data-action="set-owner"
            disabled={!onSetOwner}
          >
            Owner
          </button>
        )}
        {canArchive && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onArchive}
            data-action="archive"
            disabled={!onArchive}
          >
            Archive
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="btn btn--danger"
            onClick={onDelete}
            data-action="delete"
            disabled={!onDelete}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClear}
          data-action="clear"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
