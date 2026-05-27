import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP lives in middleware.ts so each request gets a fresh nonce
// (TD-SEC-CSP-NONCES-SRI Phase 1). This file owns the other security
// headers — these don't vary per-request so static config is fine.

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  // StrictMode deliberately double-mounts every component in dev so
  // effect bugs (subscriptions without cleanup, missed AbortController,
  // mutable refs without reset) surface in a deterministic way. Vector
  // runs dev as its single deployment surface — there is no separate
  // production where the double-mount would harmlessly disappear, so
  // every dev-only 2× fetch is a real cost paid by a real user. The
  // single-user / solo-dev posture (USER.md) means effect-bug regressions
  // would be caught by the developer first, not surfaced by StrictMode
  // for the first time in front of a stranger. Net: disabling here is
  // the level-playing-field choice — same request volume as eventual
  // staging/prod would see.
  //
  // Re-enable IF: a staging/prod surface lands and we want to use
  // StrictMode as the dev-only effect-bug net before requests fan out
  // across more network surface.
  reactStrictMode: false,
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Workspace Admin — /workspace-settings/workspace-settings/* → /workspace-admin/*
      { source: "/workspace-settings/workspace-settings/:path*", destination: "/workspace-admin/:path*", permanent: true },
      // User Management — /workspace-settings/users/* → /user-management/*
      { source: "/workspace-settings/users/:path*", destination: "/user-management/:path*", permanent: true },
      // User Management — /workspace-settings/permissions → /user-management/permissions
      { source: "/workspace-settings/permissions", destination: "/user-management/permissions", permanent: true },
      // Vector Admin — /workspace-settings/vector-admin/* → /vector-admin/*
      { source: "/workspace-settings/vector-admin/:path*", destination: "/vector-admin/:path*", permanent: true },
    ];
  },
};

export default config;
