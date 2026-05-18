"use client";

// /login/reset/confirm — set new password from a reset token.
//
// Inbound-link exception (2026-05-18): this page MUST read ?token=
// from the URL because the email link is the only delivery channel.
// To minimise the leak window:
//   1. Token is captured into in-memory state on mount, then
//      router.replace() strips ?token= from the address bar in the
//      same tick — closes the bookmark/share/screen-share path before
//      any other request fires.
//   2. POST body carries the token to /auth/password-reset/confirm;
//      backend SHA-256 hashes + marks single-use.
//   3. Success flag for /login is sessionStorage, not a URL param.
// Deeper fix (token in URL fragment so it never leaves the browser,
// or short-lived session-cookie handoff) tracked in TD-SEC-RESET-TOKEN-FRAGMENT.

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiSite as api, ApiError } from "@/app/lib/api";
import { AuthFooter } from "@/app/components/AuthFooter";
import { AuthBrand } from "@/app/components/AuthBrand";

function ConfirmForm() {
  const router = useRouter();
  const search = useSearchParams();
  // Capture once; the URL copy is stripped below so the address bar,
  // history, and any future Referer header are clean.
  const [token, setToken] = useState<string>(() => search.get("token") ?? "");

  useEffect(() => {
    if (search.get("token")) {
      router.replace("/login/reset/confirm");
    }
  }, [router, search]);

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
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password: pwd }),
        skipAuth: true,
      });
      setToken("");
      try { sessionStorage.setItem("vector.reset.success", "1"); } catch { /* private mode */ }
      router.push("/login");
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
