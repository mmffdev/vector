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
import { useSentinel } from "@/app/sentinel";

export interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onSetStatus?: () => void;
  onSetPriority?: () => void;
  onSetOwner?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  // Slice 6 / value-sprint — extra leading buttons. These render FIRST
  // (left of the existing Status/Priority/Owner trio) and are NOT gated
  // by the work_items.* permission codes — they're host-decided actions
  // (e.g. the value-sprint page's "Add to Sprint" / "Target Sprint"
  // chrome). When the host passes a button with `onClick` undefined the
  // button is rendered disabled (the host can choose to render an empty
  // entry to keep the slot visible).
  //
  // Caller-owned ARIA + label so the bar stays domain-agnostic — it
  // doesn't need to know about sprints, releases, or any future domain.
  leadingButtons?: Array<{
    key: string;
    label: string;
    onClick?: () => void;
    ariaLabel?: string;
    variant?: "primary" | "secondary" | "ghost";
    disabled?: boolean;
  }>;
}

export default function BulkActionBar({
  selectedIds,
  onClear,
  onSetStatus,
  onSetPriority,
  onSetOwner,
  onArchive,
  onDelete,
  leadingButtons,
}: BulkActionBarProps) {
  // Permission codes follow the canonical work_items.* convention.
  // The DB-side seed for these doesn't yet exist (only
  // work_items.settings.edit is in the catalogue today). Until those
  // seeds land in a migration, useHasPermission returns false for
  // unknown codes — which means by default no action buttons render.
  // That's the correct safe behaviour: when permissions tighten up
  // the buttons will appear automatically. Test callers stub the hook.
  const { sentinel_can } = useSentinel();
  const canStatus = sentinel_can("work_items.update");
  const canPriority = sentinel_can("work_items.update");
  const canOwner = sentinel_can("work_items.update");
  const canArchive = sentinel_can("work_items.archive");
  const canDelete = sentinel_can("work_items.delete");

  const count = selectedIds.size;
  if (count === 0) return null;

  return (
    <div
      className="toolbar toolbar--bulk"
      data-testid="bulk-action-bar"
      role="toolbar"
      aria-label="Bulk actions for selected work items"
    >
      {/* DOM order: actions FIRST (left), meta LAST (right). The .toolbar
          flex container uses justify-content: space-between, so the two
          groups sit at opposite ends of the row. Left-padding on
          .toolbar--bulk mirrors the ActionBar above (.tree_accordion-dense__actionbar)
          so the leading button on this row aligns vertically with the
          leading chip ("Create New") of the ActionBar. */}
      <div className="toolbar__actions">
        {/* Slice 6 / value-sprint — host-supplied bulk actions render
            FIRST so domain-specific actions ("Add to Sprint", "Target
            Sprint") read as the primary CTA, with the generic
            Status/Priority/Owner trio sitting to their right. */}
        {leadingButtons?.map((b) => {
          const variantClass =
            b.variant === "primary"
              ? "btn--primary"
              : b.variant === "ghost"
                ? "btn--ghost"
                : "btn--secondary";
          return (
            <button
              key={b.key}
              type="button"
              className={`btn ${variantClass}`}
              onClick={b.onClick}
              aria-label={b.ariaLabel ?? b.label}
              data-action={b.key}
              disabled={b.disabled || !b.onClick}
            >
              {b.label}
            </button>
          );
        })}
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
            className="btn btn--caution"
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
      <div className="toolbar__meta">{count} selected</div>
    </div>
  );
}
