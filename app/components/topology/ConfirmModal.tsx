"use client";

import Panel from "@/app/components/Panel";

export function ConfirmModal({
  title,
  body,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // PLA-0006/00336 — registers the modal under
  // samantha._viewport.app._kind.panel.topology_confirm_modal so
  // Samantha can target it. `panel--bare` strips Panel chrome.
  return (
    <Panel name="topology_confirm_modal" className="panel--bare">
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
        </header>
        <div className="modal__body">
          <p>{body}</p>
        </div>
        <footer className="modal__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn btn--danger btn--sm" : "btn btn--primary btn--sm"}
            onClick={onConfirm}
          >
            Confirm
          </button>
        </footer>
      </div>
    </div>
    </Panel>
  );
}
