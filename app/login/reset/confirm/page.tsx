"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/app/lib/api";

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
    if (pwd !== pwd2) return setErr("Passwords do not match.");
    if (pwd.length < 12) return setErr("Password must be at least 12 characters.");
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
    return <p className="auth-card__subtitle">Missing token.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="auth-card">
      <h1 className="auth-card__title">Set a new password</h1>
      <label className="form__label">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          required
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
          required
          className="form__input"
        />
      </label>
      <p className="form__hint">Min 12 characters, at least one letter and one digit.</p>
      {err && <div className="form__error">{err}</div>}
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
    </div>
  );
}
