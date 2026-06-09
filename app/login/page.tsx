"use client";

// /login — sign-in page (v2 visual, two-step MFA reveal).
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
//
// MFA: username + password are shown first. If the backend returns
// MFAChallengeError we hold the challenge_token in state and swap the
// form to a code-only step ("Authenticator code" + "Remember this
// device for 30 days"). The backend session is still anonymous at this
// point; mfaLogin() exchanges the token for a real session.

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth, ApiError, MFAChallengeError } from "@/app/contexts/AuthContext";
import { apiSite } from "@/app/lib/api";
import { AuthFooter } from "@/app/components/AuthFooter";
import { cpAuthEnabled, beginCpLogin } from "@/app/lib/cpAuth";

type Reason = "session_revoked" | "session_idle_expired" | "session_anomaly";

// isSafeContinuationPath — frontend mirror of the Go validator in
// backend/internal/auth/handler.go. Defence-in-depth: the backend
// gate is authoritative, but rejecting a poisoned path here as well
// means a misconfigured prod backend can't ship the user off to a
// .well-known probe or /favicon.ico after login. Same rules in both
// places — keep in sync.
//
// Bad prefixes are built from underscore-joined segments to avoid a
// `/_site/` literal in source (lint:api-caller-discipline catches any
// raw site-mount string outside the apiSite helper). The constructed
// strings are denylist entries here, never fetch targets.
const _UNDERSCORE = "_";
const SAFE_PATH_BAD_PREFIXES = [
  "/v2/",
  "/.well-known/",
  "/api/",
  "/" + _UNDERSCORE + "next/",
  "/" + _UNDERSCORE + "site/",
];
const SAFE_PATH_BAD_EXACT = [
  "/v2",
  "/.well-known",
  "/api",
  "/" + _UNDERSCORE + "next",
  "/" + _UNDERSCORE + "site",
];
function isSafeContinuationPath(p: string): boolean {
  if (!p || p.length > 2048) return false;
  if (p[0] !== "/") return false;
  if (p.length >= 2 && (p[1] === "/" || p[1] === "\\")) return false;
  if (SAFE_PATH_BAD_PREFIXES.some((bad) => p.startsWith(bad))) return false;
  if (SAFE_PATH_BAD_EXACT.includes(p)) return false;
  // Reject static-asset probes — terminal segment with a file
  // extension (max 8 ASCII alnum chars after the last dot).
  const q = p.search(/[?#]/);
  const path = q >= 0 ? p.slice(0, q) : p;
  const slash = path.lastIndexOf("/");
  const seg = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = seg.lastIndexOf(".");
  if (dot > 0 && dot < seg.length - 1) {
    const ext = seg.slice(dot + 1);
    if (ext.length <= 8 && /^[A-Za-z0-9]+$/.test(ext)) return false;
  }
  return true;
}

function LoginForm() {
  const { login, mfaLogin } = useAuth();
  const router = useRouter();

  // Banners (consumed from sessionStorage once on mount).
  const [resetSuccess, setResetSuccess] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("vector.reset.success") === "1") {
        sessionStorage.removeItem("vector.reset.success");
        setResetSuccess(true);
      }
      const r = sessionStorage.getItem("vector.login.reason");
      if (r === "session_revoked" || r === "session_idle_expired" || r === "session_anomaly") {
        sessionStorage.removeItem("vector.login.reason");
        setReason(r);
      }
    } catch { /* private mode */ }
  }, []);

  // Form state.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // MFA two-step: when the backend issues a challenge we capture the
  // token and swap to the code-only step. Storing the token (instead of
  // re-prompting password + code) means a wrong code doesn't burn the
  // password — only mfaLogin() rate-limits the code attempts.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

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
      if (res && typeof res.path === "string" && isSafeContinuationPath(res.path)) {
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

  async function onSubmitCredentials(e: React.FormEvent) {
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
        // Two-step reveal — swap to code entry. We DON'T clear the
        // password field; if the user backs out via "Use different
        // account" we want the round-trip to feel cheap.
        setChallengeToken(e.challengeToken);
        setMfaCode("");
        setBusy(false);
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

  async function onSubmitMfa(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!challengeToken) return;
    const code = mfaCode.trim().replace(/\s/g, "");
    if (!code) return setErr("Enter the 6-digit code from your authenticator app.");

    setBusy(true);
    try {
      const u = await mfaLogin(challengeToken, code, rememberDevice);
      await navigateAfterLogin(u);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) {
        // Stale or burned challenge token — kick back to credentials.
        setChallengeToken(null);
        setMfaCode("");
        setErr("That sign-in attempt expired. Please re-enter your password.");
      } else if (status === 423) {
        setChallengeToken(null);
        setErr("Too many incorrect codes. Try again later.");
      } else {
        setErr("Incorrect authenticator code. Check your app and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  function useDifferentAccount() {
    setChallengeToken(null);
    setMfaCode("");
    setErr(null);
  }

  const inMfa = challengeToken !== null;

  return (
    <>
      {/* ── Credentials step ────────────────────────────────────── */}
      {!inMfa && (
        <form className="loginv2__form" onSubmit={onSubmitCredentials} noValidate>
          <label className="loginv2__field">
            <span className="loginv2__field-label">USERNAME</span>
            <span className="loginv2__field-row">
              <svg className="loginv2__field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="loginv2__input"
              />
            </span>
          </label>

          <label className="loginv2__field">
            <span className="loginv2__field-label">PASSWORD</span>
            <span className="loginv2__field-row">
              <svg className="loginv2__field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.6" />
              </svg>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="loginv2__input"
              />
              <button
                type="button"
                className="loginv2__eye"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </span>
          </label>

          {renderBanners(err, resetSuccess, reason)}

          <button type="submit" className="loginv2__submit" disabled={busy}>
            <span>{busy ? "Signing in…" : "Sign in"}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="loginv2__form-foot">
            <Link href="/login/reset" className="loginv2__forgot">Forgot password?</Link>
          </div>

          {/* PLAT1.9 (flag-gated) — alternative: sign in via the MMFF Control
              Plane (OIDC). Rendered ONLY when NEXT_PUBLIC_CP_AUTH_ENABLED is on;
              the legacy email/password path above is unchanged. */}
          {cpAuthEnabled() && (
            <button
              type="button"
              className="loginv2__submit loginv2__submit--alt"
              onClick={() => { void beginCpLogin(); }}
            >
              <span>Sign in with MMFF Platform</span>
            </button>
          )}
        </form>
      )}

      {/* ── MFA step (revealed after MFAChallengeError) ─────────── */}
      {inMfa && (
        <form className="loginv2__form" onSubmit={onSubmitMfa} noValidate>
          <div className="loginv2__mfa-head">
            <div className="loginv2__hero-eyebrow">TWO-FACTOR</div>
            <h2 className="loginv2__mfa-title">Enter your authenticator code</h2>
            <p className="loginv2__hero-sub">Open your authenticator app and enter the 6-digit code for {email}.</p>
          </div>

          <label className="loginv2__field">
            <span className="loginv2__field-label">AUTHENTICATOR CODE</span>
            <span className="loginv2__field-row">
              <svg className="loginv2__field-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                className="loginv2__input loginv2__input--mono"
                placeholder="000000"
                autoFocus
              />
            </span>
          </label>

          <label className="loginv2__check loginv2__check--row">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
            />
            <span className="loginv2__check-box" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M5 12l5 5L20 6" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>Remember this device for 30 days</span>
          </label>

          {renderBanners(err, false, null)}

          <button type="submit" className="loginv2__submit" disabled={busy}>
            <span>{busy ? "Verifying…" : "Verify and sign in"}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="loginv2__form-foot">
            <button type="button" className="loginv2__linkbtn" onClick={useDifferentAccount}>
              Use a different account
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function renderBanners(err: string | null, resetSuccess: boolean, reason: Reason | null) {
  return (
    <div className="loginv2__banners">
      <div className={`loginv2__alert${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
        {err}
      </div>
      {resetSuccess && (
        <div className="loginv2__alert loginv2__alert--success is-visible" role="status" aria-live="polite">
          Password updated. Sign in with your new password.
        </div>
      )}
      {reason === "session_revoked" && (
        <div className="loginv2__alert is-visible" role="status" aria-live="polite">
          Your session was ended (signed out from another device or revoked by an admin). Please sign in again.
        </div>
      )}
      {reason === "session_idle_expired" && (
        <div className="loginv2__alert is-visible" role="status" aria-live="polite">
          Your session expired due to inactivity. Please re-enter your password to continue.
        </div>
      )}
      {reason === "session_anomaly" && (
        <div className="loginv2__alert is-visible" role="status" aria-live="polite">
          We detected a change in your network location. Please sign in again to continue.
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="loginv2">
      <section className="loginv2__left" aria-hidden="true">
        <div className="loginv2__canvas">
          <svg className="loginv2__grid" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id="lv2grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e6e1d8" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#lv2grid)" />
          </svg>

          <div className="loginv2__nodes">
            <div className="loginv2__feature loginv2__feature--a">
              <div className="loginv2__feature-meta">
                <span className="loginv2__feature-label">FEATURE</span>
                <span className="loginv2__feature-id">FEA-250</span>
              </div>
              <div className="loginv2__feature-title">Backlog</div>
              <div className="loginv2__status">
                <span className="loginv2__dot loginv2__dot--ready" />
                <span>Ready</span>
              </div>
            </div>

            <div className="loginv2__feature loginv2__feature--b">
              <div className="loginv2__feature-meta">
                <span className="loginv2__feature-label">FEATURE</span>
                <span className="loginv2__feature-id">FEA-251</span>
              </div>
              <div className="loginv2__feature-title">Sprint</div>
              <div className="loginv2__status">
                <span className="loginv2__dot loginv2__dot--progress" />
                <span>In progress</span>
              </div>
            </div>

            <div className="loginv2__feature loginv2__feature--c">
              <div className="loginv2__feature-meta">
                <span className="loginv2__feature-label">FEATURE</span>
                <span className="loginv2__feature-id">FEA-252</span>
              </div>
              <div className="loginv2__feature-title">Release</div>
              <div className="loginv2__status">
                <span className="loginv2__dot loginv2__dot--done" />
                <span>Done</span>
              </div>
            </div>

            {[
              { id: "US-1600", title: "Triage queue",  state: "Ready",       tone: "ready",    col: 1 },
              { id: "US-1601", title: "Estimation",    state: "Done",        tone: "done",     col: 2 },
              { id: "US-1602", title: "Daily standup", state: "Done",        tone: "done",     col: 3 },
              { id: "US-1603", title: "Burndown",      state: "Ready",       tone: "ready",    col: 4 },
              { id: "US-1604", title: "Demo notes",    state: "Done",        tone: "done",     col: 5 },
              { id: "US-1605", title: "Retro",         state: "Done",        tone: "done",     col: 6 },
            ].map((s) => (
              <div key={s.id} className={`loginv2__story loginv2__story--col${s.col}`}>
                <div className="loginv2__story-meta">
                  <span className="loginv2__story-label">USER STORY</span>
                  <span className="loginv2__story-id">{s.id}</span>
                </div>
                <div className="loginv2__story-title">{s.title}</div>
                <div className="loginv2__status">
                  <span className={`loginv2__dot loginv2__dot--${s.tone}`} />
                  <span>{s.state}</span>
                </div>
              </div>
            ))}

            {[
              { id: "TSK-3700", title: "Bulk move",      col: 1 },
              { id: "TSK-3701", title: "Poker dialog",   col: 2 },
              { id: "TSK-3702", title: "Status sweep",   col: 3 },
              { id: "TSK-3703", title: "Chart compute",  col: 4 },
              { id: "TSK-3704", title: "Recording",      col: 5 },
              { id: "TSK-3705", title: "Action tracker", col: 6 },
            ].map((t) => (
              <div key={t.id} className={`loginv2__task loginv2__task--col${t.col}`}>
                <div className="loginv2__task-meta">
                  <span className="loginv2__task-label">TASK</span>
                  <span className="loginv2__task-id">{t.id}</span>
                </div>
                <div className="loginv2__task-title">{t.title}</div>
                <div className="loginv2__status">
                  <span className="loginv2__dot loginv2__dot--muted" />
                  <span>Done</span>
                </div>
              </div>
            ))}

            {/* viewBox 0..100 + preserveAspectRatio="none" lets the
                coordinates read as percentages of the container while
                staying valid SVG (path `d` only accepts raw numbers,
                not `%` units). */}
            <svg
              className="loginv2__wires"
              width="100%"
              height="100%"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M 12 19 L 12 26" />
              <path d="M 25 19 L 25 26" />
              <path d="M 12 23 L 25 23" />
              <path d="M 41 19 L 41 26" />
              <path d="M 54 19 L 54 26" />
              <path d="M 41 23 L 54 23" />
              <path d="M 70 19 L 70 26" />
              <path d="M 83 19 L 83 26" />
              <path d="M 70 23 L 83 23" />
              <path className="loginv2__wire--dashed" d="M 12 38 L 12 60" />
              <path className="loginv2__wire--dashed" d="M 25 38 L 25 60" />
              <path className="loginv2__wire--dashed" d="M 41 38 L 41 60" />
              <path className="loginv2__wire--dashed" d="M 54 38 L 54 60" />
              <path className="loginv2__wire--dashed" d="M 70 38 L 70 60" />
              <path className="loginv2__wire--dashed" d="M 83 38 L 83 60" />
            </svg>
          </div>

          <div className="loginv2__caption">
            <div className="loginv2__caption-eyebrow">TOP-DOWN PORTFOLIO VIEW</div>
            <h2 className="loginv2__caption-headline">
              Every feature, broken down to the task that ships it.
            </h2>
          </div>
        </div>
      </section>

      <section className="loginv2__right">
        <div className="loginv2__right-inner">
          <header className="loginv2__brand">
            <Image
              src="/logo-vector.png"
              alt="Vector"
              width={48}
              height={48}
              priority
              className="loginv2__brand-mark"
            />
            <div>
              <div className="loginv2__brand-name">Vector</div>
              <div className="loginv2__brand-tag">PROGRAM MANAGEMENT</div>
            </div>
          </header>

          <div className="loginv2__hero">
            <div className="loginv2__hero-eyebrow">ONE WORKSPACE, ONE LOGIN</div>
            <h1 className="loginv2__hero-title">Welcome back</h1>
            <p className="loginv2__hero-sub">Sign in to continue refining work with your teams.</p>
          </div>

          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <AuthFooter />
        </div>
      </section>
    </div>
  );
}
