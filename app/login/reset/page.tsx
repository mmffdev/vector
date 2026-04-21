"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/app/lib/api";

export default function ResetRequestPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      <form onSubmit={onSubmit} className="auth-card">
        <h1 className="auth-card__title">Reset password</h1>
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
                required
                className="form__input"
              />
            </label>
            <button type="submit" disabled={busy} className="btn btn--primary btn--block">
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <Link href="/login" className="auth-card__link">Back to sign in</Link>
      </form>
    </div>
  );
}
