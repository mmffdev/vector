"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/app/lib/api";
import { AuthFooter } from "@/app/components/AuthFooter";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email) return setErr("Please enter your email.");
    setBusy(true);
    try {
      await api("/api/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
        skipAuth: true,
      });
    } catch {
      // always show success for enumeration safety
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form onSubmit={onSubmit} className="auth-card" noValidate>
        <h1 className="auth-card__title">
          <span className="prefix prefix-pink">+++</span> Reset password
        </h1>
        {sent ? (
          <p className="auth-card__subtitle">
            If that email exists, a reset link has been sent. Check your inbox (or server log in dev).
          </p>
        ) : (
          <>
            <label className="form__label">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form__input"
              />
            </label>
            <div className={`auth-card__error-slot${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
              {err}
            </div>
            <button type="submit" disabled={busy} className="btn btn--primary btn--block">
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <Link href="/login" className="auth-card__link">Back to sign in</Link>
      </form>
      <AuthFooter />
    </div>
  );
}
