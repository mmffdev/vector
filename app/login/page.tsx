"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth, ApiError, MFAChallengeError } from "@/app/contexts/AuthContext";
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
    <form onSubmit={onSubmit} className="login__form" noValidate>
      <label className="login__field-group">
        <span className="login__field-label">EMAIL</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login__input"
        />
      </label>

      <label className="login__field-group">
        <span className="login__field-label">PASSWORD</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="login__input"
        />
      </label>

      <label className="login__field-group">
        <span className="login__field-label">AUTHENTICATOR CODE</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value)}
          className="login__input login__input--mono"
          placeholder="0 0 0 0 0 0"
        />
      </label>

      <label className="login__remember">
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
          className="login__checkbox"
        />
        <span>Remember this device for 30 days</span>
      </label>

      <div className={`login__error${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
        {err}
      </div>

      <button type="submit" disabled={busy} className="login__submit">
        {busy ? "Verifying and signing in…" : "Verify and sign in"}
      </button>

      <div className="login__footer-links">
        <Link href="/login/reset" className="login__link">Forgot password?</Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login-page">
      <aside className="login-page__sidebar">
        <div className="login-page__sidebar-logo">
          <Image
            src="/logo-vector.png"
            alt="Vector"
            width={120}
            height={120}
            priority
          />
        </div>
      </aside>

      <main className="login-page__content">
        <div className="login-page__form-column">
          <div className="login-page__form-panel">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>

        <div className="login-page__welcome-column">
          <div className="login-page__welcome">
            <h1 className="login-page__welcome-title">Welcome back, Salung.</h1>
            <p className="login-page__welcome-text">You last signed in 4 days ago from Madrid. 12 new updates across your pinned portfolios.</p>
          </div>
        </div>
      </main>

      <footer className="login-page__footer">
        build 7f3a • 2026.05.18
      </footer>
    </div>
  );
}
