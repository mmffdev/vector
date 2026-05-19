"use client";

// B16.8.10 — useStepUpAction(actionLabel, actionKey)
//
// Wraps a sensitive request so callers don't have to thread the
// per-action reauth dance through their own state. Usage:
//
//   const stepUp = useStepUpAction({
//     actionKey: "delete-workspace",
//     actionLabel: "Delete workspace",
//   });
//
//   // somewhere in onClick:
//   const result = await stepUp.run(async (headers) => {
//     return await apiSite(`/workspaces/${id}`, {
//       method: "DELETE",
//       headers,
//     });
//   });
//   // result is the original fetch return value (or throws).
//
// stepUp.modalProps spreads onto <ReauthModal {...stepUp.modalProps} />.
// The hook owns: open/closed state, in-flight busy state, error
// rendering, password/TOTP submission, the retry-with-proof loop.
//
// Contract with the backend (auth/middleware.go RequireStepUpReauth):
//   - First call: no X-Action-Proof → 409 + Problem.Code=reauth_required.
//     The hook captures, opens the modal, awaits user input.
//   - POST /_site/auth/reauth → 200 with {action_proof, expires_at}.
//   - Retry the original fn with headers={X-Action-Proof: <proof>}.
//     Success → resolve. 401 reauth_invalid (wrong password, expired) →
//     surface error, leave modal open. Other error → reject.

import { useCallback, useRef, useState } from "react";
import { apiSite, ApiError } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

interface ReauthResp {
  action_proof: string;
  expires_at: string;
}

export interface UseStepUpActionOptions {
  // actionKey MUST match the string the backend's
  // RequireStepUpReauth(actionKey) middleware checks against. Mismatch
  // produces a 401 reauth_invalid even with a valid signature.
  actionKey: string;
  // actionLabel is rendered in the modal title. Human-readable.
  actionLabel: string;
}

export interface StepUpFnHeaders {
  [key: string]: string;
}

// run is what the caller invokes. fn receives the headers map to spread
// onto its fetch call — on first attempt it's empty, on retry it carries
// X-Action-Proof. Return type T flows through; throws on unrecoverable
// error.
export type StepUpFn<T> = (headers: StepUpFnHeaders) => Promise<T>;

export interface UseStepUpActionResult {
  run: <T>(fn: StepUpFn<T>) => Promise<T>;
  modalProps: {
    open: boolean;
    actionLabel: string;
    requireTOTP: boolean;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onSubmit: (password: string, totpCode: string) => void;
  };
}

export function useStepUpAction({ actionKey, actionLabel }: UseStepUpActionOptions): UseStepUpActionResult {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending: the original fn + its resolve/reject so the modal's
  // onSubmit can drive it to completion or cancellation.
  const pendingRef = useRef<{
    fn: StepUpFn<unknown>;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  } | null>(null);

  const close = useCallback((cancelled: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    setBusy(false);
    setError(null);
    if (cancelled && pending) {
      pending.reject(new Error("reauth_cancelled"));
    }
  }, []);

  const submit = useCallback(async (password: string, totpCode: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const proof = await apiSite<ReauthResp>("/auth/reauth", {
        method: "POST",
        body: JSON.stringify({
          action_key: actionKey,
          password,
          totp_code: totpCode || undefined,
        }),
      });
      // Retry the original sensitive request with the proof header.
      try {
        const result = await pending.fn({ "X-Action-Proof": proof.action_proof });
        pendingRef.current = null;
        setOpen(false);
        setBusy(false);
        pending.resolve(result);
      } catch (retryErr) {
        if (retryErr instanceof ApiError && retryErr.code === "reauth_invalid") {
          // Proof rejected at the middleware (race: nonce already
          // consumed, or it expired between issue and retry). Leave
          // the modal open for another attempt.
          setError("That confirmation could not be used. Please try again.");
          setBusy(false);
          return;
        }
        if (retryErr instanceof ApiError && retryErr.code === "reauth_required") {
          // Single-use nonce already consumed by a concurrent retry —
          // ask the user to re-enter and mint a fresh one.
          setError("Confirmation expired. Please enter your password again.");
          setBusy(false);
          return;
        }
        // Any other failure is the sensitive endpoint failing for its
        // own reasons — propagate to the caller.
        pendingRef.current = null;
        setOpen(false);
        setBusy(false);
        pending.reject(retryErr);
      }
    } catch (reauthErr) {
      // /auth/reauth itself failed — wrong password or wrong TOTP.
      if (reauthErr instanceof ApiError && reauthErr.status === 401) {
        setError(reauthErr.detail ?? "Your password or code was not accepted.");
        setBusy(false);
        return;
      }
      // Network or 5xx — close + bubble.
      pendingRef.current = null;
      setOpen(false);
      setBusy(false);
      pending.reject(reauthErr);
    }
  }, [actionKey]);

  const run = useCallback(<T,>(fn: StepUpFn<T>) => {
    return new Promise<T>((resolve, reject) => {
      // First attempt: no proof header.
      fn({})
        .then((value) => {
          resolve(value);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.code === "reauth_required") {
            // Stash the fn + open the modal. Submission drives the rest.
            pendingRef.current = {
              fn: fn as StepUpFn<unknown>,
              resolve: resolve as (v: unknown) => void,
              reject,
            };
            setError(null);
            setBusy(false);
            setOpen(true);
            return;
          }
          reject(err);
        });
    });
  }, []);

  return {
    run,
    modalProps: {
      open,
      actionLabel,
      requireTOTP: !!user?.mfa_enrolled,
      busy,
      error,
      onCancel: () => close(true),
      onSubmit: submit,
    },
  };
}
