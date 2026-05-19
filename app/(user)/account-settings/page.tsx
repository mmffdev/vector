"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

type MFAStep = "idle" | "enrolling" | "active";

interface EnrollResp { otpauth_uri: string; recovery_codes: string[]; }

function MFASection() {
  const [step, setStep] = useState<MFAStep>("idle");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otpauthUri) {
      QRCode.toDataURL(otpauthUri, { width: 180, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(""));
    }
  }, [otpauthUri]);

  async function startEnroll() {
    setBusy(true);
    try {
      const res = await apiSite<EnrollResp>("/auth/mfa/enroll", { method: "POST" });
      setOtpauthUri(res.otpauth_uri);
      setRecoveryCodes(res.recovery_codes);
      setStep("enrolling");
      setTimeout(() => confirmRef.current?.focus(), 50);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 409) notify.error("2FA is already enrolled — disable it first to re-enrol.");
      else notify.error("Could not start enrollment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    try {
      await apiSite("/auth/mfa/confirm", { method: "POST", body: JSON.stringify({ code: confirmCode.trim() }) });
      setStep("active");
      notify.success("Two-factor authentication is now active.");
    } catch {
      notify.error("Incorrect code — check your app and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disableMFA() {
    setBusy(true);
    try {
      await apiSite("/auth/mfa", { method: "DELETE", body: JSON.stringify({ password: disablePassword }) });
      setStep("idle");
      setShowDisable(false);
      setDisablePassword("");
      notify.success("Two-factor authentication disabled.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) notify.error("Incorrect password.");
      else notify.error("Could not disable 2FA. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "active") {
    return (
      <div className="mfa-section">
        <div className="mfa-section__status">
          <span className="pill pill--success">Enabled</span>
          <p className="mfa-section__body">Your account is protected with an authenticator app. You&apos;ll be asked for a code each time you sign in.</p>
        </div>
        {!showDisable ? (
          <button className="btn btn--danger" onClick={() => setShowDisable(true)}>Disable two-factor authentication</button>
        ) : (
          <div className="mfa-section__disable-row">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Enter your current password to confirm"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="form__input mfa-section__disable-input"
            />
            <button className="btn btn--danger" onClick={disableMFA} disabled={busy || !disablePassword}>
              {busy ? "Disabling…" : "Confirm disable"}
            </button>
            <button className="btn btn--ghost" onClick={() => { setShowDisable(false); setDisablePassword(""); }}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  if (step === "enrolling") {
    return (
      <div className="mfa-section">
        <p className="mfa-section__body">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code it shows to confirm.</p>
        {qrDataUrl && <img src={qrDataUrl} alt="Authenticator QR code" className="mfa-section__qr" />}
        <p className="mfa-section__label">Save these recovery codes — each works once if you lose your phone:</p>
        <div className="mfa-section__recovery-grid">
          {recoveryCodes.map((c) => <code key={c} className="mfa-section__code">{c}</code>)}
        </div>
        <div className="mfa-section__confirm-row">
          <input
            ref={confirmRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            className="form__input form__input--mono mfa-section__code-input"
          />
          <button className="btn btn--primary" onClick={confirmEnroll} disabled={busy || confirmCode.trim().length < 6}>
            {busy ? "Verifying…" : "Activate"}
          </button>
          <button className="btn btn--ghost" onClick={() => { setStep("idle"); setOtpauthUri(""); setRecoveryCodes([]); setConfirmCode(""); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mfa-section">
      <p className="mfa-section__body">Add a second layer of security. Once enabled, you&apos;ll need your authenticator app every time you sign in — a stolen password alone won&apos;t be enough.</p>
      <button className="btn btn--primary" onClick={startEnroll} disabled={busy}>
        {busy ? "Starting…" : "Enable two-factor authentication"}
      </button>
    </div>
  );
}

export default function AccountSettingsPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [emailNotif, setEmailNotif] = useState(true);
  const [productNotif, setProductNotif] = useState(false);
  const [digestNotif, setDigestNotif] = useState(true);

  if (!user) return null;

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage your personal account, profile, and notification preferences." />
      <Panel
        name="panel_account_settings_header"
        className="page-panel-heading"
        title="Account Settings"
        description="Update your display name, manage notification preferences, and configure personal account settings."
      />
      <h3 className="eyebrow">Profile</h3>
      <form
        className="form u-mb-8"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="form__row">
          <label className="form__label">
            Display name
            <input
              type="text"
              className="form__input"
              value={displayName}
              placeholder={user.email.split("@")[0]}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Email
            <input
              type="email"
              className="form__input"
              value={user.email}
              disabled
            />
            <span className="form__hint">
              Contact your workspace administrator to change your sign-in email.
            </span>
          </label>
        </div>
        <div className="u-row u-row--end">
          <button type="submit" className="btn btn--primary">
            Save profile
          </button>
        </div>
      </form>

      <h3 className="eyebrow">Password</h3>
      <form
        className="form u-mb-8"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <div className="form__row">
          <label className="form__label">
            Current password
            <input type="password" className="form__input" autoComplete="current-password" />
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            New password
            <input type="password" className="form__input" autoComplete="new-password" />
            <span className="form__hint">
              At least 12 characters, with one number and one symbol.
            </span>
          </label>
        </div>
        <div className="form__row">
          <label className="form__label">
            Confirm new password
            <input type="password" className="form__input" autoComplete="new-password" />
          </label>
        </div>
        <div className="u-row u-row--end">
          <button type="submit" className="btn btn--primary">
            Update password
          </button>
        </div>
      </form>

      <h3 className="eyebrow">Two-Factor Authentication</h3>
      <MFASection />

      <h3 className="eyebrow">Notifications</h3>
      <div className="form u-row--gap-3">
        <NotifRow
          label="Direct mentions"
          hint="Email me when someone @mentions me in a comment."
          checked={emailNotif}
          onChange={setEmailNotif}
        />
        <NotifRow
          label="Product releases"
          hint="Email me when a new library release ships."
          checked={productNotif}
          onChange={setProductNotif}
        />
        <NotifRow
          label="Weekly digest"
          hint="A Monday morning summary of activity in your portfolios."
          checked={digestNotif}
          onChange={setDigestNotif}
        />
      </div>
    </PageContent>
  );
}

function NotifRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="notif-row">
      <div>
        <div className="notif-row__label">{label}</div>
        <div className="notif-row__hint">{hint}</div>
      </div>
      <label className="form__switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={`pill ${checked ? "pill--success" : "pill--neutral"}`}>
          {checked ? "On" : "Off"}
        </span>
      </label>
    </div>
  );
}
