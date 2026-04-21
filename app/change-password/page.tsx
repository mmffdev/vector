"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/app/lib/api";
import { useAuth } from "@/app/contexts/AuthContext";

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
    if (pwd !== pwd2) return setErr("Passwords do not match.");
    if (pwd.length < 12) return setErr("Password must be at least 12 characters.");
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
      <form onSubmit={onSubmit} className="auth-card auth-card--wide">
        <h1 className="auth-card__title">Set a new password</h1>
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
            required
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
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
