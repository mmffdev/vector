"use client";

// /change-password — first-login forced password change.
// Shares the .auth-page / .auth-card surface restyled in 00082
// (.auth-card--wide for the slightly wider 3-field form).
// Story 00085 verified via the same shared classes that drive
// /login and /login/reset/confirm: centred card on --canvas;
// current / new / confirm password inputs at 40px / --radius-md /
// --border-strong; full-width .btn--primary save button; mismatch
// errors render in --danger-bg with --danger 1px border via
// .auth-card__error-slot. No lime-green anywhere.
//
// The page deliberately does not show a cancel/skip button — the
// flow is forced, so the AC's optional .btn--ghost is a no-op
// here.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";
import { AuthFooter } from "@/app/components/AuthFooter";

export default function ChangePasswordPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();

  const [current, setCurrent] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!current) return setErr("Please enter your current password.");
    if (!pwd) return setErr("Please enter a new password.");
    if (pwd.length < 12) return setErr("Password must be at least 12 characters.");
    if (pwd !== pwd2) return setErr("Passwords do not match.");
    setBusy(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current, new: pwd }),
      });
      await refresh();
      router.push("/dashboard");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Change failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div className="auth-page">
      <form onSubmit={onSubmit} className="auth-card auth-card--wide" noValidate>
        <h1 className="auth-card__title">
          <span className="prefix prefix-pink">+++</span> Set a new password
        </h1>
        <p className="auth-card__subtitle">
          Your account requires a password change before continuing.
        </p>
        <label className="form__label">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="form__input"
          />
        </label>
        <label className="form__label">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="form__input"
          />
        </label>
        <label className="form__label">
          Confirm
          <input
            type="password"
            autoComplete="new-password"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            className="form__input"
          />
        </label>
        <p className="form__hint">Minimum 12 characters, at least one letter and one digit.</p>
        <div className={`auth-card__error-slot${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
          {err}
        </div>
        <button type="submit" disabled={busy} className="btn btn--primary btn--block">
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
      <AuthFooter />
    </div>
  );
}
