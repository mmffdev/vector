"use client";

// B16.8.10 — Per-action step-up reauth modal.
//
// Opened by useStepUpAction when the backend returns 409 reauth_required.
// User enters password (+ TOTP if mfa_enrolled); on submit the hook
// POSTs /auth/reauth, receives a single-use HMAC-signed action_proof,
// and retries the original sensitive request with X-Action-Proof set.
//
// Plain controlled component — no useAuth, no api calls. The hook owns
// the network side so the modal stays trivially testable.

import { useEffect, useRef, useState, FormEvent } from "react";

export interface ReauthModalProps {
  open: boolean;
  // actionLabel is the human-readable name of the sensitive action,
  // e.g. "Delete workspace". Renders inside the modal title so the user
  // knows what they're approving.
  actionLabel: string;
  // requireTOTP flips on the authenticator-code input. The hook reads
  // user.mfa_enrolled from AuthContext to decide.
  requireTOTP: boolean;
  // busy disables submit + closes the input fields visually while the
  // /auth/reauth request is in flight.
  busy: boolean;
  // error is the human-readable message rendered above the form on a
  // failed reauth attempt (wrong password, wrong code, expired nonce).
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string, totpCode: string) => void;
}

export default function ReauthModal({
  open,
  actionLabel,
  requireTOTP,
  busy,
  error,
  onCancel,
  onSubmit,
}: ReauthModalProps) {
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setPassword("");
      setTotp("");
      // Slight delay so the dialog is in the DOM before focus()s.
      const t = setTimeout(() => passwordRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Escape to cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const canSubmit = password.length > 0 && (!requireTOTP || totp.length > 0) && !busy;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(password, totp.replace(/\s/g, ""));
  }

  return (
    <div className="reauth-modal__Backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm: ${actionLabel}`}
        className="reauth-modal__Dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="reauth-modal__Dialog_Title">Confirm: {actionLabel}</h2>
        <p className="reauth-modal__Dialog_Hint">
          Please re-enter your password{requireTOTP ? " and authenticator code" : ""} to confirm this action.
        </p>
        {error && (
          <div className="login__error is-visible" role="alert" aria-live="polite">{error}</div>
        )}
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="form__label">
            Password
            <input
              ref={passwordRef}
              type="password"
              className="form__input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          {requireTOTP && (
            <label className="form__label">
              Authenticator code
              <input
                type="text"
                className="form__input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                disabled={busy}
                placeholder="000000"
                required
              />
            </label>
          )}
          <div className="reauth-modal__Dialog_Actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!canSubmit}
            >
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
