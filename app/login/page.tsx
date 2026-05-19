"use client";

// /login — sign-in page.
//
// No URL state. The "where to send the user after login" decision used
// to ride on ?redirect=<path>; that surface is now closed
// (TD-SEC-LOGIN-REDIRECT-COOKIE 2026-05-18). Middleware bounces
// unauthenticated requests through /_site/auth/login-required, which
// mints a signed HttpOnly continuation cookie carrying the original
// path and 302s to a plain /login. Post-auth we probe
// /_site/auth/login-continuation to retrieve and consume the path.
// Reset-success and involuntary-logout flags are read from
// sessionStorage on mount, not from URL params (PLA-0053).

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth, ApiError, MFAChallengeError } from "@/app/contexts/AuthContext";
import { apiSite } from "@/app/lib/api";

function LoginForm() {
  const { login, mfaLogin } = useAuth();
  const router = useRouter();
  const [resetSuccess, setResetSuccess] = useState(false);
  // B16.8.11 step 4 — read the session-state reason flag set by
  // hardLogout() in AuthContext when the backend evicted the user mid-
  // session (revoked or idle-expired). Banner copy mirrors the
  // backend's usermessages.AuthSession* strings so the user sees the
  // same explanation here that the API rejection emitted.
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    // Reset-success banner: consume the sessionStorage flag set by
    // /login/reset/confirm on a successful reset; clear immediately
    // so it only fires once per redirect.
    try {
      if (sessionStorage.getItem("vector.reset.success") === "1") {
        sessionStorage.removeItem("vector.reset.success");
        setResetSuccess(true);
      }
      // Same read-once pattern for the involuntary-logout reason.
      const r = sessionStorage.getItem("vector.login.reason");
      if (r === "session_revoked" || r === "session_idle_expired" || r === "session_anomaly") {
        sessionStorage.removeItem("vector.login.reason");
        setReason(r);
      }
    } catch { /* private mode */ }
  }, []);

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
    // TD-SEC-LOGIN-REDIRECT-COOKIE. Probe the continuation cookie set
    // by middleware → /_site/auth/login-required during the original
    // unauthenticated bounce. 200 + { path } means there was an
    // explicit target; 204 means the user landed on /login directly
    // and we fall through to the start-page resolver.
    let dest: string | null = null;
    try {
      const res = await apiSite<{ path?: string } | null>("/auth/login-continuation", { skipAuth: true });
      if (res && typeof res.path === "string" && res.path) {
        dest = res.path;
      }
    } catch { /* fall through to start-page */ }

    if (!dest) {
      try {
        const res = await apiSite<{ href: string }>("/nav/start-page");
        if (res.href) dest = res.href;
      } catch { /* fall through */ }
    }
    router.push(dest ?? "/dashboard");
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

      {resetSuccess && (
        <div className="login__error login__error--success is-visible" role="status" aria-live="polite">
          Password updated. Sign in with your new password.
        </div>
      )}

      {reason === "session_revoked" && (
        <div className="login__error is-visible" role="status" aria-live="polite">
          Your session was ended (signed out from another device or revoked by an admin). Please sign in again.
        </div>
      )}
      {reason === "session_idle_expired" && (
        <div className="login__error is-visible" role="status" aria-live="polite">
          Your session expired due to inactivity. Please re-enter your password to continue.
        </div>
      )}
      {reason === "session_anomaly" && (
        <div className="login__error is-visible" role="status" aria-live="polite">
          We detected a change in your network location. Please sign in again to continue.
        </div>
      )}

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
      <div className="login-page__logo-column">
        <Image
          src="/logo-vector.png"
          alt="Vector"
          width={60}
          height={60}
          priority
        />
        <div className="login-page__sidebar-wordmark">
          <span className="login-page__sidebar-wordmark-v">V</span><span className="login-page__sidebar-wordmark-ector">ector</span>
        </div>
        <div className="login-page__sidebar-version">v1.01</div>
      </div>

      <main className="login-page__main">
        <div className="login-page__form-container">
          <div className="login-page__form-header">
            <span className="login-page__form-label">SIGN IN</span>
            <h1 className="login-page__form-title">Welcome back</h1>
          </div>
          <div className="login-page__form-panel">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
          <div className="login-page__form-footer">
            <p>Authorised access only. Activity may be monitored. By signing in you accept the <Link href="/terms">terms of use</Link> and <Link href="/cookies">cookie policy</Link>.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
