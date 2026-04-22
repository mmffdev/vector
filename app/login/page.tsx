"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth, ApiError } from "@/app/contexts/AuthContext";
import { AuthFooter } from "@/app/components/AuthFooter";

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const redirectTo = search.get("redirect") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email) return setErr("Please enter your email.");
    if (!password) return setErr("Please enter your password.");
    setBusy(true);
    try {
      const u = await login(email, password);
      router.push(u.force_password_change ? "/change-password" : redirectTo);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 423) setErr("Account locked. Try again later.");
      else if (status === 403) setErr("Account inactive.");
      else setErr("Invalid email or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="auth-card" noValidate>
      <h1 className="auth-card__title">
        <span className="prefix prefix-pink">+++</span> VECTOR 方向
      </h1>
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
      <div className={`auth-card__error-slot${err ? " is-visible" : ""}`} role="alert" aria-live="polite">
        {err}
      </div>
      <div className="auth-card__notice">
        <p>WARNING: Unauthorised access to this system is prohibited and will be subject to legal action. By accessing this system, you accept that your activities may be monitored if unauthorised use is suspected.</p>
        <p>This login page uses only strictly necessary cookies. For more information, please see our Cookie Policy.</p>
        <p>By proceeding to log in, you confirm your understanding.</p>
      </div>
      <button type="submit" disabled={busy} className="btn btn--primary btn--block">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <Link href="/login/reset" className="auth-card__link">Forgot password?</Link>
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
