"use client";

import React, { useEffect, useRef, useState } from "react";
import { MdCheckCircle, MdBlock } from "react-icons/md";

interface BlockedToggleProps {
  isBlocked: boolean;
  blockedReason: string | null;
  // Patches { is_blocked } or { blocked_reason } via the form's patch fn.
  // Two args (rather than a single combined patch) so the caller can keep
  // an optimistic-update model with one field per network call.
  onToggle: (next: boolean) => void;
  onReasonChange: (reason: string) => void;
}

// Green/red icon-button + reason textbox revealed when blocked. The
// is_blocked column is the source of truth (toggled by the icon click);
// blocked_reason is independent free text saved on blur.
export function BlockedToggle({ isBlocked, blockedReason, onToggle, onReasonChange }: BlockedToggleProps) {
  const [reason, setReason] = useState(blockedReason ?? "");
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // Keep local reason in sync if the artefact reloads externally.
  useEffect(() => {
    setReason(blockedReason ?? "");
  }, [blockedReason]);

  // When transitioning to blocked, focus the reason textbox so the user
  // can type the reason without an extra click.
  useEffect(() => {
    if (isBlocked && reasonRef.current && !reason) {
      reasonRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBlocked]);

  const className =
    "artefact-inline-form__Blocked" +
    (isBlocked ? " artefact-inline-form__Blocked--blocked" : "");

  return (
    <div className={className}>
      <button
        type="button"
        className="artefact-inline-form__Blocked_Btn"
        onClick={() => onToggle(!isBlocked)}
        aria-pressed={isBlocked}
        aria-label={isBlocked ? "Unblock artefact" : "Mark artefact blocked"}
        title={isBlocked ? "Blocked — click to unblock" : "Click to mark blocked"}
      >
        {isBlocked ? <MdBlock size={20} /> : <MdCheckCircle size={20} />}
        <span className="artefact-inline-form__Blocked_Btn_Label">
          {isBlocked ? "Blocked" : "Not blocked"}
        </span>
      </button>
      {isBlocked && (
        <label className="artefact-inline-form__Blocked_Reason_Field">
          <span className="artefact-inline-form__Field_Label">Reason</span>
          <textarea
            ref={reasonRef}
            className="artefact-inline-form__Field_Input artefact-inline-form__Blocked_Reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => {
              if ((reason || "") !== (blockedReason ?? "")) onReasonChange(reason);
            }}
            placeholder="Why is this blocked?"
          />
        </label>
      )}
    </div>
  );
}

export default BlockedToggle;
