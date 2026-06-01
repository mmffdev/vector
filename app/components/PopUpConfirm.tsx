"use client";

import type { ReactNode } from "react";

interface PopUpConfirmProps {
  ariaLabel: string;
  title: string;
  body: ReactNode;
  actions: ReactNode;
  onDismiss: () => void;
}

export function PopUpConfirm({
  ariaLabel,
  title,
  body,
  actions,
  onDismiss,
}: PopUpConfirmProps) {
  return (
    <div className="popup-confirm" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className="popup-confirm__Scrim" onClick={onDismiss} />
      <div className="popup-confirm__Card">
        <h3 className="popup-confirm__Title">{title}</h3>
        <p className="popup-confirm__Body">{body}</p>
        <div className="popup-confirm__Actions">{actions}</div>
      </div>
    </div>
  );
}
