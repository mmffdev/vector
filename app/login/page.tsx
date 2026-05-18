"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth, ApiError, MFAChallengeError } from "@/app/contexts/AuthContext";
import { AuthFooter } from "@/app/components/AuthFooter";
import { AuthBrand } from "@/app/components/AuthBrand";
import { apiSite as api } from "@/app/lib/api";

function LoginForm() {
  const { login, mfaLogin } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const rawRedirect = search.get("redirect");
  const explicitRedirect =
    rawRedirect &&
    /^\/(?![\\/])/.test(rawRedirect) &&
    !rawRedirect.startsWith("/v2/")
      ? rawRedirect
      : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function navigateAfterLogin(u: { force_password_change: boolean }) {
    if (u.force_password_change) {
      router.push("/change-password");
      return;
    }
    let dest = explicitRedirect ?? "/dashboard";
    if (!explicitRedirect) {
      try {
        const res = await api<{ href: string }>("/nav/start-page");
        if (res.href) dest = res.href;
      } catch { /* fall through */ }
    }
    router.push(dest);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email) return setErr("Please enter your email.");
    if (!password) return setErr("Please enter your password.");

    setBusy(true);
    try {
      const u = await login(email, password);
      await navigateAfterLogin(u);
    } catch (e) {
      if (e instanceof MFAChallengeError) {
        const code = mfaCode.trim().replace(/\s/g, "");
        if (code) {
          try {
            const u = await mfaLogin(e.challengeToken, code, rememberDevice);
            await navigateAfterLogin(u);
          } catch {
            setErr("Incorrect authenticator code. Check your app and try again.");
          }
        } else {
          setErr("This account requires an authenticator code — please enter it and sign in again.");
        }
        return;
      }
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 423) setErr("Account locked. Try again later.");
      else if (status === 403) setErr("Account inactive.");
      else setErr("Invalid email or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-card auth-card--vector" noValidate>
      <AuthBrand />

      <label className="form__label">
        [1] Email
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="form__input"
        />
      </label>

      <label className="form__label">
        [2] Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="form__input"
        />
      </label>

      <label className="form__label">
        [3] Authenticator code
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          className="form__input form__input--mono"
          placeholder="000000"
        />
      </label>

      <label className="auth-card__remember-row">
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
        />
        Remember this device for 30 days
      </label>

      <div className={`auth-card__error-slot${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
        {err}
      </div>

      <button type="submit" disabled={busy} className="btn btn--primary btn--block">
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <Link href="/login/reset" className="auth-card__link">Forgot password?</Link>

      <div className="auth-card__notice">
        <p>WARNING: Unauthorised access to this system is prohibited and will be subject to legal action. By accessing this system, you accept that your activities may be monitored if unauthorised use is suspected.</p>
        <p>This login page uses only strictly necessary cookies. For more information, please see our Cookie Policy.</p>
        <p>By proceeding to log in, you confirm your understanding.</p>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <AuthFooter />
    </div>
  );
}
