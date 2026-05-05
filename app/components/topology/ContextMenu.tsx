"use client";

import { useEffect, useRef } from "react";
import Panel from "@/app/components/Panel";
import { useGlobalKey } from "./useGlobalKey";

export function ContextMenu({
  x,
  y,
  hasChildren,
  archivedDescendantCount,
  onAddChild,
  onEdit,
  onDuplicate,
  onViewArchived,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  hasChildren: boolean;
  archivedDescendantCount: number;
  onAddChild: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onViewArchived: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const ctxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ctxRef.current;
    if (!el) return;
    el.style.setProperty("--pos-x", `${x}px`);
    el.style.setProperty("--pos-y", `${y}px`);
  }, [x, y]);
  useGlobalKey("Escape", onClose);
  // PLA-0006/00336 — registers the menu under
  // samantha._viewport.app._kind.panel.topology_context_menu so Samantha
  // can target it. `panel--bare` strips Panel chrome; the existing
  // .topo-ctx-menu styles on the inner div remain the visual surface.
  return (
    <Panel name="topology_context_menu" className="panel--bare">
    <div
      ref={ctxRef}
      className="topo-ctx-menu topo-ctx-menu-pos"
      onMouseDown={stop}
      role="menu"
    >
      <button type="button" role="menuitem" className="btn btn--ghost btn--sm topo-ctx-menu__item" onClick={onAddChild}>
        <span className="topo-ctx-menu__icon">+</span>
        Add {hasChildren ? "department" : "child"}
      </button>
      <button type="button" role="menuitem" className="btn btn--ghost btn--sm topo-ctx-menu__item" onClick={onEdit}>
        <span className="topo-ctx-menu__icon">✎</span>
        Edit
      </button>
      <button type="button" role="menuitem" className="btn btn--ghost btn--sm topo-ctx-menu__item" onClick={onDuplicate}>
        <span className="topo-ctx-menu__icon">⧉</span>
        Duplicate
      </button>
      {archivedDescendantCount > 0 && (
        <button type="button" role="menuitem" className="btn btn--ghost btn--sm topo-ctx-menu__item" onClick={onViewArchived}>
          <span className="topo-ctx-menu__icon">⚠</span>
          View archived ({archivedDescendantCount})
        </button>
      )}
      <hr />
      <button
        type="button"
        role="menuitem"
        className="btn btn--danger btn--sm topo-ctx-menu__item"
        onClick={onDelete}
      >
        <span className="topo-ctx-menu__icon">×</span>
        Delete
      </button>
    </div>
    </Panel>
  );
}
