"use client";

// PLA-0021 / 00454 — useKeyboardGrid. Wires Tab/Enter/Esc/Arrow keyboarding
// across a tree's editable cells. The host marks editable cells with three
// data attributes: `data-editable-cell="true"`, `data-row-id`, `data-col-key`.
// An open inline editor inside a cell marks itself with
// `data-cell-editor="true"` (so the hook does not consume Tab/Arrow keys
// while the editor is owning input).

import { useEffect, type RefObject } from "react";

export interface UseKeyboardGridOpts {
  rootRef: RefObject<HTMLElement | null>;
}

export function useKeyboardGrid({ rootRef }: UseKeyboardGridOpts): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const cellsAll = (): HTMLElement[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>('[data-editable-cell="true"]'),
      );

    const cellsByCol = (colKey: string): HTMLElement[] =>
      cellsAll().filter((c) => c.getAttribute("data-col-key") === colKey);

    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;

      const cell = active.closest<HTMLElement>('[data-editable-cell="true"]');
      if (!cell) return;

      const colKey = cell.getAttribute("data-col-key") ?? "";
      const rowId = cell.getAttribute("data-row-id") ?? "";
      if (!colKey || !rowId) return;

      const inEditor =
        active !== cell &&
        !!active.closest('[data-cell-editor="true"]');

      if (e.key === "Tab" && !inEditor) {
        const cells = cellsAll();
        const idx = cells.findIndex((c) => c === cell);
        const next = e.shiftKey ? cells[idx - 1] : cells[idx + 1];
        if (next) {
          e.preventDefault();
          next.focus();
        }
        return;
      }

      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !inEditor) {
        const col = cellsByCol(colKey);
        const myI = col.findIndex(
          (c) => c.getAttribute("data-row-id") === rowId,
        );
        const next = e.key === "ArrowDown" ? col[myI + 1] : col[myI - 1];
        if (next) {
          e.preventDefault();
          next.focus();
        }
        return;
      }

      if (e.key === "Enter") {
        if (inEditor) {
          // Commit: blur the editor input → cell's onBlur saves + unmounts.
          (active as HTMLElement).blur();
          // Advance to same column on next row after the editor unmounts.
          requestAnimationFrame(() => {
            const col = cellsByCol(colKey);
            const myI = col.findIndex(
              (c) => c.getAttribute("data-row-id") === rowId,
            );
            col[myI + 1]?.focus();
          });
          e.preventDefault();
        } else {
          // Open: synthesise a click on the cell shell — host cells already
          // enter edit mode on click (existing pattern across the catalog).
          cell.click();
          e.preventDefault();
        }
        return;
      }

      if (e.key === "Escape" && inEditor) {
        // Cancel: blur the editor (cells listen for blur and close without
        // commit when no value changed) and refocus the cell shell.
        (active as HTMLElement).blur();
        requestAnimationFrame(() => cell.focus());
        // Do not preventDefault — editors may also listen for Escape.
        return;
      }
    };

    root.addEventListener("keydown", handler, true);
    return () => root.removeEventListener("keydown", handler, true);
  }, [rootRef]);
}
