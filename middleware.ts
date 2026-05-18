import { NextResponse, type NextRequest } from "next/server";

// ─── CSP — per-request nonce (TD-SEC-CSP-NONCES-SRI Phase 1) ─────────────────
// A fresh nonce is generated per request and seeded into:
//   1. The `x-csp-nonce` request header (so server components in
//      app/layout.tsx can read it via headers() and stamp it on any
//      inline <script>).
//   2. The CSP response header (so the browser admits scripts that
//      carry that exact nonce).
// Next.js 15 reads the request header and auto-stamps its own framework
// inline scripts (the self.__next_f.push streaming chunks) with the same
// nonce — confirmed empirically in the Phase 3 test.
//
// Report-Only mode for the soak window. Phase 5 flips the header name
// from Content-Security-Policy-Report-Only to Content-Security-Policy.
// Violations POST to /_site/csp-report (Phase 2).
//
// 'strict-dynamic' means a nonced script can load further scripts
// (no need to nonce every chunk recursively). Without it Next.js's
// dynamic chunk loading would fail under strict CSP.

const PUBLIC_PATHS = [
  "/login",
  "/login/reset",
  "/login/reset/confirm",
  "/change-password",
  // PLA-0008 / 00327 — help pages are shareable read-only references.
  "/help",
  // Phase 2 PoC: /v2/* hits vector_artefacts via /api/v2/* and uses fixture
  // IDs instead of the Go session. Production authz does not gate it.
  "/v2",
];

const isProd = process.env.NODE_ENV === "production";

function buildCsp(nonce: string, apiBase: string): string {
  const apiBaseWs = apiBase.replace(/^http/i, "ws");
  // 'unsafe-eval' kept in dev only — Turbopack/HMR uses it. Production
  // Next.js does not.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isProd ? [] : ["'unsafe-eval'"]),
  ].join(" ");
  // style-src keeps 'unsafe-inline' as a transitional measure — see
  // TD-SEC-CSP-STYLE-INLINE (S3). Killing inline styles requires
  // retiring 96 `style={{…}}` props + handling React Flow / styled-jsx
  // dynamic styles. Not on the critical path for the S1 XSS reduction
  // (script-src nonce-only is the procurement-relevant control).
  const styleSrc = "'self' 'unsafe-inline' https://fonts.googleapis.com";
  const parts = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "worker-src 'self' blob:",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${apiBase} ${apiBaseWs}`,
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "report-uri /_site/csp-report",
  ];
  return parts.join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Generate per-request nonce. crypto.randomUUID() is Web Crypto, lands
  // in the edge runtime. Strip hyphens so the nonce is base16-ish — CSP
  // accepts any token here.
  const nonce = crypto.randomUUID().replace(/-/g, "");

  // ── Auth redirect (existing) ─────────────────────────────────────────
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const hasSession = !!req.cookies.get("session_alive");

  let response: NextResponse;
  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    response = NextResponse.redirect(url);
  } else {
    // Seed the nonce on the FORWARDED request headers so layout.tsx
    // can read it via headers() in a Server Component. Next.js 15
    // also reads `x-nonce` for its framework chunk stamping.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-csp-nonce", nonce);
    requestHeaders.set("x-nonce", nonce);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // ── Stamp CSP on the response (enforced — Phase 5 flip 2026-05-18) ──
  // Soak in Report-Only completed clean (csp_reports zero across login,
  // dashboard, portfolio-items, topology, theme-bootstrap). Header
  // renamed from Content-Security-Policy-Report-Only to
  // Content-Security-Policy; report-uri stays live so ongoing
  // violations still record. Rollback path: rename the header back
  // (no other code change needed).
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100";
  response.headers.set(
    "Content-Security-Policy",
    buildCsp(nonce, apiBase),
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$).*)"],
};
