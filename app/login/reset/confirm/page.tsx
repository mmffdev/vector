"use client";

// /login/reset/confirm — set new password from a reset token.
// Shares the .auth-page / .auth-card surface restyled in 00082.
// Story 00084 verified: both password fields render at 40px /
// --radius-md / --border-strong; "Set password" button is a
// full-width .btn--primary; mismatch / invalid-token errors
// surface via .auth-card__error-slot which uses --danger-bg /
// --danger / --danger 1px border. Success redirects to
// /login?reset=1 (the success styling lives there, not here).

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/app/lib/api";
import { AuthFooter } from "@/app/components/AuthFooter";
import { AuthBrand } from "@/app/components/AuthBrand";

function ConfirmForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") ?? "";

  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pwd) return setErr("Please enter a new password.");
    if (pwd.length < 12) return setErr("Password must be at least 12 characters.");
    if (pwd !== pwd2) return setErr("Passwords do not match.");
    setBusy(true);
    try {
      await api("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password: pwd }),
        skipAuth: true,
      });
      router.push("/login?reset=1");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <form className="auth-card auth-card--vector" noValidate>
        <AuthBrand />
        <h1 className="auth-card__title">Missing token</h1>
        <p className="auth-card__subtitle">
          This reset link is invalid or incomplete. Request a new one.
        </p>
        <Link href="/login/reset" className="auth-card__link">Request a new link</Link>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="auth-card auth-card--vector" noValidate>
      <AuthBrand />
      <h1 className="auth-card__title">Set password</h1>
      <label className="form__label">
        [1] New password
        <input
          type="password"
          autoComplete="new-password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          className="form__input"
        />
      </label>
      <label className="form__label">
        [2] Confirm
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
        {busy ? "Saving…" : "Set password"}
      </button>
      <Link href="/login" className="auth-card__link">Back to sign in</Link>
    </form>
  );
}

export default function ResetConfirmPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={null}>
        <ConfirmForm />
      </Suspense>
      <AuthFooter />
    </div>
  );
}
