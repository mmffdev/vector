"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

type Step = "idle" | "enrolling" | "confirming" | "done";

interface EnrollResp {
  otpauth_uri: string;
  recovery_codes: string[];
}

export default function MFASettingsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("idle");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [otpauthUri, setOtpauthUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otpauthUri) {
      QRCode.toDataURL(otpauthUri, { width: 200, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(""));
    }
  }, [otpauthUri]);

  if (!user) return null;

  async function startEnroll() {
    setBusy(true);
    try {
      const res = await api<EnrollResp>("/auth/mfa/enroll", { method: "POST" });
      setOtpauthUri(res.otpauth_uri);
      setRecoveryCodes(res.recovery_codes);
      setStep("enrolling");
      setTimeout(() => confirmInputRef.current?.focus(), 50);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) notify.error("MFA is already enrolled. Disable it first to re-enrol.");
      else notify.error("Failed to start enrollment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (!confirmCode.trim()) return;
    setBusy(true);
    try {
      await api("/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: confirmCode.trim() }),
      });
      setStep("done");
      notify.success("Two-factor authentication is now active.");
    } catch {
      notify.error("Invalid code. Check your authenticator app and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disableMFA() {
    if (!disablePassword) return;
    setBusy(true);
    try {
      await api("/auth/mfa", {
        method: "DELETE",
        body: JSON.stringify({ password: disablePassword }),
      });
      setShowDisable(false);
      setDisablePassword("");
      setStep("idle");
      notify.success("Two-factor authentication has been disabled.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) notify.error("Incorrect password.");
      else notify.error("Failed to disable MFA. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Configure two-factor authentication for your account."
      />
      <PageDescription>
        Two-factor authentication (2FA) adds a second layer of security. When enabled, you will
        need your authenticator app in addition to your password each time you sign in.
      </PageDescription>

      {step === "idle" && (
        <Panel
          name="panel_mfa_enroll"
          title="Two-Factor Authentication"
          description="Protect your account with an authenticator app (Google Authenticator, Authy, etc.)."
        >
          <div className="mfa-settings__idle">
            <p className="mfa-settings__body">
              When enabled, you will be prompted for a 6-digit code from your authenticator app
              each time you sign in. Recovery codes let you access your account if you lose your
              device — store them somewhere safe.
            </p>
            <button
              className="btn btn--primary"
              onClick={startEnroll}
              disabled={busy}
            >
              {busy ? "Starting…" : "Enable two-factor authentication"}
            </button>
          </div>
        </Panel>
      )}

      {step === "enrolling" && (
        <>
          <Panel
            name="panel_mfa_qr"
            title="Scan QR code"
            description="Open your authenticator app and scan the code below."
          >
            <div className="mfa-settings__qr-block">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR code for authenticator app" className="mfa-settings__qr" />
              ) : (
                <p className="mfa-settings__body">Generating QR code…</p>
              )}
              <p className="mfa-settings__uri-hint">
                Can&apos;t scan?{" "}
                <a href={otpauthUri} className="mfa-settings__link">
                  Open in authenticator app
                </a>
              </p>
            </div>
          </Panel>

          <Panel
            name="panel_mfa_recovery"
            title="Save your recovery codes"
            description="These codes can be used once each if you lose access to your authenticator. Store them securely."
          >
            <div className="mfa-settings__recovery-grid">
              {recoveryCodes.map((c) => (
                <code key={c} className="mfa-settings__code">{c}</code>
              ))}
            </div>
          </Panel>

          <Panel
            name="panel_mfa_confirm"
            title="Confirm setup"
            description="Enter the 6-digit code from your authenticator app to activate 2FA."
          >
            <div className="mfa-settings__confirm-row">
              <input
                ref={confirmInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="000000"
                className="form__input form__input--mono mfa-settings__confirm-input"
              />
              <button
                className="btn btn--primary"
                onClick={confirmEnroll}
                disabled={busy || confirmCode.trim().length < 6}
              >
                {busy ? "Verifying…" : "Activate"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => { setStep("idle"); setOtpauthUri(""); setRecoveryCodes([]); setConfirmCode(""); }}
              >
                Cancel
              </button>
            </div>
          </Panel>
        </>
      )}

      {step === "done" && (
        <Panel
          name="panel_mfa_active"
          title="Two-Factor Authentication"
          description="Your account is protected with two-factor authentication."
        >
          <div className="mfa-settings__active">
            <p className="mfa-settings__status-badge">Active</p>
            <p className="mfa-settings__body">
              Two-factor authentication is enabled on your account. You will be asked for a
              code from your authenticator app each time you sign in.
            </p>
            {!showDisable ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setShowDisable(true)}
              >
                Disable two-factor authentication
              </button>
            ) : (
              <div className="mfa-settings__disable-form">
                <p className="mfa-settings__body">Enter your password to confirm.</p>
                <div className="mfa-settings__confirm-row">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Current password"
                    className="form__input"
                  />
                  <button
                    className="btn btn--danger"
                    onClick={disableMFA}
                    disabled={busy || !disablePassword}
                  >
                    {busy ? "Disabling…" : "Disable 2FA"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => { setShowDisable(false); setDisablePassword(""); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}
    </PageContent>
  );
}
