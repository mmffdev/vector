import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (req.cookies.get("session_alive")) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("redirect", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$).*)"],
};
