import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP: allow self + inline styles (Next.js injects some), connect-src to API backend.
const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100";
// Browsers treat http(s):// and ws(s):// as distinct schemes for connect-src.
// Derive the websocket origin alongside the http origin so EventSource/fetch
// AND WebSocket targets are both allowed.
const apiBaseWs = apiBase.replace(/^http/i, "ws");
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
  // Web Workers — kept enabled for future off-main-thread work.
  // Turbopack bundles workers as blob: URLs in dev; bundled chunks
  // are served same-origin in prod.
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' ${apiBase} ${apiBaseWs}`,
  // 'self' (not 'none') so internal tooling can iframe sibling routes
  // same-origin (e.g. /v2/compare A/B rig). Cross-origin embedding stays
  // blocked.
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
  { key: "Content-Security-Policy", value: csp },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const config: NextConfig = {
  reactStrictMode: true,
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
