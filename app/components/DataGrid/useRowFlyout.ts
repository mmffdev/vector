"use client";

// useRowFlyout — owns the single-flyout open/close state for <DataGrid>.
//
// Semantics:
//   • At most one flyout open at a time.
//   • Row whole-row click → open in "view" mode.
//   • Re-click same row+mode → close (toggle).
//   • openFor(rowId, mode) is exposed for row gear menus (duplicate, delete).
//   • Switching mode on the open row does NOT close — same row + new mode.
//   • Opening a different row closes the prior flyout.
//
// The hook owns NO data. fetchDetail + render branches are provided by
// the page-owned DataGridConfig.rowFlyout. The scaffold consults this
// hook for open/close state and where to mount the flyout container.

import { useCallback, useMemo, useState } from "react";
import type { FlyoutMode, FlyoutOpen } from "./types";

export interface UseRowFlyoutArgs {
  /** Controlled mode. */
  value?:    FlyoutOpen | null;
  onChange?: (next: FlyoutOpen | null) => void;
  /** Initial value when uncontrolled. */
  defaultValue?: FlyoutOpen | null;
}

export interface RowProps {
  onClick:         () => void;
  "data-open":     boolean;
  "aria-expanded": boolean;
}

export interface UseRowFlyoutReturn {
  open: FlyoutOpen | null;
  /** Whole-row click handler bundle. */
  getRowProps: (rowId: string) => RowProps;
  /** Open the flyout for a specific row + mode (used by gear menus). */
  openFor: (rowId: string, mode: FlyoutMode) => void;
  /** Switch the mode of the currently-open row. No-op if no row is open. */
  switchMode: (mode: FlyoutMode) => void;
  /** Close the flyout unconditionally. */
  close: () => void;
  /** True when the flyout sibling block should mount under this row. */
  isOpenFor: (rowId: string) => boolean;
}

export function useRowFlyout(args: UseRowFlyoutArgs = {}): UseRowFlyoutReturn {
  const { value, onChange, defaultValue = null } = args;
  const [internal, setInternal] = useState<FlyoutOpen | null>(defaultValue);

  const isControlled = value !== undefined;
  const open = isControlled ? value! : internal;

  const commit = useCallback(
    (next: FlyoutOpen | null) => {
      if (isControlled) onChange?.(next);
      else setInternal(next);
    },
    [isControlled, onChange],
  );

  const openFor = useCallback(
    (rowId: string, mode: FlyoutMode) => {
      // Toggle: same row + same mode → close.
      if (open && open.rowId === rowId && open.mode === mode) {
        commit(null);
        return;
      }
      commit({ rowId, mode });
    },
    [commit, open],
  );

  const switchMode = useCallback(
    (mode: FlyoutMode) => {
      if (!open) return;
      commit({ rowId: open.rowId, mode });
    },
    [commit, open],
  );

  const close = useCallback(() => commit(null), [commit]);

  const getRowProps = useCallback(
    (rowId: string): RowProps => {
      const isOpen = open?.rowId === rowId;
      return {
        onClick: () => openFor(rowId, "view"),
        "data-open":     isOpen,
        "aria-expanded": isOpen,
      };
    },
    [open, openFor],
  );

  const isOpenFor = useCallback(
    (rowId: string) => open?.rowId === rowId,
    [open],
  );

  return useMemo(
    () => ({ open, getRowProps, openFor, switchMode, close, isOpenFor }),
    [close, getRowProps, isOpenFor, open, openFor, switchMode],
  );
}
