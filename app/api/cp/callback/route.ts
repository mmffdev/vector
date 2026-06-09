// /api/cp/callback — PLAT1.9 (flag-gated): the Control-Plane OIDC form_post
// receiver.
//
// The CP OP, when Vector requests response_mode=form_post, returns an
// auto-submitting form that POSTs { code, state } to THIS route (not the
// address bar — PLA-0053-clean: the OAuth response arrives in the POST body, a
// wire request, never the URL). This handler reads those body fields and renders
// a tiny HTML bridge page that hands them to the client-side exchange
// (app/cp/callback/page.tsx) via injected script variables — so the token
// exchange (which needs the PKCE verifier from sessionStorage) runs in the
// browser, and the values never touch the address bar.
//
// ENTIRELY FLAG-GATED at the edges: nothing posts here unless the operator turned
// on NEXT_PUBLIC_CP_AUTH_ENABLED and the user went through beginCpLogin().

import { NextRequest, NextResponse } from "next/server";

// htmlAttr escapes a value for safe embedding in a JSON string inside a <script>.
// We JSON.stringify (escapes quotes/backslashes) then neutralise the only
// sequence that can break out of a script element: "</".
function safeScriptJSON(v: string): string {
  return JSON.stringify(v).replace(/<\/?/g, (m) => (m === "</" ? "<\\/" : m));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  const state = String(form.get("state") ?? "");

  // Bridge page: stash code+state where the client callback expects them (NOT
  // the URL), then navigate to the clean /cp/callback path which runs the
  // exchange. The values live only in this transient page's script + session
  // storage, never in the address bar.
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in…</title></head>` +
    `<body><p>Completing sign-in…</p><script>` +
    `try{sessionStorage.setItem("vector.cp.code", ${safeScriptJSON(code)});` +
    `sessionStorage.setItem("vector.cp.resp_state", ${safeScriptJSON(state)});}catch(e){}` +
    `location.replace("/cp/callback");` +
    `</script></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
