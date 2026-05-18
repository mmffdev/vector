"use client";

// /login/reset/confirm — set new password.
//
// Cookie handoff (TD-SEC-RESET-TOKEN-FRAGMENT, 2026-05-18). The raw
// reset token never reaches this page. The flow is:
//   1. User clicks email link → GET :5100/_site/auth/password-reset/redeem?t=<raw>
//   2. Backend validates raw token, mints a 5-min HttpOnly handoff
//      cookie carrying only the reset_id, 302s here.
//   3. This page probes /_site/auth/password-reset/state on mount —
//      200 if cookie alive, 401 (rendered as "link expired") if not.
//   4. Submit POSTs only { password } to /_site/auth/password-reset/confirm;
//      backend reads the cookie, looks up reset_id, applies the change.
// No token in URL, history, JS, Referer, or logs.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { AuthFooter } from "@/app/components/AuthFooter";
import { AuthBrand } from "@/app/components/AuthBrand";

type State = "probing" | "ready" | "expired";

function ConfirmForm() {
  const router = useRouter();
  const [state, setState] = useState<State>("probing");

  // Probe the handoff cookie once on mount. 200 → form ready;
  // 401/anything-else → render the "link expired" CTA.
  useEffect(() => {
    let cancelled = false;
    api("/auth/password-reset/state", { skipAuth: true })
      .then(() => { if (!cancelled) setState("ready"); })
      .catch(() => { if (!cancelled) setState("expired"); });
    return () => { cancelled = true; };
  }, []);

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
      // No token in the body — the handoff cookie set by /redeem
      // identifies the reset row server-side.
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ password: pwd }),
        skipAuth: true,
      });
      try { sessionStorage.setItem("vector.reset.success", "1"); } catch { /* private mode */ }
      router.push("/login");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "probing") {
    return (
      <form className="auth-card auth-card--vector" noValidate aria-busy="true">
        <AuthBrand />
        <p className="auth-card__subtitle">Checking your reset link…</p>
      </form>
    );
  }

  if (state === "expired") {
    return (
      <form className="auth-card auth-card--vector" noValidate>
        <AuthBrand />
        <h1 className="auth-card__title">Link expired</h1>
        <p className="auth-card__subtitle">
          This reset link is invalid, has been used, or has expired. Request a new one.
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
      <ConfirmForm />
      <AuthFooter />
    </div>
  );
}
