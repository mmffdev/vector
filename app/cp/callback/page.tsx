"use client";

// /cp/callback — PLAT1.9 (flag-gated): the Control-Plane sign-in completion page.
//
// The OAuth authorization response (code+state) does NOT arrive here in the URL.
// The CP uses response_mode=form_post → it POSTs code+state to the server route
// /api/cp/callback, which stashes them in sessionStorage and navigates here. This
// page reads them from sessionStorage (browser state, never the address bar —
// PLA-0053-clean), exchanges the code for a DPoP-bound token, adopts it as the
// Vector session, and navigates to the dashboard. On any error it falls back to
// /login so a CP hiccup never strands the user.
//
// ENTIRELY FLAG-GATED: with NEXT_PUBLIC_CP_AUTH_ENABLED off, nothing routes here.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { cpAuthEnabled, completeCpLogin } from "@/app/lib/cpAuth";

const SS_CODE = "vector.cp.code";
const SS_RESP_STATE = "vector.cp.resp_state";

export default function CpCallbackPage() {
  const router = useRouter();
  const { adoptCpSession } = useAuth();
  const [status, setStatus] = useState<"working" | "error" | "disabled">(
    cpAuthEnabled() ? "working" : "disabled",
  );
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    if (!cpAuthEnabled()) return;
    // Read the form_post response the /api/cp/callback bridge stashed (never URL).
    const code = sessionStorage.getItem(SS_CODE);
    const state = sessionStorage.getItem(SS_RESP_STATE);
    sessionStorage.removeItem(SS_CODE);
    sessionStorage.removeItem(SS_RESP_STATE);
    if (!code || !state) {
      setStatus("error");
      setMessage("Missing authorization response. Returning to sign-in…");
      const t = setTimeout(() => router.replace("/login"), 1500);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await completeCpLogin(code, state);
        const user = await adoptCpSession(accessToken);
        if (cancelled) return;
        router.replace(user.force_password_change ? "/change-password" : "/dashboard");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          `Control-Plane sign-in failed (${
            e instanceof Error ? e.message : "unknown error"
          }). Returning to sign-in…`,
        );
        setTimeout(() => router.replace("/login"), 2000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, adoptCpSession]);

  if (status === "disabled") {
    return (
      <main className="loginv2__shell">
        <p className="loginv2__hero-sub">
          Control-Plane sign-in is not enabled.{" "}
          <a href="/login" className="loginv2__forgot">
            Return to sign-in
          </a>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="loginv2__shell">
      <p className="loginv2__hero-sub">{message}</p>
    </main>
  );
}
