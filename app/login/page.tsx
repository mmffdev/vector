"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth, ApiError } from "@/app/contexts/AuthContext";

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
    <form onSubmit={onSubmit} className="auth-card">
      <h1 className="auth-card__title">
        <span className="prefix-pink">+++</span> Vector
      </h1>
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
      <label className="form__label">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="form__input"
        />
      </label>
      {err && <div className="form__error">{err}</div>}
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
    </div>
  );
}
