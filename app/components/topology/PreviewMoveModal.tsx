"use client";

import type { OrgNode, PreviewMoveResult } from "@/app/lib/topologyApi";
import Panel from "@/app/components/Panel";
import { useGlobalKey } from "./useGlobalKey";

export function PreviewMoveModal({
  state,
  tree,
  onConfirm,
  onCancel,
}: {
  state: { nodeId: string; newParentId: string; result: PreviewMoveResult | null };
  tree: OrgNode[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const node = tree.find((n) => n.id === state.nodeId);
  const newParent = tree.find((n) => n.id === state.newParentId);
  const result = state.result;

  useGlobalKey("Escape", onCancel);

  const cycle = result && !result.ok && result.reason === "cycle";

  // PLA-0006/00336 — registers the modal under
  // samantha._viewport.app._kind.panel.topology_preview_move_modal so
  // Samantha can target it. `panel--bare` strips Panel chrome; the
  // existing .modal styles on the inner div remain the visual surface.
  return (
    <Panel name="topology_preview_move_modal" className="panel--bare">
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 className="modal__title">Move {node?.name ?? "node"}</h2>
          <button type="button" className="btn btn--icon btn--ghost btn--sm modal__close" aria-label="Close" onClick={onCancel}>×</button>
        </header>
        <div className="modal__body">
          {cycle ? (
            <p className="form__error">
              This move would create a cycle — you cannot place a node inside its own descendant.
            </p>
          ) : (
            <>
              <p>
                Move <strong>{node?.name}</strong> under <strong>{newParent?.name ?? "(unknown)"}</strong>?
              </p>
              {result?.moving && result.moving.length > 1 && (
                <p>
                  {result.moving.length - 1} descendant
                  {result.moving.length - 1 === 1 ? "" : "s"} will move with it.
                </p>
              )}
            </>
          )}
        </div>
        <footer className="modal__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel
          </button>
          {!cycle && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={onConfirm}
            >
              Commit move
            </button>
          )}
        </footer>
      </div>
    </div>
    </Panel>
  );
}
