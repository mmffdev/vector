"use client";

import { useEffect } from "react";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    // Defence-in-depth. The ?token= / ?redirect= URL surfaces are now
    // closed (TD-SEC-RESET-TOKEN-FRAGMENT, TD-SEC-LOGIN-REDIRECT-COOKIE
    // — handoff cookies replace both), but no-referrer is kept on the
    // /login subtree so that any future regression that re-introduces
    // a query param on this route doesn't leak via Referer headers
    // when a user clicks an outbound link or an asset fetches
    // cross-origin. Scoped to /login/* by living in this layout.
    const existing = document.querySelector('meta[name="referrer"]');
    if (existing) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "referrer");
    meta.setAttribute("content", "no-referrer");
    meta.setAttribute("data-vector-login-referrer", "1");
    document.head.appendChild(meta);
    return () => {
      const installed = document.querySelector('meta[data-vector-login-referrer="1"]');
      installed?.remove();
    };
  }, []);

  return <>{children}</>;
}
