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
